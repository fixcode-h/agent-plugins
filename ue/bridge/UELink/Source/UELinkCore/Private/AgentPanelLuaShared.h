// Lua 操作共用的内部工具（只给 UELinkCore 里的 Lua 操作文件用，不对外）：拿 lua_State、对象表、沿路径取值、
// 把 Lua 值描述成 JSON、受保护的读写和调用。定义在 AgentPanelLua.cpp；2.4 起 Lua 的新操作各放自己的 *Ops.cpp，
// include 这个头复用，不往 AgentPanelLua.cpp 里堆。没编进 Lua 支持时这个头是空的。
#pragma once

#include "CoreMinimal.h"

#if AGENT_PANEL_WITH_LUA

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "lua.hpp"

class UObject;
class UObjectBase;
class UWorld;

namespace AgentPanelLuaImpl
{
	/** 一层表最多列多少项（再多的分页取）；扫描超过这么多项只排前面这些 */
	constexpr int32 MaxScan = 5000;
	/** 字符串值最多回多少字符 */
	constexpr int32 MaxStr = 2000;

	FString FromUtf8(const char* S, size_t N);
	void PushStr(lua_State* L, const FString& S);

	/** 退出作用域时把 Lua 栈恢复原样：中途出错 return 也不会留垃圾在 UnLua 的主线程栈上 */
	struct FTop
	{
		lua_State* L;
		int Top;
		explicit FTop(lua_State* InL) : L(InL), Top(lua_gettop(InL)) {}
		~FTop() { lua_settop(L, Top); }
	};

	/** UObject 指针还活着（对象表里的键可能是已经销毁的对象） */
	UObject* LiveObject(const void* P);
	/** 按对象（或目标世界的 GameInstance）选 Lua 环境：项目的 SetStateProvider 优先，再按 UnLua 的接口自动选 */
	lua_State* StateFor(UObject* Context, FString& Error);
	/** 世界还在引擎的世界列表里、没在拆（AgentPanelLuaObjects.cpp） */
	bool IsLiveWorld(const UWorld* W);
	/**
	 * 现在活着的全部 UObject 的地址（AgentPanelLuaObjects.cpp）。对象表里的键可能是已经释放的地址：
	 * 先在这张表里查到了才当成对象去读，不能直接调 GUObjectArray.IsValid（它会先读对象自己的内存）
	 */
	TSet<const UObjectBase*> CollectLiveObjects();
	/** 请求里 world 指的世界的 GameInstance */
	UObject* WorldContext(const TSharedPtr<FJsonObject>& A);
	/** 找到的对象表在注册表里的键，按 lua_State 记住 */
	TMap<lua_State*, FString>& MapKeys();
	/** 把 UnLua 的对象表（UObject 指针 → 实例表）压栈；没有时什么也不压，返回 false */
	bool PushObjectMap(lua_State* L);

	/** 一次请求里用到的 Lua 上下文：对象表、值→对象、模块表→模块名的反查（按需建一次） */
	struct FLuaCtx
	{
		lua_State* L = nullptr;
		int Map = 0;
		bool bRev = false;
		TMap<const void*, const void*> Rev;
		bool bMods = false;
		TMap<const void*, FString> Mods;

		/**
		 * Open 压在栈上的对象表在用完时弹掉（2.8 起）：以前每次操作都在主线程栈上留一格，
		 * GameTest 回放时每帧读条目的 Lua 字段，不弹会一直往上涨
		 */
		~FLuaCtx()
		{
			if (L && Map && lua_gettop(L) >= Map)
			{
				lua_settop(L, Map - 1);
			}
		}

		bool Open(UObject* Context, FString& Error)
		{
			L = StateFor(Context, Error);
			if (!L)
			{
				return false;
			}
			if (PushObjectMap(L))
			{
				Map = lua_gettop(L);
			}
			return true;
		}

		bool bRegNames = false;
		TMap<const void*, FString> RegNames;

