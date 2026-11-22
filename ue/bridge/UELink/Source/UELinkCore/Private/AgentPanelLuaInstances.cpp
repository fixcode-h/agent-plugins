// 纯 Lua 实例 lua.instances 和 Lua 设置 lua.config（2.20）。
//
// 很多项目的 Lua 框架自己 new 对象（setmetatable({}, Class)），这些表不绑 UObject，UnLua 的对象表里没有，
// lua.objects 列不出来（用户的 SM_HD_HomeDecoration 就是这样）。这里从 _G 和注册表（或设置里给的起点变量）走 Lua 堆，
// 元表链上有这个模块表的、或「类名字段」写着这个模块的表，就算它的实例。找到的表发一个 luaref:<编号>，
// lua.get / lua.set / lua.call / lua.inspect / lua.exec 的 path 填它就以这张表为起点（弱引用，不挡回收）。
#include "AgentPanelLua.h"
#include "AgentPanelLuaOps.h"

#include "AgentPanelBridge.h"

#if !AGENT_PANEL_WITH_LUA

void AgentPanelRegisterLuaInstanceOps(FAgentPanelBridge&) {}

#else

#include "AgentPanelBridgeUtil.h"
#include "AgentPanelLuaShared.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/PlatformTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "lua.hpp"

namespace AgentPanelLuaImpl
{
	namespace
	{
		const char* const RefById = "UELink.luaref.byid";
		const char* const RefIds = "UELink.luaref.ids";
		const char* const RefNext = "UELink.luaref.next";
		const TCHAR* const RefPrefix = TEXT("luaref:");

		/** 注册表里的弱表：没有就建，压栈 */
		void PushLuaRefTable(lua_State* L, const char* Key, const char* Mode)
		{
			lua_getfield(L, LUA_REGISTRYINDEX, Key);
			if (lua_istable(L, -1))
			{
				return;
			}
			lua_pop(L, 1);
			lua_newtable(L);
			lua_newtable(L);
			lua_pushstring(L, Mode);
			lua_setfield(L, -2, "__mode");
			lua_setmetatable(L, -2);
			lua_pushvalue(L, -1);
			lua_setfield(L, LUA_REGISTRYINDEX, Key);
		}

		FLuaConfig GLuaConfig;
		bool bLuaConfigLoaded = false;

		FString LuaCfgFile()
		{
			return FPaths::Combine(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()), TEXT("UELink"), TEXT("lua-config.json"));
		}

