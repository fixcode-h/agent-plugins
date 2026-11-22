// 2.4：Lua 改完能验、运行时看对象（设计稿「UE 插件优化与扩展」二 P0、四.1）。
// - lua.check：在单独新建的 lua_State 里只编译不执行，不开游戏也能查语法
// - lua.reload：项目的 SetReloader 优先；没接时清 package.loaded 再 require，把新函数拷回旧模块表（已绑定的对象也用上新函数）
// - lua.modules：package.loaded 里的模块、对应文件、绑定对象数、文件改过没重载
// - lua.errors：Lua 报错按「消息 + 出错位置」归并；项目调 CaptureError 时带局部变量，否则从日志里认
// - lua.inspect：字段、自己的和继承来的函数（带参数名）、元表链、upvalue
// - lua.call：按路径调 Lua 函数（可带 self），参数是 JSON
// 只用 Lua 的 C 接口；和 UnLua 版本有关的只有拿 lua_State（见 AgentPanelLua.cpp）和热重载、报错入口（项目侧接入）。
#include "AgentPanelLua.h"
#include "AgentPanelLuaOps.h"

#include "AgentPanelBridge.h"

static TFunction<bool(lua_State*, const FString&, FString&)>& LuaReloader()
{
	static TFunction<bool(lua_State*, const FString&, FString&)> Reloader;
	return Reloader;
}

void FAgentPanelLua::SetReloader(TFunction<bool(lua_State* L, const FString& Module, FString& Error)> Reloader)
{
	LuaReloader() = MoveTemp(Reloader);
}

#if !AGENT_PANEL_WITH_LUA

void FAgentPanelLua::CaptureError(lua_State*, const FString&) {}
void AgentPanelRegisterLuaDevOps(FAgentPanelBridge&) {}

#else

#include "AgentPanelBridgeUtil.h"
#include "AgentPanelLog.h"
#include "AgentPanelLuaShared.h"
#include "AgentPanelLuaTrace.h"
#include "Containers/Ticker.h"
#include "HAL/FileManager.h"
#include "Internationalization/Regex.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "UObject/Class.h"
#include "UObject/UObjectGlobals.h"

namespace AgentPanelLuaDev
{
	using namespace AgentPanel;
	using namespace AgentPanelLuaImpl;

	FString Iso(const FDateTime& T)
	{
		return T.ToIso8601();
	}

	/** Lua 报错里的位置：先找 xxx.lua:行号，再找 [string "..."]:行号 */
	FString FindWhere(const FString& Text)
	{
		FRegexMatcher M(FRegexPattern(TEXT("([^\\s:\"'\\[\\]]+\\.lua):(\\d+)")), Text);
		if (M.FindNext())
		{
			return M.GetCaptureGroup(1) + TEXT(":") + M.GetCaptureGroup(2);
		}
		FRegexMatcher S(FRegexPattern(TEXT("\\[string \"([^\"]+)\"\\]:(\\d+)")), Text);
		if (S.FindNext())
		{
			return S.GetCaptureGroup(1) + TEXT(":") + S.GetCaptureGroup(2);
		}
		return FString();
	}

	// ---------- 报错归并 ----------

	struct FLuaError
	{
		FString Id;
		FString Message;
		FString Where;
		int32 Count = 0;
		FDateTime First;
		FDateTime Last;
		TArray<FString> Stack;
		TArray<TSharedPtr<FJsonValue>> Locals;
		FString Source;
		uint64 Seq = 0;
	};

	struct FErrorStore
	{
		FCriticalSection Lock;
		TArray<FLuaError> Items;
		uint64 Seq = 0;
		/** 日志里认到哪一行了 */
		uint64 LogCursor = 0;
		/** 有新报错还没推事件 */
		int32 Unpublished = 0;
	};

	FErrorStore& Errors()
	{
		static FErrorStore Store;
		return Store;
	}

	/** 归并的键：位置 + 去掉位置前缀的消息 */
	FString ErrorKey(const FString& Message, const FString& Where)
	{
		FString First = Message;
		int32 Nl = INDEX_NONE;
		if (First.FindChar(TEXT('\n'), Nl))
		{
			First.LeftInline(Nl);
		}
		if (!Where.IsEmpty())
		{
			const int32 At = First.Find(Where);
			if (At != INDEX_NONE)
			{
				First = First.Mid(At + Where.Len());
				First.RemoveFromStart(TEXT(":"));
			}
		}
		return Where + TEXT("|") + First.TrimStartAndEnd();
	}

	void AddError(const FString& RawMessage, TArray<FString> Stack, TArray<TSharedPtr<FJsonValue>> Locals, const FString& Source)
	{
		FString Message = RawMessage.TrimStartAndEnd().Left(4000);
		if (Message.IsEmpty())
		{
			return;
		}
		FString Where = FindWhere(Message);
		if (Where.IsEmpty())
		{
			for (const FString& Line : Stack)
			{
				Where = FindWhere(Line);
				if (!Where.IsEmpty())
				{
					break;
				}
			}
		}
		const FString Key = ErrorKey(Message, Where);
		const FDateTime Now = FDateTime::UtcNow();
		FErrorStore& S = Errors();
		FScopeLock Guard(&S.Lock);
		for (FLuaError& E : S.Items)
		{
			if (ErrorKey(E.Message, E.Where) != Key)
			{
				continue;
			}
			// 项目接了 CaptureError 时同一次报错日志里通常也有一份：两秒内日志来的同一条不重复计数
			if (Source == TEXT("log") && E.Source == TEXT("capture") && (Now - E.Last).GetTotalSeconds() < 2.0)
			{
				return;
			}
			++E.Count;
			E.Last = Now;
			E.Seq = ++S.Seq;
			if (Source == TEXT("capture") || E.Stack.Num() == 0)
			{
				E.Stack = MoveTemp(Stack);
				E.Locals = MoveTemp(Locals);
				E.Source = Source;
			}
			++S.Unpublished;
			return;
		}
		FLuaError E;
		E.Id = FString::Printf(TEXT("e%llu"), (unsigned long long)(S.Seq + 1));
		E.Message = Message;
		E.Where = Where;
		E.Count = 1;
		E.First = Now;
		E.Last = Now;
		E.Stack = MoveTemp(Stack);
		E.Locals = MoveTemp(Locals);
		E.Source = Source;
		E.Seq = ++S.Seq;
		S.Items.Add(MoveTemp(E));
		// 最多留 200 条，挤掉最久没再出现的
		if (S.Items.Num() > 200)
		{
			int32 Oldest = 0;
			for (int32 I = 1; I < S.Items.Num(); ++I)
			{
				if (S.Items[I].Last < S.Items[Oldest].Last)
				{
					Oldest = I;
				}
			}
			S.Items.RemoveAt(Oldest);
		}
		++S.Unpublished;
	}

	bool IsContinuation(const FString& Text)
	{
		return Text.StartsWith(TEXT("\t")) || Text.StartsWith(TEXT("stack traceback")) || Text.StartsWith(TEXT("  "));
	}