		/**
		 * 注册表里「字符串键 → 表」的反查（2.19）：UnLua 给 UE 类建的元表按类名放在注册表里（luaL_newmetatable），
		 * 元表链上不是模块的那几层靠它认出是哪个 UE 类。只读注册表，不碰 UnLua 的内部结构
		 */
		FString RegistryNameOf(const void* P)
		{
			if (!bRegNames)
			{
				bRegNames = true;
				FTop Guard(L);
				lua_pushnil(L);
				while (lua_next(L, LUA_REGISTRYINDEX))
				{
					if (lua_type(L, -2) == LUA_TSTRING && lua_istable(L, -1))
					{
						size_t N = 0;
						const char* S = lua_tolstring(L, -2, &N);
						RegNames.Add(lua_topointer(L, -1), FromUtf8(S, N));
					}
					lua_pop(L, 1);
				}
			}
			const FString* Name = RegNames.Find(P);
			return Name ? *Name : FString();
		}

		/** 表 / userdata 是哪个 UObject 的（对象表里反查） */
		UObject* ObjectOf(int Idx)
		{
			if (!Map)
			{
				return nullptr;
			}
			if (!bRev)
			{
				bRev = true;
				int32 N = 0;
				lua_pushnil(L);
				while (lua_next(L, Map))
				{
					const int VT = lua_type(L, -1);
					if (lua_type(L, -2) == LUA_TLIGHTUSERDATA && (VT == LUA_TTABLE || VT == LUA_TUSERDATA))
					{
						Rev.Add(lua_topointer(L, -1), lua_touserdata(L, -2));
					}
					lua_pop(L, 1);
					if (++N >= 500000)
					{
						lua_pop(L, 1);
						break;
					}
				}
			}
			const void* const* P = Rev.Find(lua_topointer(L, Idx));
			return P ? LiveObject(*P) : nullptr;
		}

		FString ModuleOfTable(const void* P)
		{
			if (!bMods)
			{
				bMods = true;
				lua_getfield(L, LUA_REGISTRYINDEX, LUA_LOADED_TABLE);
				if (lua_istable(L, -1))
				{
					lua_pushnil(L);
					while (lua_next(L, -2))
					{
						if (lua_type(L, -2) == LUA_TSTRING && lua_istable(L, -1))
						{
							size_t N = 0;
							const char* S = lua_tolstring(L, -2, &N);
							Mods.Add(lua_topointer(L, -1), FromUtf8(S, N));
						}
						lua_pop(L, 1);
					}
				}
				lua_pop(L, 1);
			}
			const FString* Name = Mods.Find(P);
			return Name ? *Name : FString();
		}

		/** 实例表的模块名：元表本身、元表的 __index、元表的元表，哪个在 package.loaded 里就是哪个 */
		FString ModuleOf(int Idx)
		{
			FTop Guard(L);
			if (!lua_getmetatable(L, Idx))
			{
				return FString();
			}
			const int MT = lua_gettop(L);
			FString Name = ModuleOfTable(lua_topointer(L, MT));
			if (Name.IsEmpty())
			{
				lua_pushstring(L, "__index");
				lua_rawget(L, MT);
				if (lua_istable(L, -1))
				{
					Name = ModuleOfTable(lua_topointer(L, -1));
				}
				lua_pop(L, 1);
			}
			if (Name.IsEmpty() && lua_getmetatable(L, MT))
			{
				Name = ModuleOfTable(lua_topointer(L, -1));
				lua_pop(L, 1);
			}
			// UnLua 2.x 绑定时给类建的元表不一定就是 package.loaded 里那张（实测官方 2.x 的 TPS 示例就对不上）：按里面 Lua 函数的文件推模块名
			if (Name.IsEmpty())
			{
				Name = ModuleFromSource(MT);
			}
			return Name;
		}