		TArray<FString> LuaCfgStrList(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
		{
			TArray<FString> Out;
			const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
			if (O.IsValid() && O->TryGetArrayField(Key, Arr) && Arr != nullptr)
			{
				for (const TSharedPtr<FJsonValue>& V : *Arr)
				{
					FString S;
					if (V.IsValid() && V->TryGetString(S) && !S.TrimStartAndEnd().IsEmpty())
					{
						Out.AddUnique(S.TrimStartAndEnd());
					}
				}
			}
			return Out;
		}

		FLuaConfig LuaCfgFromJson(const TSharedPtr<FJsonObject>& O)
		{
			FLuaConfig C;
			if (!O.IsValid())
			{
				return C;
			}
			O->TryGetStringField(TEXT("scriptRoot"), C.ScriptRoot);
			O->TryGetStringField(TEXT("objectKey"), C.ObjectKey);
			C.ScriptRoot.TrimStartAndEndInline();
			C.ObjectKey.TrimStartAndEndInline();
			C.ClassFields = LuaCfgStrList(O, TEXT("classFields"));
			C.Roots = LuaCfgStrList(O, TEXT("roots"));
			C.NameFields = LuaCfgStrList(O, TEXT("nameFields"));
			double Max = 0.0;
			if (O->TryGetNumberField(TEXT("maxVisit"), Max) && Max > 0.0)
			{
				C.MaxVisit = FMath::Clamp(static_cast<int32>(Max), 1000, 2000000);
			}
			return C;
		}

		TSharedRef<FJsonObject> LuaCfgToJson(const FLuaConfig& C)
		{
			TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
			auto List = [](const TArray<FString>& In)
			{
				TArray<TSharedPtr<FJsonValue>> Arr;
				for (const FString& S : In)
				{
					Arr.Add(MakeShared<FJsonValueString>(S));
				}
				return Arr;
			};
			O->SetStringField(TEXT("scriptRoot"), C.ScriptRoot);
			O->SetStringField(TEXT("objectKey"), C.ObjectKey);
			O->SetArrayField(TEXT("classFields"), List(C.ClassFields));
			O->SetArrayField(TEXT("roots"), List(C.Roots));
			O->SetArrayField(TEXT("nameFields"), List(C.NameFields));
			O->SetNumberField(TEXT("maxVisit"), C.MaxVisit);
			return O;
		}

		/** 模块名统一写法：`\`、`.` 当 `/`，去掉首尾的 `/` 和 .lua，不分大小写（`/Module/A/B` 和 `Module.A.B` 是同一个） */
		FString NormLuaModule(const FString& In)
		{
			FString S = In.TrimStartAndEnd().Replace(TEXT("\\"), TEXT("/"));
			if (S.EndsWith(TEXT(".lua"), ESearchCase::IgnoreCase))
			{
				S.LeftChopInline(4);
			}
			S.ReplaceInline(TEXT("."), TEXT("/"));
			TArray<FString> Parts;
			S.ParseIntoArray(Parts, TEXT("/"), true);
			return FString::Join(Parts, TEXT("/")).ToLower();
		}

		/** rawget(T, Key)，字符串或数字时转成文字；别的为空 */
		FString LuaRawText(lua_State* L, int T, const FString& Key)
		{
			FTop Guard(L);
			PushStr(L, Key);
			lua_rawget(L, T);
			const int Ty = lua_type(L, -1);
			if (Ty == LUA_TSTRING || Ty == LUA_TNUMBER)
			{
				size_t N = 0;
				const char* S = lua_tolstring(L, -1, &N);
				return FromUtf8(S, N);
			}
			return FString();
		}

		/** 沿元表链往上（元表、元表的 __index，最多 12 层），每层的表指针收进 Out */
		void LuaMetaChain(lua_State* L, int T, TArray<const void*>& Out)
		{
			FTop Guard(L);
			lua_pushvalue(L, T);
			TSet<const void*> Seen;
			for (int32 Depth = 0; Depth < 12; ++Depth)
			{
				const int Cur = lua_gettop(L);
				if (!lua_getmetatable(L, Cur))
				{
					return;
				}
				const int MT = lua_gettop(L);
				const void* MP = lua_topointer(L, MT);
				if (Seen.Contains(MP))
				{
					return;
				}
				Seen.Add(MP);
				Out.Add(MP);
				lua_pushstring(L, "__index");
				lua_rawget(L, MT);
				if (lua_istable(L, -1))
				{
					const void* IP = lua_topointer(L, -1);
					if (!Seen.Contains(IP))
					{
						Seen.Add(IP);
						Out.Add(IP);
					}
					continue;
				}
				lua_pop(L, 1);
			}
		}

		/** 一次查找用到的模块表：表指针 → 模块名，统一写法 → 表指针 */
		struct FLuaInstModules
		{
			TMap<const void*, FString> NameOf;
			TMap<FString, const void*> ByNorm;

			void Build(lua_State* L)
			{
				FTop Guard(L);
				lua_getfield(L, LUA_REGISTRYINDEX, LUA_LOADED_TABLE);
				if (!lua_istable(L, -1))
				{
					return;
				}
				lua_pushnil(L);
				while (lua_next(L, -2))
				{
					if (lua_type(L, -2) == LUA_TSTRING && lua_istable(L, -1))
					{
						size_t N = 0;
						const char* S = lua_tolstring(L, -2, &N);
						const FString Name = FromUtf8(S, N);
						const void* P = lua_topointer(L, -1);
						NameOf.Add(P, Name);
						const FString Norm = NormLuaModule(Name);
						if (!ByNorm.Contains(Norm))
						{
							ByNorm.Add(Norm, P);
						}
					}
					lua_pop(L, 1);
				}
			}

			/** 表是哪个模块的实例：元表链上第一个模块表；类名字段写着的模块优先。不是实例返回空 */
			FString ClassOf(lua_State* L, int T, const FLuaConfig& Cfg, TArray<const void*>& OutChain, bool& bOutByField) const
			{
				OutChain.Reset();
				bOutByField = false;
				LuaMetaChain(L, T, OutChain);
				for (const FString& Field : Cfg.ClassFields)
				{
					const FString Val = LuaRawText(L, T, Field);
					if (Val.IsEmpty())
					{
						continue;
					}
					bOutByField = true;
					// 字段写的模块也加载了时，把它的元表链也算进来（判断「是它的子类」要用）
					if (const void* const* P = ByNorm.Find(NormLuaModule(Val)))
					{
						OutChain.Insert(*P, 0);
						return NameOf.FindRef(*P);
					}
					return Val;
				}
				for (const void* P : OutChain)
				{
					if (const FString* Name = NameOf.Find(P))
					{
						return *Name;
					}
				}
				return FString();
			}
		};

		/** 起点变量（`_G.GameApp.Modules`、`GameApp.Modules`）压栈；走不通返回 false */
		bool PushLuaRootVar(lua_State* L, const FString& Path)
		{
			TArray<FString> Parts;
			Path.Replace(TEXT("["), TEXT(".")).Replace(TEXT("]"), TEXT("")).Replace(TEXT("\""), TEXT("")).ParseIntoArray(Parts, TEXT("."), true);
			if (Parts.Num() > 0 && Parts[0] == TEXT("_G"))
			{
				Parts.RemoveAt(0);
			}
			lua_pushglobaltable(L);
			for (const FString& Part : Parts)
			{
				if (!lua_istable(L, -1))
				{
					lua_pop(L, 1);
					return false;
				}
				if (Part.IsNumeric())
				{
					lua_pushinteger(L, FCString::Atoi64(*Part));
				}
				else
				{
					PushStr(L, Part);
				}
				lua_rawget(L, -2);
				lua_remove(L, -2);
			}
			if (!lua_istable(L, -1))
			{
				lua_pop(L, 1);
				return false;
			}
			return true;
		}
	}