	/**
	 * 日志兜底：分类名带 Lua 的 Error 行，或文字里有 LuaError / stack traceback 的行算一次报错；
	 * 紧跟着的缩进行（UnLua 把调用栈一行一行打）算它的调用栈。只看上次之后的新行
	 */
	void ScanLog()
	{
		TArray<FAgentPanelLog::FEntry> Entries;
		int64 Dropped = 0;
		uint64 Cursor = 0;
		{
			FErrorStore& S = Errors();
			FScopeLock Guard(&S.Lock);
			Cursor = S.LogCursor;
		}
		const uint64 Next = FAgentPanelLog::Get().EntriesSince(Cursor, 4000, Entries, Dropped);
		{
			FErrorStore& S = Errors();
			FScopeLock Guard(&S.Lock);
			S.LogCursor = Next;
		}
		FString Msg;
		TArray<FString> Stack;
		FName Cat;
		auto Flush = [&]()
		{
			if (!Msg.IsEmpty())
			{
				AddError(Msg, MoveTemp(Stack), {}, TEXT("log"));
			}
			Msg.Reset();
			Stack.Reset();
		};
		for (const FAgentPanelLog::FEntry& E : Entries)
		{
			if (!Msg.IsEmpty() && E.Category == Cat && IsContinuation(E.Text))
			{
				if (Stack.Num() < 40)
				{
					Stack.Add(E.Text.TrimStartAndEnd());
				}
				continue;
			}
			Flush();
			const bool bLuaCat = E.Category.ToString().Contains(TEXT("Lua"));
			const bool bErr = E.Verbosity == ELogVerbosity::Error || E.Verbosity == ELogVerbosity::Fatal;
			if ((bLuaCat && bErr) || E.Text.Contains(TEXT("LuaError")) || E.Text.Contains(TEXT("stack traceback")))
			{
				// 一条日志里就带了整段调用栈的：第一行是消息，其余是栈
				TArray<FString> Lines;
				E.Text.ParseIntoArrayLines(Lines);
				if (Lines.Num() == 0)
				{
					continue;
				}
				Msg = Lines[0];
				Cat = E.Category;
				for (int32 I = 1; I < Lines.Num() && Stack.Num() < 40; ++I)
				{
					const FString L = Lines[I].TrimStartAndEnd();
					if (!L.IsEmpty() && L != TEXT("stack traceback:"))
					{
						Stack.Add(L);
					}
				}
			}
		}
		Flush();
	}