		/**
		 * 表里第一个 Lua 函数定义在哪个文件，按文件推模块名：.../Script/AI/BP_X_C.lua → AI.BP_X_C（UnLua 默认的脚本根是 Content/Script）。
		 * 没有 Lua 函数（UE 类的元表全是 C 函数）或者路径里没有 Script 目录时返回空
		 */
		FString ModuleFromSource(int T)
		{
			FTop Guard(L);
			const int Abs = lua_absindex(L, T);
			FString Src;
			lua_pushnil(L);
			while (Src.IsEmpty() && lua_next(L, Abs))
			{
				if (lua_isfunction(L, -1) && !lua_iscfunction(L, -1))
				{
					lua_Debug Ar;
					lua_pushvalue(L, -1);
					if (lua_getinfo(L, ">S", &Ar) && Ar.source)
					{
						Src = UTF8_TO_TCHAR(Ar.source);
					}
				}
				lua_pop(L, 1);
			}
			if (Src.IsEmpty())
			{
				return FString();
			}
			Src.RemoveFromStart(TEXT("@"));
			Src.ReplaceInline(TEXT("\\"), TEXT("/"));
			int32 At = Src.Find(TEXT("/Script/"), ESearchCase::IgnoreCase, ESearchDir::FromEnd);
			int32 Skip = 8;
			if (At == INDEX_NONE)
			{
				At = Src.Find(TEXT("/Scripts/"), ESearchCase::IgnoreCase, ESearchDir::FromEnd);
				Skip = 9;
			}
			if (At == INDEX_NONE || !Src.EndsWith(TEXT(".lua"), ESearchCase::IgnoreCase))
			{
				return FString();
			}
			FString Mod = Src.Mid(At + Skip, Src.Len() - At - Skip - 4);
			Mod.ReplaceInline(TEXT("/"), TEXT("."));
			return Mod;
		}
	};

	/** 实现了 UnLuaInterface 的对象：按反射调 GetModuleName */
	FString InterfaceModule(UObject* Obj);
	/** 弹出栈顶的错误信息 */
	FString PopError(lua_State* L);
	/** t[k]，T 是表 / userdata 的绝对位置，键在栈顶；成功时键换成值（走 pcall，元方法报错只变成 Error） */
	bool PGet(lua_State* L, int T, FString& Error);
	/** t[k] = v，键和值在栈顶（键在下），完成后两者都出栈 */
	bool PSet(lua_State* L, int T, FString& Error);
	bool PushJsonKey(lua_State* L, const TSharedPtr<FJsonValue>& K);
	FString KeyText(const TSharedPtr<FJsonValue>& K);
	/** 压起点：给了对象是它的实例表，没给是 _G */
	bool PushRoot(FLuaCtx& C, const FString& Path, UObject* Obj, FString& Error);
	/** 从栈顶的值沿 Keys 的前 Count 段往下走，栈顶换成最后的值 */
	bool Walk(FLuaCtx& C, const TArray<TSharedPtr<FJsonValue>>& Keys, int32 Count, FString& Error);
	int32 CountEntries(lua_State* L, int T, int32 Cap, bool& bMore);
	/** 一个 Lua 值的描述：t、v、n、obj、module、src（见 lua.get） */
	void Describe(FLuaCtx& C, int Idx, const TSharedPtr<FJsonObject>& F);
	void DescribeKey(lua_State* L, int Idx, const TSharedPtr<FJsonObject>& F);
	/** 列一张表的项（排序、分页），写 fields / total / offset / more / truncated */
	void ListTable(FLuaCtx& C, int T, int32 Offset, int32 Limit, const TSharedPtr<FJsonObject>& Out);
	/** 元表链上的函数（最多三层），写 functions */
	void ListFunctions(FLuaCtx& C, int T, const TSharedPtr<FJsonObject>& Out);
	/** JSON 标量 → Lua；bPrevFloat：原来是小数时整数值也按小数写 */
	bool PushJsonValue(lua_State* L, const TSharedPtr<FJsonValue>& V, bool bPrevFloat, FString& Error);
	/** 任意 JSON → Lua：对象、数组转成表（数组下标从 1 开始），最多嵌套 Depth 层 */
	bool PushJsonAny(lua_State* L, const TSharedPtr<FJsonValue>& V, int32 Depth, FString& Error);
	/** 标量的 JSON；表、函数这些返回空 */
	TSharedPtr<FJsonValue> ScalarJson(lua_State* L, int Idx);
	TArray<TSharedPtr<FJsonValue>> KeysOf(const TSharedPtr<FJsonObject>& A);
	/** 有对象路径时找对象（Lua 环境按对象选），没有时按目标世界选 */
	bool OpenFor(const TSharedPtr<FJsonObject>& A, FLuaCtx& C, UObject*& Obj, FString& Error);

	// 执行 Lua：超时钩子和收 print 的输出（lua.exec、lua.call 共用）
	extern double GDeadline;
	void TimeoutHook(lua_State* L, lua_Debug* Ar);
	/** 执行完放回原来的钩子；执行期间 IDE 的 Lua 调试器换过钩子（还在用 TimeoutHook 以外的）就不动，免得把它新挂的盖掉 */
	void RestoreHookAfterTimeout(lua_State* L, lua_Hook OldHook, int OldMask, int OldCount);
	extern TArray<FString>* GPrintSink;
	int PrintFn(lua_State* L);
	int TracebackFn(lua_State* L);