	const FLuaConfig& LuaConfig()
	{
		if (!bLuaConfigLoaded)
		{
			bLuaConfigLoaded = true;
			FString Text;
			TSharedPtr<FJsonObject> O;
			if (FFileHelper::LoadFileToString(Text, *LuaCfgFile()) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), O))
			{
				GLuaConfig = LuaCfgFromJson(O);
			}
		}
		return GLuaConfig;
	}

	bool IsLuaRef(const FString& Path)
	{
		return Path.StartsWith(RefPrefix, ESearchCase::IgnoreCase);
	}

	bool PushLuaRef(lua_State* L, const FString& Path, FString& Error)
	{
		const FString Id = Path.Mid(FCString::Strlen(RefPrefix));
		if (!Id.IsNumeric())
		{
			Error = FString::Printf(TEXT("%s 不是纯 Lua 实例的引用（应该是 luaref:<数字>，由 lua.instances 给）"), *Path);
			return false;
		}
		PushLuaRefTable(L, RefById, "v");
		lua_rawgeti(L, -1, FCString::Atoi64(*Id));
		lua_remove(L, -2);
		if (!lua_istable(L, -1))
		{
			lua_pop(L, 1);
			Error = FString::Printf(TEXT("%s 指的纯 Lua 实例已经不在了（被回收、重载过或换了 Lua 环境）：用 lua.instances 重新找一次"), *Path);
			return false;
		}
		return true;
	}

	FString LuaRefOf(lua_State* L, int Idx)
	{
		FTop Guard(L);
		const int T = lua_absindex(L, Idx);
		PushLuaRefTable(L, RefIds, "k");
		const int Ids = lua_gettop(L);
		lua_pushvalue(L, T);
		lua_rawget(L, Ids);
		if (lua_isinteger(L, -1))
		{
			return FString::Printf(TEXT("%s%lld"), RefPrefix, (long long)lua_tointeger(L, -1));
		}
		lua_pop(L, 1);
		lua_getfield(L, LUA_REGISTRYINDEX, RefNext);
		const lua_Integer Next = (lua_isinteger(L, -1) ? lua_tointeger(L, -1) : 0) + 1;
		lua_pop(L, 1);
		lua_pushinteger(L, Next);
		lua_setfield(L, LUA_REGISTRYINDEX, RefNext);
		lua_pushvalue(L, T);
		lua_pushinteger(L, Next);
		lua_rawset(L, Ids);
		PushLuaRefTable(L, RefById, "v");
		lua_pushvalue(L, T);
		lua_rawseti(L, -2, Next);
		return FString::Printf(TEXT("%s%lld"), RefPrefix, (long long)Next);
	}
}