	/** 出错那一帧的局部变量：跳过 C 函数（错误处理函数本身、error），取第一层 Lua 函数 */
	TArray<TSharedPtr<FJsonValue>> CaptureLocals(lua_State* L)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		lua_Debug Ar;
		for (int Level = 0; Level < 12 && lua_getstack(L, Level, &Ar); ++Level)
		{
			if (!lua_getinfo(L, "S", &Ar) || !Ar.what || FCStringAnsi::Strcmp(Ar.what, "C") == 0)
			{
				continue;
			}
			FLuaCtx C;
			C.L = L;
			for (int I = 1; I <= 60 && Out.Num() < 40; ++I)
			{
				const char* Name = lua_getlocal(L, &Ar, I);
				if (!Name)
				{
					break;
				}
				if (Name[0] != '(')
				{
					TSharedPtr<FJsonObject> V = MakeShared<FJsonObject>();
					V->SetStringField(TEXT("name"), UTF8_TO_TCHAR(Name));
					Describe(C, -1, V);
					Out.Add(MakeShared<FJsonValueObject>(V));
				}
				lua_pop(L, 1);
			}
			break;
		}
		return Out;
	}

	TArray<TSharedPtr<FJsonValue>> ErrorJson(uint64 Since, int32 Limit)
	{
		FErrorStore& S = Errors();
		FScopeLock Guard(&S.Lock);
		TArray<const FLuaError*> Sorted;
		for (const FLuaError& E : S.Items)
		{
			if (E.Seq > Since)
			{
				Sorted.Add(&E);
			}
		}
		Sorted.Sort([](const FLuaError& A, const FLuaError& B) { return A.Last > B.Last; });
		TArray<TSharedPtr<FJsonValue>> Items;
		for (const FLuaError* E : Sorted)
		{
			if (Items.Num() >= Limit)
			{
				break;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("id"), E->Id);
			O->SetStringField(TEXT("message"), E->Message);
			if (!E->Where.IsEmpty())
			{
				O->SetStringField(TEXT("where"), E->Where);
			}
			O->SetNumberField(TEXT("count"), E->Count);
			O->SetStringField(TEXT("first"), Iso(E->First));
			O->SetStringField(TEXT("last"), Iso(E->Last));
			TArray<TSharedPtr<FJsonValue>> Stack;
			for (const FString& L : E->Stack)
			{
				Stack.Add(MakeShared<FJsonValueString>(L));
			}
			O->SetArrayField(TEXT("stack"), Stack);
			if (E->Locals.Num())
			{
				O->SetArrayField(TEXT("locals"), E->Locals);
			}
			O->SetStringField(TEXT("source"), E->Source);
			O->SetNumberField(TEXT("seq"), (double)E->Seq);
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		return Items;
	}

	/** 每秒认一次日志里的新报错；有新报错推 uelink.luaErrors（只带序号和条数，网页收到再调 lua.errors），网页不用轮询 */
	bool TickErrors(float)
	{
		ScanLog();
		int32 Count = 0;
		uint64 Seq = 0;
		{
			FErrorStore& S = Errors();
			FScopeLock Guard(&S.Lock);
			Count = S.Unpublished;
			Seq = S.Seq;
			S.Unpublished = 0;
		}
		if (Count > 0)
		{
			TSharedRef<FJsonObject> E = MakeShared<FJsonObject>();
			E->SetNumberField(TEXT("seq"), (double)Seq);
			E->SetNumberField(TEXT("count"), Count);
			FAgentPanelBridge::Get().PublishEvent(TEXT("uelink.luaErrors"), E);
		}
		return true;
	}

	// ---------- 模块 ----------

	/** 模块名 → 桥接重载它的时间（bReloaded）或第一次看到它的时间 */
	struct FLoadMark
	{
		FDateTime At;
		bool bReloaded = false;
	};

	TMap<FString, FLoadMark>& LoadMarks()
	{
		static TMap<FString, FLoadMark> Marks;
		return Marks;
	}

	bool IsStdModule(const FString& Name)
	{
		static const TSet<FString> Std = { TEXT("_G"), TEXT("package"), TEXT("coroutine"), TEXT("table"), TEXT("io"), TEXT("os"),
			TEXT("string"), TEXT("math"), TEXT("utf8"), TEXT("debug"), TEXT("bit32") };
		return Std.Contains(Name);
	}

	/** 脚本根目录：参数给的（相对项目目录），默认 Content/Script（UnLua 的默认位置） */
	FString ScriptRoot(const TSharedPtr<FJsonObject>& A)
	{
		// 请求没给时用面板下发的 Lua 设置（lua.config）里的脚本根
		const FString Root = Str(A, TEXT("root"), LuaConfig().ScriptRoot);
		if (Root.IsEmpty())
		{
			return FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir() / TEXT("Script"));
		}
		return FPaths::IsRelative(Root) ? FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / Root) : Root;
	}

	/** Lua 函数定义所在的文件（source 以 @ 开头的才是文件），取不到为空 */
	FString FunctionFile(lua_State* L, int Idx)
	{
		lua_Debug Ar;
		lua_pushvalue(L, Idx);
		if (!lua_getinfo(L, ">S", &Ar) || !Ar.source || Ar.source[0] != '@')
		{
			return FString();
		}
		return UTF8_TO_TCHAR(Ar.source + 1);
	}

	struct FModuleInfo
	{
		FString Name;
		FString File;
		const void* Table = nullptr;
		int32 Objects = 0;
		FDateTime LoadedAt;
		bool bGuess = true;
		FDateTime Modified;
		bool bHasFile = false;
		bool bStale = false;
	};

	/** 模块文件：模块里第一个 Lua 函数的定义文件（存在才算），否则按模块名在脚本根目录下找 */
	FString ModuleFile(lua_State* L, int T, const FString& Name, const FString& Root)
	{
		int32 Seen = 0;
		lua_pushnil(L);
		while (lua_next(L, T))
		{
			if (lua_isfunction(L, -1) && !lua_iscfunction(L, -1))
			{
				FString F = FunctionFile(L, lua_gettop(L));
				if (!F.IsEmpty())
				{
					if (FPaths::IsRelative(F))
					{
						F = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / F);
					}
					if (IFileManager::Get().FileExists(*F))
					{
						lua_pop(L, 2);
						return F;
					}
				}
			}
			lua_pop(L, 1);
			if (++Seen >= 200)
			{
				lua_pop(L, 1);
				break;
			}
		}
		const FString Guess = Root / Name.Replace(TEXT("."), TEXT("/")) + TEXT(".lua");
		return IFileManager::Get().FileExists(*Guess) ? Guess : FString();
	}

	TArray<FModuleInfo> CollectModules(FLuaCtx& C, const FString& Root, const FString& Filter)
	{
		lua_State* L = C.L;
		FTop Guard(L);
		TArray<FModuleInfo> Mods;
		TMap<const void*, int32> ByTable;
		const FDateTime Now = FDateTime::UtcNow();
		lua_getfield(L, LUA_REGISTRYINDEX, LUA_LOADED_TABLE);
		const int Loaded = lua_gettop(L);
		if (!lua_istable(L, Loaded))
		{
			return Mods;
		}
		lua_pushnil(L);
		while (lua_next(L, Loaded))
		{
			if (lua_type(L, -2) == LUA_TSTRING && lua_istable(L, -1))
			{
				size_t N = 0;
				const char* S = lua_tolstring(L, -2, &N);
				const FString Name = FromUtf8(S, N);
				if (!IsStdModule(Name) && (Filter.IsEmpty() || Name.Contains(Filter, ESearchCase::IgnoreCase)))
				{
					FModuleInfo M;
					M.Name = Name;
					M.Table = lua_topointer(L, -1);
					M.File = ModuleFile(L, lua_gettop(L), Name, Root);
					FLoadMark& Mark = LoadMarks().FindOrAdd(Name);
					if (Mark.At.GetTicks() == 0)
					{
						Mark.At = Now;
					}
					M.LoadedAt = Mark.At;
					M.bGuess = !Mark.bReloaded;
					if (!M.File.IsEmpty())
					{
						M.Modified = IFileManager::Get().GetTimeStamp(*M.File);
						M.bHasFile = M.Modified != FDateTime::MinValue();
						M.bStale = M.bHasFile && M.Modified > M.LoadedAt;
					}
					ByTable.Add(M.Table, Mods.Num());
					Mods.Add(MoveTemp(M));
				}
			}
			lua_pop(L, 1);
		}
		// 绑定对象数：对象表里的实例表，元表、元表的 __index、元表的元表，哪个是模块表就算它的
		if (C.Map)
		{
			int32 Seen = 0;
			lua_pushnil(L);
			while (Seen < 200000 && lua_next(L, C.Map))
			{
				++Seen;
				if (lua_istable(L, -1) && lua_getmetatable(L, -1))
				{
					const int MT = lua_gettop(L);
					const int32* Hit = ByTable.Find(lua_topointer(L, MT));
					if (!Hit)
					{
						lua_pushstring(L, "__index");
						lua_rawget(L, MT);
						if (lua_istable(L, -1))
						{
							Hit = ByTable.Find(lua_topointer(L, -1));
						}
						lua_pop(L, 1);
					}
					if (!Hit && lua_getmetatable(L, MT))
					{
						Hit = ByTable.Find(lua_topointer(L, -1));
						lua_pop(L, 1);
					}
					if (Hit)
					{
						++Mods[*Hit].Objects;
					}
					lua_pop(L, 1);
				}
				lua_pop(L, 1);
			}
		}
		Mods.Sort([](const FModuleInfo& A, const FModuleInfo& B)
		{
			if (A.bStale != B.bStale)
			{
				return A.bStale;
			}
			return A.Name.Compare(B.Name, ESearchCase::IgnoreCase) < 0;
		});
		return Mods;
	}

	/** require 兜底：清掉 package.loaded[Name] 再 require；新旧都是表时把新函数拷回旧表、旧表放回去 */
	bool RequireReload(lua_State* L, const FString& Name, FString& Error)
	{
		FTop Guard(L);
		lua_pushcfunction(L, TracebackFn);
		const int Msgh = lua_gettop(L);
		lua_getfield(L, LUA_REGISTRYINDEX, LUA_LOADED_TABLE);
		const int Loaded = lua_gettop(L);
		FTCHARToUTF8 N(*Name);
		lua_getfield(L, Loaded, N.Get());
		const int Old = lua_gettop(L);
		lua_pushnil(L);
		lua_setfield(L, Loaded, N.Get());
		lua_getglobal(L, "require");
		lua_pushlstring(L, N.Get(), N.Length());
		lua_Hook OldHook = lua_gethook(L);
		const int OldMask = lua_gethookmask(L);
		const int OldCount = lua_gethookcount(L);
		GDeadline = FPlatformTime::Seconds() + 10.0;
		lua_sethook(L, TimeoutHook, LUA_MASKCOUNT, 10000);
		const int Status = lua_pcall(L, 1, 1, Msgh);
		RestoreHookAfterTimeout(L, OldHook, OldMask, OldCount);
		if (Status != LUA_OK)
		{
			Error = PopError(L);
			// 重载失败：旧模块放回去，游戏照旧跑旧代码
			lua_pushvalue(L, Old);
			lua_setfield(L, Loaded, N.Get());
			return false;
		}
		const int New = lua_gettop(L);
		if (lua_istable(L, Old) && lua_istable(L, New) && lua_topointer(L, Old) != lua_topointer(L, New))
		{
			lua_pushnil(L);
			while (lua_next(L, New))
			{
				const bool bFn = lua_isfunction(L, -1);
				bool bMissing = false;
				if (!bFn)
				{
					lua_pushvalue(L, -2);
					lua_rawget(L, Old);
					bMissing = lua_isnil(L, -1);
					lua_pop(L, 1);
				}
				if (bFn || bMissing)
				{
					lua_pushvalue(L, -2);
					lua_insert(L, -2);
					lua_rawset(L, Old);
				}
				else
				{
					lua_pop(L, 1);
				}
			}
			lua_pushvalue(L, Old);
			lua_setfield(L, Loaded, N.Get());
		}
		return true;
	}

	// ---------- 检视 ----------

	/** 函数签名：参数名（Lua 函数才有）、是否变长、定义位置 */
	void DescribeFunction(lua_State* L, int Idx, const TSharedPtr<FJsonObject>& F)
	{
		Idx = lua_absindex(L, Idx);
		lua_Debug Ar;
		lua_pushvalue(L, Idx);
		if (!lua_getinfo(L, ">Su", &Ar))
		{
			return;
		}
		const bool bC = Ar.what && FCStringAnsi::Strcmp(Ar.what, "C") == 0;
		TArray<TSharedPtr<FJsonValue>> Params;
		if (!bC)
		{
			lua_pushvalue(L, Idx);
			for (int I = 1; I <= Ar.nparams; ++I)
			{
				const char* Name = lua_getlocal(L, nullptr, I);
				Params.Add(MakeShared<FJsonValueString>(Name ? UTF8_TO_TCHAR(Name) : TEXT("?")));
			}
			lua_pop(L, 1);
			F->SetStringField(TEXT("src"), FString::Printf(TEXT("%s:%d"), UTF8_TO_TCHAR(Ar.short_src), Ar.linedefined));
			if (Ar.source && Ar.source[0] == '@')
			{
				F->SetStringField(TEXT("file"), UTF8_TO_TCHAR(Ar.source + 1));
				F->SetNumberField(TEXT("line"), Ar.linedefined);
			}
		}
		else
		{
			F->SetBoolField(TEXT("native"), true);
		}
		F->SetArrayField(TEXT("params"), Params);
		F->SetBoolField(TEXT("vararg"), Ar.isvararg != 0);
	}

	/** 一张表里的函数加进列表（同名的只留第一次见到的：自己的盖住继承的）；From 是第几层 */
	/** CCache 不为空时 C 函数不进 Out、放进 CCache（自己那层用：那是 UnLua 第一次调 UE 函数时缓存到表上的包装，归 UE 那层） */
	void CollectFunctions(lua_State* L, int T, int32 From, TSet<FString>& Seen, TArray<TSharedPtr<FJsonValue>>& Out, TArray<TSharedPtr<FJsonObject>>* CCache = nullptr)
	{
		lua_pushnil(L);
		while (lua_next(L, T))
		{
			if (lua_type(L, -2) == LUA_TSTRING && lua_isfunction(L, -1) && Out.Num() < 400)
			{
				size_t N = 0;
				const char* S = lua_tolstring(L, -2, &N);
				const FString Name = FromUtf8(S, N);
				if (CCache && lua_iscfunction(L, -1) && !Name.StartsWith(TEXT("__")))
				{
					TSharedPtr<FJsonObject> F = MakeShared<FJsonObject>();
					F->SetStringField(TEXT("name"), Name);
					DescribeFunction(L, -1, F);
					CCache->Add(F);
				}
				else if (!Seen.Contains(Name) && !(From > 0 && Name.StartsWith(TEXT("__"))))
				{
					Seen.Add(Name);
					TSharedPtr<FJsonObject> F = MakeShared<FJsonObject>();
					F->SetStringField(TEXT("name"), Name);
					F->SetNumberField(TEXT("from"), From);
					DescribeFunction(L, -1, F);
					Out.Add(MakeShared<FJsonValueObject>(F));
				}
			}
			lua_pop(L, 1);
		}
	}

	/** 自己的和模块层函数用到的 upvalue（模块顶部的 local）：同名只列一次，跳过 _ENV */
	void CollectUpvalues(FLuaCtx& C, int T, TSet<FString>& Seen, TArray<TSharedPtr<FJsonValue>>& Out)
	{
		lua_State* L = C.L;
		// 提前跳出 lua_next 循环时栈上会留着键和值，统一在这里收拾
		FTop Guard(L);
		lua_pushnil(L);
		while (Out.Num() < 100 && lua_next(L, T))
		{
			if (lua_type(L, -2) == LUA_TSTRING && lua_isfunction(L, -1) && !lua_iscfunction(L, -1))
			{
				const int Fn = lua_gettop(L);
				size_t N = 0;
				const char* FnName = lua_tolstring(L, -2, &N);
				const FString FnStr = FromUtf8(FnName, N);
				for (int I = 1; I <= 255 && Out.Num() < 100; ++I)
				{
					const char* Name = lua_getupvalue(L, Fn, I);
					if (!Name)
					{
						break;
					}
					const FString Up = UTF8_TO_TCHAR(Name);
					if (!Up.IsEmpty() && Up != TEXT("_ENV") && !Seen.Contains(Up))
					{
						Seen.Add(Up);
						TSharedPtr<FJsonObject> V = MakeShared<FJsonObject>();
						V->SetStringField(TEXT("name"), Up);
						V->SetStringField(TEXT("fn"), FnStr);
						V->SetNumberField(TEXT("index"), I);
						Describe(C, -1, V);
						Out.Add(MakeShared<FJsonValueObject>(V));
					}
					lua_pop(L, 1);
				}
			}
			lua_pop(L, 1);
		}
	}

	/** 表自己的非函数项（排序、分页），格式同 lua.get 的 fields */
	void ListOwnFields(FLuaCtx& C, int T, int32 Offset, int32 Limit, const TSharedPtr<FJsonObject>& Out)
	{
		// 先用 ListTable 全排，再滤掉函数：函数单列在 functions 里
		TSharedPtr<FJsonObject> All = MakeShared<FJsonObject>();
		ListTable(C, T, 0, MaxScan, All);
		const TArray<TSharedPtr<FJsonValue>>* Fields = nullptr;
		TArray<TSharedPtr<FJsonValue>> Data;
		if (All->TryGetArrayField(TEXT("fields"), Fields))
		{
			for (const TSharedPtr<FJsonValue>& F : *Fields)
			{
				const TSharedPtr<FJsonObject>* O = nullptr;
				if (F->TryGetObject(O) && (*O)->GetStringField(TEXT("t")) != TEXT("function"))
				{
					Data.Add(F);
				}
			}
		}
		TArray<TSharedPtr<FJsonValue>> Page;
		for (int32 I = Offset; I < Data.Num() && Page.Num() < Limit; ++I)
		{
			Page.Add(Data[I]);
		}
		Out->SetArrayField(TEXT("fields"), Page);
		Out->SetNumberField(TEXT("total"), Data.Num());
		Out->SetNumberField(TEXT("offset"), Offset);
		Out->SetBoolField(TEXT("more"), Offset + Page.Num() < Data.Num());
		Out->SetBoolField(TEXT("truncated"), All->GetBoolField(TEXT("truncated")));
	}

	/** 顶层简单字段的快照（lua.call 带 self 时比调用前后） */
	TMap<FString, TSharedPtr<FJsonValue>> Snapshot(lua_State* L, int T)
	{
		TMap<FString, TSharedPtr<FJsonValue>> Out;
		if (!lua_istable(L, T))
		{
			return Out;
		}
		FTop Guard(L);
		lua_pushnil(L);
		while (Out.Num() < 500 && lua_next(L, T))
		{
			if (lua_type(L, -2) == LUA_TSTRING)
			{
				if (TSharedPtr<FJsonValue> V = ScalarJson(L, -1))
				{
					size_t N = 0;
					const char* S = lua_tolstring(L, -2, &N);
					Out.Add(FromUtf8(S, N), V);
				}
			}
			lua_pop(L, 1);
		}
		return Out;
	}

	bool SameJson(const TSharedPtr<FJsonValue>& A, const TSharedPtr<FJsonValue>& B)
	{
		if (!A.IsValid() || !B.IsValid())
		{
			return A.IsValid() == B.IsValid();
		}
		if (A->Type != B->Type)
		{
			return false;
		}
		switch (A->Type)
		{
		case EJson::Boolean: return A->AsBool() == B->AsBool();
		case EJson::Number: return A->AsNumber() == B->AsNumber();
		case EJson::String: return A->AsString() == B->AsString();
		default: return true;
		}
	}

	/** 执行期间临时换掉 print（收进输出）、挂超时钩子；析构时都放回去（和 lua.exec 同一套） */
	struct FRunGuard
	{
		lua_State* L;
		int G = 0;
		int OldPrint = 0;
		lua_Hook OldHook;
		int OldMask;
		int OldCount;
		TArray<FString> Printed;

		FRunGuard(lua_State* InL, double TimeoutSec) : L(InL)
		{
			lua_pushglobaltable(L);
			G = lua_gettop(L);
			lua_pushstring(L, "print");
			lua_rawget(L, G);
			OldPrint = lua_gettop(L);
			lua_pushstring(L, "print");
			lua_pushcfunction(L, PrintFn);
			lua_rawset(L, G);
			OldHook = lua_gethook(L);
			OldMask = lua_gethookmask(L);
			OldCount = lua_gethookcount(L);
			GDeadline = FPlatformTime::Seconds() + TimeoutSec;
			GPrintSink = &Printed;
			lua_sethook(L, TimeoutHook, LUA_MASKCOUNT, 10000);
		}

		~FRunGuard()
		{
			RestoreHookAfterTimeout(L, OldHook, OldMask, OldCount);
			GPrintSink = nullptr;
			lua_pushstring(L, "print");
			lua_pushvalue(L, OldPrint);
			lua_rawset(L, G);
		}
	};
}