	// 走 Lua 堆（2.20 起 lua.leaks、lua.instances 共用；KeySeg、WeakMode 定义在 AgentPanelLuaDebugOps.cpp）
	/** 引用链上的一段：字符串键写成 .name，别的写成 [值]，upvalue、元表写成 <...> */
	FString KeySeg(lua_State* L, int K);
	/** 表的 __mode（弱表）；不是弱表为空 */
	FString WeakMode(lua_State* L, int T);

	/** 从 _G 和注册表出发广度优先走一遍 Lua 堆，记下每个表 / 函数第一次是从哪条路走到的 */
	struct FHeapWalk
	{
		lua_State* L = nullptr;
		int Q = 0;
		int Seen = 0;
		int32 Max = 200000;
		int32 Count = 0;
		bool bTruncated = false;
		TArray<int32> Parent;
		TArray<FString> Seg;

		/** 栈顶的值没见过就排进队列（值留在栈上不动） */
		void Visit(int32 From, const FString& Key)
		{
			const int T = lua_type(L, -1);
			if (T != LUA_TTABLE && T != LUA_TFUNCTION)
			{
				return;
			}
			lua_pushvalue(L, -1);
			lua_rawget(L, Seen);
			const bool bSeen = !lua_isnil(L, -1);
			lua_pop(L, 1);
			if (bSeen)
			{
				return;
			}
			if (Count >= Max)
			{
				bTruncated = true;
				return;
			}
			++Count;
			lua_pushvalue(L, -1);
			lua_pushinteger(L, Count);
			lua_rawset(L, Seen);
			lua_pushvalue(L, -1);
			lua_rawseti(L, Q, Count);
			Parent.Add(From);
			Seg.Add(Key);
		}

		/** 不算引用来源的表（对象表本身）：先记成见过，不往里走 */
		void Block(int Idx)
		{
			lua_pushvalue(L, Idx);
			lua_pushinteger(L, 0);
			lua_rawset(L, Seen);
		}

		FString PathOf(int32 I) const
		{
			TArray<const FString*> Parts;
			for (int32 Cur = I; Cur >= 1 && Parts.Num() < 40; Cur = Parent[Cur - 1])
			{
				Parts.Add(&Seg[Cur - 1]);
			}
			FString Out;
			for (int32 K = Parts.Num() - 1; K >= 0; --K)
			{
				Out += *Parts[K];
			}
			return Out;
		}
	};

	// 纯 Lua 实例（2.20，AgentPanelLuaInstances.cpp）
	/** 对象路径写成 luaref:<编号> 时指的是 lua.instances 找到的纯 Lua 表，不是 UObject */
	bool IsLuaRef(const FString& Path);
	/** 把 luaref 指的表压栈；表已经被回收时返回 false 并写清原因 */
	bool PushLuaRef(lua_State* L, const FString& Path, FString& Error);
	/** 给栈上 Idx 处的表发一个 luaref（同一张表总是同一个编号；弱引用，不挡回收） */
	FString LuaRefOf(lua_State* L, int Idx);

	/** 面板下发的 Lua 设置（lua.config，存 Saved/UELink/lua-config.json）：各项留空 = 自动 */
	struct FLuaConfig
	{
		/** 脚本根（相对项目目录或绝对路径）；空 = Content/Script */
		FString ScriptRoot;
		/** UnLua 实例表里放 UObject 的字段名；空 = Object */
		FString ObjectKey;
		/** 纯 Lua 实例上写着自己类（模块路径）的字段，如 SubModulePath */
		TArray<FString> ClassFields;
		/** 从哪些变量开始找纯 Lua 实例（_G.GameApp 这种点路径）；空 = 从 _G 和注册表走整个堆 */
		TArray<FString> Roots;
		/** 纯 Lua 实例的显示名字段，如 SubModuleName */
		TArray<FString> NameFields;
		/** 走堆最多看多少个表 / 函数 */
		int32 MaxVisit = 200000;
	};
	const FLuaConfig& LuaConfig();
}

#endif