namespace AgentPanelLuaInst
{
	using namespace AgentPanel;
	using namespace AgentPanelLuaImpl;

	/** 一个实例的一行：ref、path、module、name?、byField? */
	TSharedPtr<FJsonObject> LuaInstanceRow(lua_State* L, int V, const FString& Module, const FString& Path, bool bByField, const FLuaConfig& Cfg)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("ref"), LuaRefOf(L, V));
		O->SetStringField(TEXT("path"), Path);
		O->SetStringField(TEXT("module"), Module);
		for (const FString& Field : Cfg.NameFields)
		{
			const FString Name = LuaRawText(L, V, Field);
			if (!Name.IsEmpty())
			{
				O->SetStringField(TEXT("name"), Name.Left(120));
				break;
			}
		}
		if (bByField)
		{
			O->SetBoolField(TEXT("byField"), true);
		}
		return O;
	}

	bool InstancesOp(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		lua_State* L = C.L;
		FTop Guard(L);
		lua_checkstack(L, 64);
		const double Begin = FPlatformTime::Seconds();
		// 请求里给了的项盖过设置（面板试设置时用），没给用 lua.config 存的
		FLuaConfig Cfg = LuaConfig();
		if (A->HasField(TEXT("classFields")))
		{
			Cfg.ClassFields = LuaCfgStrList(A, TEXT("classFields"));
		}
		if (A->HasField(TEXT("roots")))
		{
			Cfg.Roots = LuaCfgStrList(A, TEXT("roots"));
		}
		if (A->HasField(TEXT("nameFields")))
		{
			Cfg.NameFields = LuaCfgStrList(A, TEXT("nameFields"));
		}
		const FString ObjKey = Str(A, TEXT("objectKey"), Cfg.ObjectKey.IsEmpty() ? FString(TEXT("Object")) : Cfg.ObjectKey);
		const FString Module = Str(A, TEXT("module")).TrimStartAndEnd();
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 1000);
		FTCHARToUTF8 ObjKeyUtf8(*ObjKey);

		FLuaInstModules Mods;
		Mods.Build(L);
		const void* Target = nullptr;
		FString TargetName;
		if (!Module.IsEmpty())
		{
			const void* const* P = Mods.ByNorm.Find(NormLuaModule(Module));
			if (P == nullptr && Cfg.ClassFields.Num() == 0)
			{
				Error = FString::Printf(TEXT("Lua 模块 %s 没有加载（package.loaded 里没有）：检查模块名，或等游戏 require 它之后再找；设置里配了类名字段时没加载的也能按字段找"), *Module);
				return false;
			}
			Target = P ? *P : nullptr;
			TargetName = P ? Mods.NameOf.FindRef(*P) : Module;
		}

		FHeapWalk W;
		W.L = L;
		W.Max = FMath::Clamp(Int(A, TEXT("maxVisit"), Cfg.MaxVisit), 1000, 2000000);
		// 所有表加起来最多看这么多项（每个表 / 函数平均 10 项）；超了标 truncated，让客户端填起点变量缩小范围
		const int64 EntryBudget = static_cast<int64>(W.Max) * 10;
		int64 Entries = 0;
		lua_newtable(L);
		W.Q = lua_gettop(L);
		lua_newtable(L);
		W.Seen = lua_gettop(L);
		if (C.Map)
		{
			// UnLua 的对象表里是绑了 UObject 的实例表，lua.objects 已经能列；不往里走
			W.Block(C.Map);
		}
		TArray<TSharedPtr<FJsonValue>> Missing;
		if (Cfg.Roots.Num() > 0)
		{
			for (const FString& Root : Cfg.Roots)
			{
				if (!PushLuaRootVar(L, Root))
				{
					Missing.Add(MakeShared<FJsonValueString>(Root));
					continue;
				}
				W.Visit(0, Root);
				lua_pop(L, 1);
			}
		}
		else
		{
			lua_pushglobaltable(L);
			W.Visit(0, TEXT("_G"));
			lua_pop(L, 1);
			lua_pushvalue(L, LUA_REGISTRYINDEX);
			W.Visit(0, TEXT("<registry>"));
			lua_pop(L, 1);
		}

		TArray<TSharedPtr<FJsonValue>> Items;
		TMap<FString, int32> Counts;
		int32 Total = 0;
		bool bMore = false;
		TArray<const void*> Chain;
		for (int32 I = 1; I <= W.Count; ++I)
		{
			lua_rawgeti(L, W.Q, I);
			const int V = lua_gettop(L);
			if (lua_istable(L, V))
			{
				const void* VP = lua_topointer(L, V);
				// 模块表自己是类，不是实例；UnLua 绑了 UObject 的实例表归 lua.objects
				bool bInstance = !Mods.NameOf.Contains(VP);
				if (bInstance)
				{
					lua_pushstring(L, ObjKeyUtf8.Get());
					lua_rawget(L, V);
					bInstance = lua_type(L, -1) != LUA_TUSERDATA;
					lua_pop(L, 1);
				}
				bool bByField = false;
				const FString Cls = bInstance ? Mods.ClassOf(L, V, Cfg, Chain, bByField) : FString();
				if (!Cls.IsEmpty())
				{
					const bool bHit = Module.IsEmpty() || (Target != nullptr && Chain.Contains(Target)) || NormLuaModule(Cls) == NormLuaModule(Module);
					if (bHit)
					{
						++Total;
						Counts.FindOrAdd(Cls)++;
						if (!Module.IsEmpty())
						{
							if (Items.Num() < Limit)
							{
								Items.Add(MakeShared<FJsonValueObject>(LuaInstanceRow(L, V, Cls, W.PathOf(I), bByField, Cfg)));
							}
							else
							{
								bMore = true;
							}
						}
					}
				}
				const FString Mode = WeakMode(L, V);
				const bool bWeakK = Mode.Contains(TEXT("k"));
				const bool bWeakV = Mode.Contains(TEXT("v"));
				int32 N = 0;
				lua_pushnil(L);
				while (lua_next(L, V))
				{
					// 只有表和函数会排进队列：别的值不算路径段（KeySeg 要拼字符串，大数组表每项都算会很慢）
					const int VT = lua_type(L, -1);
					if (!bWeakV && (VT == LUA_TTABLE || VT == LUA_TFUNCTION))
					{
						lua_pushvalue(L, -2);
						const FString Seg = KeySeg(L, -1);
						lua_pop(L, 1);
						W.Visit(I, Seg);
					}
					const int KT = lua_type(L, -2);
					if (!bWeakK && (KT == LUA_TTABLE || KT == LUA_TFUNCTION))
					{
						lua_pushvalue(L, -2);
						W.Visit(I, TEXT("[<key>]"));
						lua_pop(L, 1);
					}
					lua_pop(L, 1);
					// 整次查找的项数预算（2.20.1，#95 评审）：在游戏线程上同步跑，几张十万项的大表不能把一帧拖到几秒
					++Entries;
					if (++N >= 100000 || Entries >= EntryBudget)
					{
						if (Entries >= EntryBudget)
						{
							W.bTruncated = true;
						}
						lua_pop(L, 1);
						break;
					}
				}
				if (lua_getmetatable(L, V))
				{
					W.Visit(I, TEXT("<metatable>"));
					lua_pop(L, 1);
				}
			}
			else if (lua_isfunction(L, V))
			{
				// 模块顶部 local 存的表（local Instances = {}）只有经函数的 upvalue 才走得到
				for (int U = 1; U <= 255; ++U)
				{
					const char* Name = lua_getupvalue(L, V, U);
					if (!Name)
					{
						break;
					}
					W.Visit(I, FString::Printf(TEXT("<upvalue %s>"), UTF8_TO_TCHAR(Name[0] ? Name : "?")));
					lua_pop(L, 1);
				}
			}
			lua_settop(L, V - 1);
		}

		if (Module.IsEmpty())
		{
			// 不给模块：按类数个数（Lua 页的「纯 Lua 实例」分组用），多的在前
			Counts.ValueSort([](int32 X, int32 Y) { return X > Y; });
			for (const TPair<FString, int32>& Pair : Counts)
			{
				if (Items.Num() >= Limit)
				{
					bMore = true;
					break;
				}
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("module"), Pair.Key);
				O->SetNumberField(TEXT("count"), Pair.Value);
				Items.Add(MakeShared<FJsonValueObject>(O));
			}
		}
		else
		{
			Out->SetStringField(TEXT("module"), TargetName);
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
		Out->SetBoolField(TEXT("more"), bMore);
		Out->SetNumberField(TEXT("visited"), W.Count);
		Out->SetBoolField(TEXT("truncated"), W.bTruncated);
		Out->SetNumberField(TEXT("ms"), FMath::RoundToDouble((FPlatformTime::Seconds() - Begin) * 1000.0));
		if (Missing.Num() > 0)
		{
			Out->SetArrayField(TEXT("rootsMissing"), Missing);
		}
		return true;
	}

	bool ConfigOp(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		LuaConfig();
		const TSharedPtr<FJsonObject>* Set = nullptr;
		if (A->TryGetObjectField(TEXT("set"), Set) && Set != nullptr && Set->IsValid())
		{
			GLuaConfig = LuaCfgFromJson(*Set);
			const FString File = LuaCfgFile();
			FString Text;
			const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Text);
			FJsonSerializer::Serialize(LuaCfgToJson(GLuaConfig), Writer);
			if (!FFileHelper::SaveStringToFile(Text, *File, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
			{
				Error = FString::Printf(TEXT("Lua 设置写不进 %s：看看 Saved 目录是不是只读"), *File);
				return false;
			}
		}
		Out->SetObjectField(TEXT("config"), LuaCfgToJson(GLuaConfig));
		Out->SetStringField(TEXT("file"), LuaCfgFile());
		return true;
	}
}

void AgentPanelRegisterLuaInstanceOps(FAgentPanelBridge& B)
{
	B.AddOp(TEXT("lua.instances"), &AgentPanelLuaInst::InstancesOp);
	B.AddOp(TEXT("lua.config"), &AgentPanelLuaInst::ConfigOp);
}

#endif