namespace AgentPanelLuaChain
{
	/**
	 * 元表链上 UnLua 给 UE 类建的那层，注册表里的名字可能是「AActor」这种类名，也可能是
	 * 「/Game/.../ABP_X.ABP_X_C」这种路径（用户的 UnLua 分支就是路径）。两种都认，找不到返回 nullptr
	 */
	static UStruct* Resolve(const FString& Name)
	{
		if (Name.IsEmpty())
		{
			return nullptr;
		}
		if (Name.StartsWith(TEXT("/")))
		{
			return FindObject<UStruct>(nullptr, *Name);
		}
		UStruct* S = FindFirstObject<UStruct>(*Name, EFindFirstObjectOptions::NativeFirst);
		// UnLua 的名字带 U / A / F 前缀，反射里的名字不带
		if (!S && Name.Len() > 1 && (Name[0] == TEXT('U') || Name[0] == TEXT('A') || Name[0] == TEXT('F')))
		{
			S = FindFirstObject<UStruct>(*Name.Mid(1), EFindFirstObjectOptions::NativeFirst);
		}
		return S;
	}

	/** 显示用的短名：C++ 类带前缀（AActor），蓝图类用生成类名（ABP_X_C） */
	static FString ShortName(const UStruct* S)
	{
		return S->IsNative() ? FString(S->GetPrefixCPP()) + S->GetName() : S->GetName();
	}
}

void FAgentPanelLua::CaptureError(lua_State* L, const FString& Message)
{
	using namespace AgentPanelLuaDev;
	if (!L)
	{
		return;
	}
	// 2.9.0：录 trace 时先把这次报错跳出去的 Lua 帧收尾（报错跳出没有返回事件，不收尾时间轴会错位）
	AgentPanelLuaTrace::OnLuaError(L);
	const int Top = lua_gettop(L);
	luaL_traceback(L, L, nullptr, 1);
	size_t N = 0;
	const char* S = lua_tolstring(L, -1, &N);
	TArray<FString> Lines;
	AgentPanelLuaImpl::FromUtf8(S, N).ParseIntoArrayLines(Lines);
	TArray<FString> Stack;
	for (const FString& Line : Lines)
	{
		const FString T = Line.TrimStartAndEnd();
		if (!T.IsEmpty() && T != TEXT("stack traceback:") && Stack.Num() < 40)
		{
			Stack.Add(T);
		}
	}
	lua_settop(L, Top);
	TArray<TSharedPtr<FJsonValue>> Locals = CaptureLocals(L);
	lua_settop(L, Top);
	AddError(Message, MoveTemp(Stack), MoveTemp(Locals), TEXT("capture"));
}

void AgentPanelRegisterLuaDevOps(FAgentPanelBridge& B)
{
	using namespace AgentPanel;
	using namespace AgentPanelLuaImpl;
	using namespace AgentPanelLuaDev;

	static FTSTicker::FDelegateHandle ErrorTick;
	if (!ErrorTick.IsValid())
	{
		// 从现在的日志末尾开始认，不把启动前的旧报错算进来
		Errors().LogCursor = FAgentPanelLog::Get().LastSeq();
		ErrorTick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&TickErrors), 1.0f);
	}

	// 只编译不执行：单独新建 lua_State，不碰游戏里的 Lua 环境，不开游戏也能查
	B.AddOp(TEXT("lua.check"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		TArray<FString> Files;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (A->TryGetArrayField(TEXT("files"), Arr))
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				Files.Add(V->AsString());
			}
		}
		if (!Str(A, TEXT("file")).IsEmpty())
		{
			Files.Add(Str(A, TEXT("file")));
		}
		const FString Code = Str(A, TEXT("code"));
		if (Files.Num() == 0 && Code.IsEmpty())
		{
			Error = TEXT("要给 code（代码）或 file / files（文件路径）");
			return false;
		}
		if (Files.Num() > 500)
		{
			Error = TEXT("一次最多查 500 个文件，请分批");
			return false;
		}
		lua_State* L = luaL_newstate();
		if (!L)
		{
			Error = TEXT("建不了检查用的 lua_State（内存不够？）");
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Errs;
		int32 Checked = 0;
		auto Check = [&](const char* Buf, size_t Len, const FString& Chunk, const FString& File)
		{
			++Checked;
			FTCHARToUTF8 Name(*Chunk);
			if (luaL_loadbuffer(L, Buf, Len, Name.Get()) == LUA_OK)
			{
				lua_settop(L, 0);
				return;
			}
			const FString Msg = PopError(L);
			lua_settop(L, 0);
			TSharedPtr<FJsonObject> E = MakeShared<FJsonObject>();
			E->SetStringField(TEXT("file"), File);
			FRegexMatcher M(FRegexPattern(TEXT(":(\\d+):\\s*(.*)$")), Msg);
			if (M.FindNext())
			{
				E->SetNumberField(TEXT("line"), FCString::Atoi(*M.GetCaptureGroup(1)));
				E->SetStringField(TEXT("message"), M.GetCaptureGroup(2));
			}
			else
			{
				E->SetStringField(TEXT("message"), Msg);
			}
			Errs.Add(MakeShared<FJsonValueObject>(E));
		};
		if (!Code.IsEmpty())
		{
			FTCHARToUTF8 U(*Code);
			const FString Name = Str(A, TEXT("name"), TEXT("code"));
			Check(U.Get(), U.Length(), TEXT("=") + Name, Name);
		}
		for (FString F : Files)
		{
			if (FPaths::IsRelative(F))
			{
				F = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / F);
			}
			TArray<uint8> Bytes;
			if (!FFileHelper::LoadFileToArray(Bytes, *F))
			{
				TSharedPtr<FJsonObject> E = MakeShared<FJsonObject>();
				E->SetStringField(TEXT("file"), F);
				E->SetStringField(TEXT("message"), TEXT("读不到这个文件"));
				Errs.Add(MakeShared<FJsonValueObject>(E));
				continue;
			}
			// 跳过 UTF-8 BOM：Lua 的编译器不认它
			int32 Skip = Bytes.Num() >= 3 && Bytes[0] == 0xEF && Bytes[1] == 0xBB && Bytes[2] == 0xBF ? 3 : 0;
			Check(reinterpret_cast<const char*>(Bytes.GetData()) + Skip, Bytes.Num() - Skip, TEXT("@") + F, F);
		}
		lua_close(L);
		Out->SetBoolField(TEXT("passed"), Errs.Num() == 0);
		Out->SetNumberField(TEXT("checked"), Checked);
		Out->SetArrayField(TEXT("errors"), Errs);
		return true;
	});

	B.AddOp(TEXT("lua.modules"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		FTop Guard(C.L);
		const FString Root = ScriptRoot(A);
		const TArray<FModuleInfo> Mods = CollectModules(C, Root, Str(A, TEXT("filter")));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 500), 1, 2000);
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Stale = 0;
		for (const FModuleInfo& M : Mods)
		{
			Stale += M.bStale ? 1 : 0;
			if (Items.Num() >= Limit)
			{
				continue;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), M.Name);
			if (!M.File.IsEmpty())
			{
				O->SetStringField(TEXT("file"), M.File);
			}
			O->SetNumberField(TEXT("objects"), M.Objects);
			O->SetStringField(TEXT("loadedAt"), Iso(M.LoadedAt));
			if (M.bGuess)
			{
				O->SetBoolField(TEXT("loadedAtGuess"), true);
			}
			if (M.bHasFile)
			{
				O->SetStringField(TEXT("modifiedAt"), Iso(M.Modified));
			}
			O->SetBoolField(TEXT("stale"), M.bStale);
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Mods.Num());
		Out->SetNumberField(TEXT("stale"), Stale);
		Out->SetStringField(TEXT("root"), Root);
		Out->SetBoolField(TEXT("reloader"), (bool)LuaReloader());
		return true;
	});

	B.AddOp(TEXT("lua.reload"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		FTop Guard(C.L);
		TArray<FString> Names;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (A->TryGetArrayField(TEXT("modules"), Arr))
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				Names.AddUnique(V->AsString());
			}
		}
		if (!Str(A, TEXT("module")).IsEmpty())
		{
			Names.AddUnique(Str(A, TEXT("module")));
		}
		if (Bool(A, TEXT("changed"), false))
		{
			for (const FModuleInfo& M : CollectModules(C, ScriptRoot(A), FString()))
			{
				if (M.bStale)
				{
					Names.AddUnique(M.Name);
				}
			}
		}
		if (Names.Num() == 0)
		{
			Error = Bool(A, TEXT("changed"), false) ? TEXT("没有改过还没重载的模块") : TEXT("要给 modules（模块名列表）或 changed: true");
			return false;
		}
		const bool bReloader = (bool)LuaReloader();
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Failed = 0;
		for (const FString& Name : Names)
		{
			FString E;
			const bool bOk = bReloader ? LuaReloader()(C.L, Name, E) : RequireReload(C.L, Name, E);
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("module"), Name);
			O->SetBoolField(TEXT("ok"), bOk);
			O->SetStringField(TEXT("mode"), bReloader ? TEXT("reloader") : TEXT("require"));
			if (!bOk)
			{
				++Failed;
				O->SetStringField(TEXT("error"), E.IsEmpty() ? FString(TEXT("重载失败（没有给原因）")) : E);
			}
			else
			{
				FLoadMark& Mark = LoadMarks().FindOrAdd(Name);
				Mark.At = FDateTime::UtcNow();
				Mark.bReloaded = true;
			}
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("failed"), Failed);
		if (!bReloader)
		{
			Out->SetStringField(TEXT("note"), TEXT("用 require 兜底重载：新函数已拷回旧模块表，已绑定的对象会用上；模块顶部 local 存的状态重新初始化了。项目有自己的热重载时用 FAgentPanelLua::SetReloader 接上"));
		}
		return true;
	});

	B.AddOp(TEXT("lua.errors"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		ScanLog();
		if (Bool(A, TEXT("clear"), false))
		{
			FErrorStore& S = Errors();
			FScopeLock Guard(&S.Lock);
			S.Items.Reset();
		}
		const uint64 Since = (uint64)FMath::Max(0.0, A->HasField(TEXT("since")) ? A->GetNumberField(TEXT("since")) : 0.0);
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 50), 1, 200);
		Out->SetArrayField(TEXT("items"), ErrorJson(Since, Limit));
		FErrorStore& S = Errors();
		FScopeLock Guard(&S.Lock);
		Out->SetNumberField(TEXT("seq"), (double)S.Seq);
		Out->SetNumberField(TEXT("total"), S.Items.Num());
		return true;
	});

	// 对象检视：字段（不含函数）、函数签名（自己的 + 元表链上继承的）、元表链、upvalue
	B.AddOp(TEXT("lua.inspect"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		UObject* Obj = nullptr;
		if (!OpenFor(A, C, Obj, Error))
		{
			return false;
		}
		FTop Guard(C.L);
		lua_State* L = C.L;
		if (!PushRoot(C, Str(A, TEXT("path")), Obj, Error))
		{
			return false;
		}
		if (Obj)
		{
			TSharedPtr<FJsonObject> O = Brief(Obj);
			FString Mod = InterfaceModule(Obj);
			if (Mod.IsEmpty() && lua_istable(L, -1))
			{
				Mod = C.ModuleOf(lua_gettop(L));
			}
			O->SetStringField(TEXT("module"), Mod);
			Out->SetObjectField(TEXT("object"), O);
		}
		const TArray<TSharedPtr<FJsonValue>> Keys = KeysOf(A);
		if (!Walk(C, Keys, Keys.Num(), Error))
		{
			return false;
		}
		const int V = lua_gettop(L);
		TSharedPtr<FJsonObject> D = MakeShared<FJsonObject>();
		Describe(C, V, D);
		Out->SetObjectField(TEXT("value"), D);
		if (lua_isfunction(L, V))
		{
			TSharedPtr<FJsonObject> F = MakeShared<FJsonObject>();
			DescribeFunction(L, V, F);
			Out->SetObjectField(TEXT("function"), F);
			return true;
		}
		const int Type = lua_type(L, V);
		if (Type != LUA_TTABLE && Type != LUA_TUSERDATA)
		{
			return true;
		}
		TSet<FString> Seen;
		TArray<TSharedPtr<FJsonValue>> Fns;
		TArray<TSharedPtr<FJsonObject>> OwnC;
		int32 FirstUe = 0;
		TSet<FString> UpSeen;
		TArray<TSharedPtr<FJsonValue>> Ups;
		if (Type == LUA_TTABLE)
		{
			ListOwnFields(C, V, FMath::Max(0, Int(A, TEXT("offset"), 0)), FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 1000), Out);
			CollectFunctions(L, V, 0, Seen, Fns, &OwnC);
			CollectUpvalues(C, V, UpSeen, Ups);
		}
		// 元表链：每层取 __index（是表时）或元表本身，最多 16 层（UE 类一路到 UObject 常有十层上下，2.18 及以前只走 6 层）。
		// 走过的表记下来：UnLua 给 UE 类建的元表常是自己的元表（__index 是函数），2.19.0 没防这个，同一层会重复到 16 次
		TArray<TSharedPtr<FJsonValue>> Chain;
		TSet<const void*> Visited;
		TSet<FString> ChainNames;
		FString LastUe;
		Visited.Add(lua_topointer(L, V));
		lua_pushvalue(L, V);
		for (int32 Depth = 1; Depth <= 16 && lua_getmetatable(L, -1); ++Depth)
		{
			const int MT = lua_gettop(L);
			if (Visited.Contains(lua_topointer(L, MT)))
			{
				break;
			}
			Visited.Add(lua_topointer(L, MT));
			lua_pushstring(L, "__index");
			lua_rawget(L, MT);
			const int Src = lua_istable(L, -1) ? lua_gettop(L) : MT;
			TSharedPtr<FJsonObject> Layer = MakeShared<FJsonObject>();
			FString Name = C.ModuleOfTable(lua_topointer(L, Src));
			if (Name.IsEmpty() && Src != MT)
			{
				Name = C.ModuleOfTable(lua_topointer(L, MT));
			}
			if (Name.IsEmpty())
			{
				Name = C.ModuleFromSource(Src);
			}
			// 是模块就是 Lua 写的那一层；不是模块时去注册表按名字反查，查到的是 UnLua 给 UE 类建的元表
			FString Kind = Name.IsEmpty() ? FString() : TEXT("lua");
			if (Name.IsEmpty())
			{
				Name = C.RegistryNameOf(lua_topointer(L, MT));
				if (Name.IsEmpty() && Src != MT)
				{
					Name = C.RegistryNameOf(lua_topointer(L, Src));
				}
				Kind = Name.IsEmpty() ? FString() : TEXT("ue");
			}
			if (Kind == TEXT("ue"))
			{
				LastUe = Name;
				FirstUe = FirstUe ? FirstUe : Depth;
				// 路径名只留类名显示，完整路径放 path
				if (const UStruct* S = AgentPanelLuaChain::Resolve(Name))
				{
					Layer->SetStringField(TEXT("path"), Name);
					Name = AgentPanelLuaChain::ShortName(S);
				}
			}
			ChainNames.Add(Name);
			Layer->SetStringField(TEXT("name"), Name);
			if (!Kind.IsEmpty())
			{
				Layer->SetStringField(TEXT("kind"), Kind);
			}
			const int32 Before = Fns.Num();
			CollectFunctions(L, Src, Depth, Seen, Fns);
			if (Fns.Num() > Before)
			{
				FString Src0;
				const TSharedPtr<FJsonObject> FirstFn = Fns[Before].IsValid() ? Fns[Before]->AsObject() : nullptr;
				if (FirstFn.IsValid() && FirstFn->TryGetStringField(TEXT("src"), Src0))
				{
					Layer->SetStringField(TEXT("src"), Src0);
				}
			}
			Chain.Add(MakeShared<FJsonValueObject>(Layer));
			// 模块那一层（第一层）的 upvalue 就是模块顶部的 local
			if (Depth == 1)
			{
				CollectUpvalues(C, Src, UpSeen, Ups);
			}
			if (Src != MT)
			{
				Visited.Add(lua_topointer(L, Src));
			}
			lua_settop(L, Src);
		}
		lua_settop(L, V);
		// 自己表上的 C 函数是调过一次的 UE 函数（UnLua 缓存的包装）：归到第一层 UE 类，免得调一次就从 UE 那组跳到「自己的」
		for (const TSharedPtr<FJsonObject>& F : OwnC)
		{
			const FString Name = F->GetStringField(TEXT("name"));
			if (!Seen.Contains(Name))
			{
				Seen.Add(Name);
				F->SetNumberField(TEXT("from"), FirstUe);
				Fns.Add(MakeShared<FJsonValueObject>(F));
			}
		}
		// 元表链走到 UE 类那层就断了（UnLua 分支不一定把父类元表挂成元表）：按反射把真实父类补到 UObject，没函数，只显示
		if (const UStruct* S = AgentPanelLuaChain::Resolve(LastUe))
		{
			for (const UStruct* Super = S->GetSuperStruct(); Super; Super = Super->GetSuperStruct())
			{
				const FString N = AgentPanelLuaChain::ShortName(Super);
				if (ChainNames.Contains(N))
				{
					continue;
				}
				ChainNames.Add(N);
				TSharedPtr<FJsonObject> Layer = MakeShared<FJsonObject>();
				Layer->SetStringField(TEXT("name"), N);
				Layer->SetStringField(TEXT("kind"), TEXT("ue"));
				Layer->SetBoolField(TEXT("reflected"), true);
				Chain.Add(MakeShared<FJsonValueObject>(Layer));
			}
		}
		Out->SetArrayField(TEXT("chain"), Chain);
		Out->SetArrayField(TEXT("functions"), Fns);
		Out->SetArrayField(TEXT("upvalues"), Ups);
		// 定义位置：自己的第一个 Lua 函数，没有时取元表链第一层的
		for (const TSharedPtr<FJsonValue>& F : Fns)
		{
			FString S;
			const TSharedPtr<FJsonObject> FnObj = F.IsValid() ? F->AsObject() : nullptr;
			if (FnObj.IsValid() && FnObj->TryGetStringField(TEXT("src"), S))
			{
				Out->SetStringField(TEXT("src"), S);
				break;
			}
		}
		return true;
	});

	// 调 Lua 函数：keys 是函数路径，self 时上一级当第一个参数（obj:fn(...)）；参数 JSON，对象 / 数组转表
	B.AddOp(TEXT("lua.call"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const TArray<TSharedPtr<FJsonValue>> Keys = KeysOf(A);
		if (Keys.Num() == 0)
		{
			Error = TEXT("要给函数路径（keys），例如 [\"BagSystem\", \"AddItem\"]");
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Args;
		const TArray<TSharedPtr<FJsonValue>>* ArgArr = nullptr;
		if (A->TryGetArrayField(TEXT("args"), ArgArr))
		{
			Args = *ArgArr;
		}
		if (Args.Num() > 20)
		{
			Error = TEXT("参数最多 20 个");
			return false;
		}
		FLuaCtx C;
		UObject* Obj = nullptr;
		if (!OpenFor(A, C, Obj, Error))
		{
			return false;
		}
		FTop Guard(C.L);
		lua_State* L = C.L;
		lua_pushcfunction(L, TracebackFn);
		const int Msgh = lua_gettop(L);
		if (!PushRoot(C, Str(A, TEXT("path")), Obj, Error) || !Walk(C, Keys, Keys.Num() - 1, Error))
		{
			return false;
		}
		const int Parent = lua_gettop(L);
		const int PType = lua_type(L, Parent);
		if (PType != LUA_TTABLE && PType != LUA_TUSERDATA)
		{
			Error = FString::Printf(TEXT("上一级是 %s，不是表"), UTF8_TO_TCHAR(lua_typename(L, PType)));
			return false;
		}
		PushJsonKey(L, Keys.Last());
		if (!PGet(L, Parent, Error))
		{
			return false;
		}
		const int Fn = lua_gettop(L);
		if (!lua_isfunction(L, Fn))
		{
			Error = FString::Printf(TEXT("%s 是 %s，不是函数"), *KeyText(Keys.Last()), UTF8_TO_TCHAR(lua_typename(L, lua_type(L, Fn))));
			return false;
		}
		const bool bSelf = Bool(A, TEXT("self"), false);
		const TMap<FString, TSharedPtr<FJsonValue>> Before = bSelf ? Snapshot(L, Parent) : TMap<FString, TSharedPtr<FJsonValue>>();
		const double Timeout = FMath::Clamp(Int(A, TEXT("timeoutMs"), 10000), 100, 60000) / 1000.0;
		int Status = LUA_OK;
		double Ms = 0;
		int CallBase = 0;
		TArray<FString> Printed;
		const uint64 LogBefore = FAgentPanelLog::Get().LastSeq();
		{
			FRunGuard Run(L, Timeout);
			lua_pushvalue(L, Fn);
			CallBase = lua_gettop(L);
			int NArgs = 0;
			if (bSelf)
			{
				lua_pushvalue(L, Parent);
				++NArgs;
			}
			for (const TSharedPtr<FJsonValue>& Arg : Args)
			{
				if (!PushJsonAny(L, Arg, 16, Error))
				{
					return false;
				}
				++NArgs;
			}
			const double Start = FPlatformTime::Seconds();
			Status = lua_pcall(L, NArgs, LUA_MULTRET, Msgh);
			Ms = (FPlatformTime::Seconds() - Start) * 1000.0;
			Printed = Run.Printed;
		}
		// FRunGuard 析构时往栈顶压过东西又放回了 print：结果在 CallBase 到放回 print 之前，析构只做 rawset，不留栈
		TArray<TSharedPtr<FJsonValue>> Output;
		for (const FString& Line : Printed)
		{
			Output.Add(MakeShared<FJsonValueString>(Line));
		}
		for (const FString& Line : FAgentPanelLog::Get().TextSince(LogBefore, 400))
		{
			Output.Add(MakeShared<FJsonValueString>(Line));
		}
		if (Status != LUA_OK)
		{
			Error = PopError(L);
			for (const TSharedPtr<FJsonValue>& Line : Output)
			{
				Error += TEXT("\n") + Line->AsString();
			}
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Results;
		for (int I = CallBase; I <= lua_gettop(L) && Results.Num() < 20; ++I)
		{
			TSharedPtr<FJsonObject> R = MakeShared<FJsonObject>();
			Describe(C, I, R);
			if (lua_istable(L, I))
			{
				ListTable(C, I, 0, 50, R);
			}
			Results.Add(MakeShared<FJsonValueObject>(R));
		}
		Out->SetArrayField(TEXT("results"), Results);
		Out->SetArrayField(TEXT("output"), Output);
		Out->SetNumberField(TEXT("ms"), Ms);
		if (bSelf)
		{
			const TMap<FString, TSharedPtr<FJsonValue>> After = Snapshot(L, Parent);
			TArray<TSharedPtr<FJsonValue>> Changes;
			auto AddChange = [&](const FString& K, const TSharedPtr<FJsonValue>& B0, const TSharedPtr<FJsonValue>& A0)
			{
				if (Changes.Num() >= 50 || SameJson(B0, A0))
				{
					return;
				}
				TSharedPtr<FJsonObject> Ch = MakeShared<FJsonObject>();
				Ch->SetStringField(TEXT("k"), K);
				Ch->SetField(TEXT("before"), B0.IsValid() ? B0 : MakeShared<FJsonValueNull>());
				Ch->SetField(TEXT("after"), A0.IsValid() ? A0 : MakeShared<FJsonValueNull>());
				Changes.Add(MakeShared<FJsonValueObject>(Ch));
			};
			for (const TPair<FString, TSharedPtr<FJsonValue>>& P : After)
			{
				const TSharedPtr<FJsonValue>* B0 = Before.Find(P.Key);
				AddChange(P.Key, B0 ? *B0 : nullptr, P.Value);
			}
			for (const TPair<FString, TSharedPtr<FJsonValue>>& P : Before)
			{
				if (!After.Contains(P.Key))
				{
					AddChange(P.Key, P.Value, nullptr);
				}
			}
			Out->SetArrayField(TEXT("changes"), Changes);
		}
		return true;
	});
}

#endif
