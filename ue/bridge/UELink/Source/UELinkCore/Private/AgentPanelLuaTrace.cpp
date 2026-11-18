// Lua 函数进 Unreal Insights trace（Lua 性能分析 Insights 化设计稿 4、9.1，2.9.0 起）。
//
// 录制 .utrace 时带上 lua 通道，每个 Lua 函数就变成游戏线程上一个 CPU 计时器作用域，和 UE 自己的作用域嵌在一起，
// 面板的性能页和 UE 自带的 Unreal Insights 打开同一份文件都能看到。只用 Lua 的 C 接口和调试钩子，不碰 UnLua 内部结构。
//
// 零开销（用户 2026-11-17 要求）：没在录制时只挂着「开始 / 停止录制」两个委托，不挂钩子、不发事件、不注册每帧回调。
// 通道开关没有回调，所以录制开始后才注册每帧回调去读 lua 通道的布尔值，开了才挂钩子；停止录制时摘钩子、注销回调。
//
// 时间轴不能错位：Insights 要求同一线程上的作用域严格嵌套（Begin / End 成对、后开先关）。Lua 有几种情况会打乱：
// - 协程：影子栈按 lua_State 各一份；发出去还没结束的帧另记一条全局栈（Emitted）。事件来自另一个协程、而且是「接着跑」
//   （层数不比它影子栈顶深一层以上）时，先把压在它上面的别的协程的帧结束；切回来时按它的影子栈重新开始。
//   yield 没有返回事件，所以调用 coroutine.yield 时就先把这个协程的帧结束。
// - 报错：Lua 里的 pcall 返回时按层数把更深的帧一起结束；从 C++ 调进来又报错的，靠项目侧报错钩子 CaptureError 收尾；
//   都没接住的，每帧结束时按影子栈全部收尾（只影响那一帧）。
// - 尾调用：和 lua.profile 一样按层数对齐，被替换的帧在同一时刻结束。
// - 从 C++ 回调进来（层数比影子栈顶深一层以上）：中间隔着 C++，不动下面的帧，直接嵌在最上面。
// 同名头文件必须第一个 include：UBT 的 IWYU 检查要求 X.cpp 先 include X.h（2.10.0 在用户本地报过 Expected ... to be first header included）
#include "AgentPanelLuaTrace.h"
#include "AgentPanelLuaOps.h"

#if !AGENT_PANEL_WITH_LUA

void AgentPanelRegisterLuaTrace() {}
void AgentPanelUnregisterLuaTrace() {}

#else

#include "AgentPanelLuaShared.h"
#include "UELinkCompat.h"

#include "Containers/Ticker.h"
#include "HAL/PlatformTime.h"
#include "Hash/CityHash.h"
#include "Misc/Paths.h"
#include "ProfilingDebugging/CountersTrace.h"
#include "ProfilingDebugging/CpuProfilerTrace.h"
#include "ProfilingDebugging/TraceAuxiliary.h"
#include "Trace/Trace.h"
#include "lua.hpp"

#include <atomic>

DEFINE_LOG_CATEGORY_STATIC(LogUELinkLuaTrace, Log, All);

// 引擎没编进 trace（Test / Shipping，或项目关了 trace）时整块不编：名字解析照样给 lua.profile 用
#if defined(UE_TRACE_ENABLED) && UE_TRACE_ENABLED && defined(CPUPROFILERTRACE_ENABLED) && CPUPROFILERTRACE_ENABLED
#define UELINK_LUA_TRACE 1
#else
#define UELINK_LUA_TRACE 0
#endif

#if defined(COUNTERSTRACE_ENABLED) && COUNTERSTRACE_ENABLED && UELINK_LUA_TRACE
#define UELINK_LUA_COUNTERS 1
#else
#define UELINK_LUA_COUNTERS 0
#endif

#if UELINK_LUA_TRACE
// 通道名取变量名去掉 Channel：lua、luac（Trace.Enable / -trace= 不分大小写）。放进自己的命名空间：
// 单体构建（游戏包）里所有模块链接在一起，别的插件也叫 LuaChannel 时全局符号会撞
namespace UELinkLuaTraceChannels
{
	UE_TRACE_CHANNEL_DEFINE(LuaChannel)
	UE_TRACE_CHANNEL_DEFINE(LuaCChannel)
}
#endif

#if UELINK_LUA_COUNTERS
namespace UELinkLuaTraceCounters
{
	UELINK_TRACE_FLOAT_COUNTER(UELinkLuaFrameMs, TEXT("Lua/FrameMs"));
	UELINK_TRACE_INT_COUNTER(UELinkLuaCalls, TEXT("Lua/Calls"));
	UELINK_TRACE_INT_COUNTER(UELinkLuaMemoryKB, TEXT("Lua/MemoryKB"));
}
#endif

namespace AgentPanelLuaTrace
{
	using namespace AgentPanelLuaImpl;

	// ---------- 名字解析（lua.profile 和 trace 共用） ----------

	/** 标准库 C 函数 → 显示名。函数指针在各 lua_State 里都一样，只是第一次要从某个主 lua_State 上读出来 */
	struct FStdNames
	{
		lua_State* Built = nullptr;
		TMap<UPTRINT, FString> Names;
		/** coroutine.yield：协程要挂起了，trace 先把这个协程的帧结束（yield 没有返回事件） */
		UPTRINT Yield = 0;
	};

	FStdNames& Std()
	{
		static FStdNames S;
		return S;
	}

	inline UPTRINT FnKey(lua_CFunction F)
	{
		return reinterpret_cast<UPTRINT>(F);
	}

	void PrepareNames(lua_State* Main)
	{
		FStdNames& S = Std();
		if (!Main || S.Built == Main)
		{
			return;
		}
		S.Built = Main;
		S.Names.Reset();
		S.Yield = 0;
		FTop Guard(Main);
		if (!lua_checkstack(Main, 8))
		{
			return;
		}
		lua_pushglobaltable(Main);
		const int G = lua_gettop(Main);
		// 只认这几个基础函数：_G 里还有 UnLua 自己放的 C 函数，那些算 UE.*
		static const char* const Base[] = {
			"assert", "collectgarbage", "dofile", "error", "getmetatable", "ipairs", "load", "loadfile", "loadstring",
			"next", "pairs", "pcall", "print", "rawequal", "rawget", "rawlen", "rawset", "require", "select",
			"setmetatable", "tonumber", "tostring", "type", "unpack", "xpcall"
		};
		for (const char* N : Base)
		{
			lua_pushstring(Main, N);
			lua_rawget(Main, G);
			if (lua_iscfunction(Main, -1))
			{
				S.Names.Add(FnKey(lua_tocfunction(Main, -1)), FString(TEXT("lua.")) + UTF8_TO_TCHAR(N));
			}
			lua_pop(Main, 1);
		}
		static const char* const Libs[] = { "string", "table", "math", "os", "io", "coroutine", "utf8", "debug", "package" };
		for (const char* Lib : Libs)
		{
			lua_pushstring(Main, Lib);
			lua_rawget(Main, G);
			if (lua_istable(Main, -1))
			{
				const int T = lua_gettop(Main);
				int32 N = 0;
				lua_pushnil(Main);
				while (lua_next(Main, T))
				{
					if (lua_type(Main, -2) == LUA_TSTRING && lua_iscfunction(Main, -1))
					{
						const UPTRINT K = FnKey(lua_tocfunction(Main, -1));
						const FString Key = UTF8_TO_TCHAR(lua_tostring(Main, -2));
						// 同一个函数挂在两处（unpack / table.unpack）时留先认到的
						if (!S.Names.Contains(K))
						{
							S.Names.Add(K, FString::Printf(TEXT("lua.%s.%s"), UTF8_TO_TCHAR(Lib), *Key));
						}
						if (FCStringAnsi::Strcmp(Lib, "coroutine") == 0 && Key == TEXT("yield"))
						{
							S.Yield = K;
						}
					}
					lua_pop(Main, 1);
					if (++N >= 500)
					{
						lua_pop(Main, 1);
						break;
					}
				}
			}
			lua_settop(Main, G);
		}
	}

	/**
	 * 文件路径 → 模块名：取 Content/Script/ 之后的部分，去掉 .lua，/ 换成 .（Player.BP_PlayerController_C）。
	 * 不是文件的 chunk（[string "..."]）原样用 short_src
	 */
	FString ModuleOfSource(const char* Source, const char* ShortSrc)
	{
		if (!Source || Source[0] != '@')
		{
			return UTF8_TO_TCHAR(ShortSrc ? ShortSrc : "?");
		}
		FString P = UTF8_TO_TCHAR(Source + 1);
		P.ReplaceInline(TEXT("\\"), TEXT("/"));
		const int32 At = P.Find(TEXT("/Content/Script/"), ESearchCase::IgnoreCase);
		if (At != INDEX_NONE)
		{
			P.RightChopInline(At + 16);
		}
		else if (P.StartsWith(TEXT("Content/Script/"), ESearchCase::IgnoreCase))
		{
			P.RightChopInline(15);
		}
		else if (P.Contains(TEXT(":")) || P.StartsWith(TEXT("/")))
		{
			// 脚本根不叫 Content/Script 的绝对路径：只留文件名，免得模块名里带一长串盘符目录
			P = FPaths::GetCleanFilename(P);
		}
		if (P.EndsWith(TEXT(".lua"), ESearchCase::IgnoreCase))
		{
			P.LeftChopInline(4);
		}
		P.ReplaceInline(TEXT("/"), TEXT("."));
		return P;
	}

	/**
	 * UnLua 从 C++ 调进来的函数（ReceiveTick 这类覆写）没有调用方名字：去 package.loaded[模块] 表里找值是同一个函数的字段。
	 * 模块名不一定和路径推出来的一样（脚本根不同、按短名 require）：从全名起依次去掉前面一段再试
	 */
	FString FieldInModule(lua_State* L, const FString& Module, int Fn)
	{
		FTop Guard(L);
		if (!lua_checkstack(L, 8))
		{
			return FString();
		}
		Fn = lua_absindex(L, Fn);
		lua_getfield(L, LUA_REGISTRYINDEX, LUA_LOADED_TABLE);
		if (!lua_istable(L, -1))
		{
			return FString();
		}
		const int Loaded = lua_gettop(L);
		FString Cand = Module;
		for (int32 Try = 0; Try < 6 && !Cand.IsEmpty(); ++Try)
		{
			PushStr(L, Cand);
			lua_rawget(L, Loaded);
			if (lua_istable(L, -1))
			{
				const int T = lua_gettop(L);
				int32 N = 0;
				lua_pushnil(L);
				while (lua_next(L, T))
				{
					if (lua_type(L, -2) == LUA_TSTRING && lua_rawequal(L, -1, Fn))
					{
						size_t Len = 0;
						const char* K = lua_tolstring(L, -2, &Len);
						return FromUtf8(K, Len);
					}
					lua_pop(L, 1);
					if (++N >= 2000)
					{
						lua_pop(L, 1);
						break;
					}
				}
			}
			lua_settop(L, Loaded);
			int32 Dot = INDEX_NONE;
			if (!Cand.FindChar(TEXT('.'), Dot))
			{
				break;
			}
			Cand.RightChopInline(Dot + 1);
		}
		return FString();
	}

	FString FunctionName(lua_State* L, lua_Debug* Ar, int FnIdx)
	{
		const bool bC = Ar->what && FCStringAnsi::Strcmp(Ar->what, "C") == 0;
		if (bC)
		{
			if (const FString* Known = Std().Names.Find(FnKey(lua_tocfunction(L, FnIdx))))
			{
				return *Known;
			}
			const FString Name = Ar->name && Ar->name[0] ? FString(UTF8_TO_TCHAR(Ar->name)) : FString(TEXT("<C>"));
			return TEXT("UE.") + Name;
		}
		const FString Module = ModuleOfSource(Ar->source, Ar->short_src);
		if (Ar->what && FCStringAnsi::Strcmp(Ar->what, "main") == 0)
		{
			return Module + TEXT(":(main)");
		}
		if (Ar->name && Ar->name[0] && FCStringAnsi::Strcmp(Ar->name, "?") != 0)
		{
			return Module + TEXT(":") + UTF8_TO_TCHAR(Ar->name);
		}
		const FString Field = FieldInModule(L, Module, FnIdx);
		if (!Field.IsEmpty())
		{
			return Module + TEXT(":") + Field;
		}
		return FString::Printf(TEXT("%s:%d"), *Module, Ar->linedefined);
	}

#if !UELINK_LUA_TRACE

	bool WantsCallHook() { return false; }
	void OnHook(lua_State*, lua_Debug*) {}
	void OnLuaError(lua_State*) {}

#else

	using namespace UELinkLuaTraceChannels;

	// ---------- trace 的运行状态（游戏线程；只有录制开关是跨线程的原子量） ----------

	// 不叫 FFrame：UObject 里有个全局的 FFrame（蓝图调用栈）
	struct FLuaFrame
	{
		uint32 Spec = 0;
		/** 进这个函数时的栈层数（lua_getstack 数出来的），按层数对齐而不是按个数，见 lua.profile */
		int32 Depth = 0;
		/** 已经发了开始、还没发结束 */
		bool bEmitted = false;
	};

	struct FTraceState
	{
		/** 录制委托（可能不在游戏线程）只改这几个 */
		std::atomic<bool> bRecording{ false };
		std::atomic<uint32> Serial{ 0 };
		std::atomic<bool> bTickerOn{ false };

		FTSTicker::FDelegateHandle Tick;
		FDelegateHandle Started;
		FDelegateHandle Stopped;
		bool bRegistered = false;

		uint32 SeenSerial = 0;
		bool bActive = false;
		bool bWithC = false;
		bool bWarnedTaken = false;
		lua_State* Main = nullptr;

		/** Lua 函数按「来源 + 定义行」、C 函数按闭包指针缓存 spec id：每次调用只发一个 id，不发字符串 */
		TMap<uint64, uint32> LuaSpecs;
		TMap<const void*, uint32> CSpecs;
		TMap<lua_State*, TArray<FLuaFrame>> Stacks;
		/** 发了开始还没结束的帧各属于哪个 lua_State，按发出顺序（就是游戏线程上 CPU 作用域栈里 Lua 的那几层） */
		TArray<lua_State*> Emitted;

		uint64 ActiveSince = 0;
		uint64 LuaCycles = 0;
		int64 Calls = 0;
		int32 Residue = 0;
	};

	FTraceState& Ts()
	{
		static FTraceState S;
		return S;
	}

	bool WantsCallHook()
	{
		return Ts().bActive;
	}

	int32 StackDepth(lua_State* L)
	{
		lua_Debug Tmp;
		int32 N = 0;
		while (lua_getstack(L, N, &Tmp))
		{
			++N;
		}
		return N;
	}

	void Begin(FTraceState& T, lua_State* L, FLuaFrame& F)
	{
		if (T.Emitted.Num() == 0)
		{
			T.ActiveSince = FPlatformTime::Cycles64();
		}
		UELINK_CPU_BEGIN(F.Spec);
		F.bEmitted = true;
		T.Emitted.Add(L);
	}

	/** 结束全局栈最上面那一帧：它属于哪个 lua_State，就把那个影子栈里最上面一个已发出的帧标成没发出（之后可能重新开始） */
	void EndTop(FTraceState& T)
	{
		if (T.Emitted.Num() == 0)
		{
			return;
		}
		lua_State* Owner = T.Emitted.Pop(EAllowShrinking::No);
		UELINK_CPU_END();
		if (T.Emitted.Num() == 0)
		{
			const uint64 Now = FPlatformTime::Cycles64();
			T.LuaCycles += Now > T.ActiveSince ? Now - T.ActiveSince : 0;
		}
		if (TArray<FLuaFrame>* Stack = T.Stacks.Find(Owner))
		{
			for (int32 I = Stack->Num() - 1; I >= 0; --I)
			{
				if ((*Stack)[I].bEmitted)
				{
					(*Stack)[I].bEmitted = false;
					break;
				}
			}
		}
	}

	void EndAll(FTraceState& T)
	{
		while (T.Emitted.Num())
		{
			EndTop(T);
		}
	}

	/** 这个 lua_State 在全局栈里最上面一帧的位置；没有返回 INDEX_NONE */
	int32 TopEntryOf(const FTraceState& T, lua_State* L)
	{
		for (int32 I = T.Emitted.Num() - 1; I >= 0; --I)
		{
			if (T.Emitted[I] == L)
			{
				return I;
			}
		}
		return INDEX_NONE;
	}

	/** 「接着跑」：事件的层数不比影子栈顶深一层以上（深得多说明中间隔着 C++，是从 C++ 回调进来的） */
	bool Continuing(const TArray<FLuaFrame>& Stack, int32 D)
	{
		return Stack.Num() == 0 || D <= Stack.Last().Depth + 1;
	}

	/** 协程切换：L 接着跑时，压在它最上面一帧之上的、别的协程的帧先结束 */
	void SwitchTo(FTraceState& T, lua_State* L, const TArray<FLuaFrame>& Stack, int32 D)
	{
		if (T.Emitted.Num() == 0 || T.Emitted.Last() == L || !Continuing(Stack, D))
		{
			return;
		}
		const int32 At = TopEntryOf(T, L);
		if (At == INDEX_NONE)
		{
			// L 没有发出去的帧：被 resume 起来的协程，嵌在上面就对了
			return;
		}
		while (T.Emitted.Num() > At + 1)
		{
			EndTop(T);
		}
	}

	/** 结束并弹出层数不小于 MinDepth 的帧（正在返回的、被报错跳过的、被尾调用替换的） */
	void Unwind(FTraceState& T, lua_State* L, TArray<FLuaFrame>& Stack, int32 MinDepth)
	{
		while (Stack.Num() && Stack.Last().Depth >= MinDepth)
		{
			if (Stack.Last().bEmitted)
			{
				// 发出去的帧要从全局栈顶结束：上面还压着别的（不该有，防御）也先结束，保证成对
				const int32 At = TopEntryOf(T, L);
				while (At != INDEX_NONE && T.Emitted.Num() > At + 1)
				{
					EndTop(T);
				}
				EndTop(T);
			}
			Stack.Pop(EAllowShrinking::No);
		}
	}

	/** 切回来（协程恢复、报错收尾后回到外层）：影子栈顶上那段没发出的帧按顺序重新开始 */
	void Rebegin(FTraceState& T, lua_State* L, TArray<FLuaFrame>& Stack, int32 D)
	{
		if (Stack.Num() == 0 || Stack.Last().bEmitted || !Continuing(Stack, D))
		{
			return;
		}
		int32 First = Stack.Num() - 1;
		while (First > 0 && !Stack[First - 1].bEmitted)
		{
			--First;
		}
		for (int32 I = First; I < Stack.Num(); ++I)
		{
			Begin(T, L, Stack[I]);
		}
	}

	uint32 SpecFor(FTraceState& T, lua_State* L, lua_Debug* Ar, int Fn, bool bC)
	{
		if (bC)
		{
			// UnLua 导出的每个 UE 函数是一个带上值的 C 闭包（同一个 C 函数指针），按闭包分才能分出 UE.GetVelocity 和 UE.Load
			const void* Key = lua_topointer(L, Fn);
			if (const uint32* Hit = T.CSpecs.Find(Key))
			{
				return *Hit;
			}
			lua_getinfo(L, "n", Ar);
			const FString Name = FunctionName(L, Ar, Fn);
			const uint32 Id = UELINK_CPU_EVENT_TYPE(*Name, "<lua:C>", 0);
			T.CSpecs.Add(Key, Id);
			return Id;
		}
		const char* Src = Ar->source ? Ar->source : "?";
		const uint64 Key = CityHash64WithSeed(Src, FCStringAnsi::Strlen(Src), static_cast<uint64>(Ar->linedefined));
		if (const uint32* Hit = T.LuaSpecs.Find(Key))
		{
			return *Hit;
		}
		lua_getinfo(L, "n", Ar);
		const FString Name = FunctionName(L, Ar, Fn);
		// 文件是完整路径（chunkname 去掉 @）：Insights 的提示和面板的「来源」列用它；不是文件的 chunk 用 short_src
		const char* File = Ar->source && Ar->source[0] == '@' ? Ar->source + 1 : Ar->short_src;
		const uint32 Id = UELINK_CPU_EVENT_TYPE(*Name, File, FMath::Max(0, Ar->linedefined));
		T.LuaSpecs.Add(Key, Id);
		return Id;
	}

	void OnHook(lua_State* L, lua_Debug* Ar)
	{
		FTraceState& T = Ts();
		if (!T.bActive)
		{
			return;
		}
		const int Ev = Ar->event;
		const int32 D = StackDepth(L);
		TArray<FLuaFrame>& Stack = T.Stacks.FindOrAdd(L);
		SwitchTo(T, L, Stack, D);
		// 调用和尾调用：比它深或一样深的是被报错跳过的、被尾调用替换的；返回：第 D 层就是正在返回的
		Unwind(T, L, Stack, D);
		Rebegin(T, L, Stack, D);
		if (Ev == LUA_HOOKRET)
		{
			return;
		}
		++T.Calls;
		const int Top = lua_gettop(L);
		if (!lua_getinfo(L, "Sf", Ar))
		{
			return;
		}
		const int Fn = lua_gettop(L);
		const bool bC = Ar->what && FCStringAnsi::Strcmp(Ar->what, "C") == 0;
		if (bC && Std().Yield && FnKey(lua_tocfunction(L, Fn)) == Std().Yield)
		{
			// 协程要挂起了：yield 回到谁那里都没有这个协程的返回事件，先把它的帧结束，恢复时（yield 返回）再重新开始
			while (TopEntryOf(T, L) != INDEX_NONE)
			{
				EndTop(T);
			}
			lua_settop(L, Top);
			return;
		}
		if (!bC || T.bWithC)
		{
			FLuaFrame F;
			F.Spec = SpecFor(T, L, Ar, Fn, bC);
			F.Depth = D;
			Stack.Add(F);
			Begin(T, L, Stack.Last());
		}
		// luac 没开时 C 函数不出块，时间自然算进调用它的 Lua 函数
		lua_settop(L, Top);
	}

	void OnLuaError(lua_State* L)
	{
		FTraceState& T = Ts();
		if (!T.bActive || !L)
		{
			return;
		}
		// 报错处理函数里出错的栈还在：从栈顶往下，跳过报错用的 C 函数（error、处理函数），过了 Lua 帧以后遇到的第一个 C 函数
		// 就是这次调用进来的边界（UE 接口，C++ 从那里又调进了 Lua）。边界之上的帧马上就会被 longjmp 跳过，没有返回事件
		const int32 Total = StackDepth(L);
		int32 Boundary = 0;
		bool bSeenLua = false;
		lua_Debug A;
		for (int32 Level = 0; lua_getstack(L, Level, &A); ++Level)
		{
			if (!lua_getinfo(L, "S", &A))
			{
				break;
			}
			const bool bC = A.what && FCStringAnsi::Strcmp(A.what, "C") == 0;
			if (!bC)
			{
				bSeenLua = true;
			}
			else if (bSeenLua)
			{
				Boundary = Total - Level;
				break;
			}
		}
		// 先把全部 Lua 帧结束（报错是在 UE 的作用域里面接住的，过一会儿 UE 的作用域就要结束了）；
		// 边界以下的外层帧还活着，留在影子栈里，回到它们时（层数对上）再重新开始
		EndAll(T);
		if (TArray<FLuaFrame>* Stack = T.Stacks.Find(L))
		{
			while (Stack->Num() && Stack->Last().Depth > Boundary)
			{
				Stack->Pop(EAllowShrinking::No);
			}
		}
	}

	// ---------- 每帧：通道开关、收尾、计数器 ----------

	void ResetRuntime(FTraceState& T)
	{
		EndAll(T);
		T.Stacks.Reset();
		T.Emitted.Reset();
		T.LuaCycles = 0;
		T.Calls = 0;
	}

	void Deactivate(FTraceState& T, lua_State* Current)
	{
		if (!T.bActive)
		{
			return;
		}
		ResetRuntime(T);
		T.bActive = false;
		lua_State* Old = T.Main;
		T.Main = nullptr;
		if (T.Residue > 0)
		{
			UE_LOG(LogUELinkLuaTrace, Warning, TEXT("UELink：这次录制里有 %d 帧 Lua 没正常收尾（报错跳出且项目没接 FAgentPanelLua::CaptureError，或 C 里直接 yield），那几帧的 Lua 块可能错位"), T.Residue);
		}
		T.Residue = 0;
		// 旧环境已经关了（PIE 停了）时不能再碰它；钩子由 UpdateHook 按现在还要什么放回去
		if (Old && Old == Current)
		{
			AgentPanelLuaDebug::UpdateHook(Old);
		}
	}

	void Activate(FTraceState& T, lua_State* L)
	{
		T.Main = L;
		T.bActive = true;
		T.bWarnedTaken = false;
		T.Residue = 0;
		ResetRuntime(T);
		PrepareNames(L);
		AgentPanelLuaDebug::UpdateHook(L);
		UE_LOG(LogUELinkLuaTrace, Log, TEXT("UELink：trace 开了 lua 通道，Lua 函数调用写进 trace（录制期间 Lua 会变慢一些）"));
	}

	/** 帧边界上 Lua 不该还在跑：还开着的是没收到返回的（报错没接住、C 里 yield），按影子栈全部收尾 */
	void FrameEnd(FTraceState& T)
	{
		if (T.Emitted.Num())
		{
			++T.Residue;
			EndAll(T);
		}
		// 主线程的影子栈到帧边界应该是空的；协程挂起的帧留着（已经结束过，恢复时重新开始）
		T.Stacks.Remove(T.Main);
		for (auto It = T.Stacks.CreateIterator(); It; ++It)
		{
			if (It.Value().Num() == 0)
			{
				It.RemoveCurrent();
			}
		}
		// 死掉的协程留下的影子栈没法判断（lua_State 可能已经释放，不能碰）：太多时整个清掉
		if (T.Stacks.Num() > 512)
		{
			T.Stacks.Reset();
		}
		if (T.Main && AgentPanelLuaDebug::HookTaken(T.Main) && !T.bWarnedTaken)
		{
			T.bWarnedTaken = true;
			UE_LOG(LogUELinkLuaTrace, Warning, TEXT("UELink：IDE 的 Lua 调试器接管了 Lua 钩子，这段录制里收不到 Lua 函数（不抢回来，免得 IDE 断点失灵）；要看 Lua 性能先断开调试器，或用 IDE 自带的采样"));
		}
#if UELINK_LUA_COUNTERS
		using namespace UELinkLuaTraceCounters;
		UELINK_TRACE_COUNTER_SET(UELinkLuaFrameMs, FPlatformTime::ToMilliseconds64(T.LuaCycles));
		UELINK_TRACE_COUNTER_SET(UELinkLuaCalls, T.Calls);
		if (T.Main)
		{
			UELINK_TRACE_COUNTER_SET(UELinkLuaMemoryKB, static_cast<int64>(lua_gc(T.Main, LUA_GCCOUNT, 0)));
		}
#endif
		T.LuaCycles = 0;
		T.Calls = 0;
	}

	/** 只在录制期间注册的每帧回调：读通道开关，开了挂钩子、关了摘钩子；停止录制后把自己注销 */
	bool OnFrame(float)
	{
		FTraceState& T = Ts();
		const bool bRecording = T.bRecording.load();
		const bool bWant = bRecording && UELINK_TRACE_CHANNEL_ON(LuaChannel) && UELINK_TRACE_CHANNEL_ON(CpuChannel);
		lua_State* L = nullptr;
		if (bWant || T.bActive)
		{
			FString Ignore;
			L = StateFor(nullptr, Ignore);
		}
		const uint32 Serial = T.Serial.load();
		if (T.bActive && (!bWant || L != T.Main || Serial != T.SeenSerial))
		{
			Deactivate(T, L);
		}
		if (Serial != T.SeenSerial)
		{
			// 新的一次录制：计时器定义不一定在新文件里，缓存清掉重新注册
			T.SeenSerial = Serial;
			T.LuaSpecs.Reset();
			T.CSpecs.Reset();
		}
		if (!T.bActive && bWant && L)
		{
			Activate(T, L);
		}
		if (T.bActive)
		{
			T.bWithC = UELINK_TRACE_CHANNEL_ON(LuaCChannel);
			FrameEnd(T);
		}
		if (!bRecording)
		{
			// 先放下标志再看一眼：刚好在这之间又开始录制时自己接着跑，不然那次录制就没人管 Lua 了
			T.bTickerOn.store(false);
			// 另一个线程这时已经加了新的回调（exchange 拿到 true）就让它接手；句柄不清，它可能刚写进去
			if (!T.bRecording.load() || T.bTickerOn.exchange(true))
			{
				return false;
			}
		}
		return true;
	}

	void EnsureFrameTicker()
	{
		FTraceState& T = Ts();
		if (!T.bTickerOn.exchange(true))
		{
			// 间隔 0 = 每帧；FTSTicker 可以在任意线程上加
			T.Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&OnFrame), 0.0f);
		}
	}

	void OnRecordingStarted()
	{
		FTraceState& T = Ts();
		T.Serial.fetch_add(1);
		T.bRecording.store(true);
		EnsureFrameTicker();
	}

	void OnRecordingStopped()
	{
		// 可能不在游戏线程：只放标志，摘钩子留给每帧回调在游戏线程上做
		Ts().bRecording.store(false);
	}

#endif
}

#if UELINK_LUA_TRACE

void AgentPanelRegisterLuaTrace()
{
	using namespace AgentPanelLuaTrace;
	FTraceState& T = Ts();
	if (T.bRegistered)
	{
		return;
	}
	T.bRegistered = true;
	// 委托的参数各版本不一样，这里都用不到：泛型 lambda 什么参数都接
	T.Started = UELINK_TRACE_ON_STARTED.AddLambda([](auto&&...) { OnRecordingStarted(); });
	T.Stopped = UELINK_TRACE_ON_STOPPED.AddLambda([](auto&&...) { OnRecordingStopped(); });
	// -trace=default,lua 命令行启动时，录制在这个模块加载前就开始了
	if (UELINK_TRACE_IS_RECORDING())
	{
		OnRecordingStarted();
	}
}

void AgentPanelUnregisterLuaTrace()
{
	using namespace AgentPanelLuaTrace;
	FTraceState& T = Ts();
	if (!T.bRegistered)
	{
		return;
	}
	T.bRegistered = false;
	UELINK_TRACE_ON_STARTED.Remove(T.Started);
	UELINK_TRACE_ON_STOPPED.Remove(T.Stopped);
	T.bRecording.store(false);
	if (T.Tick.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(T.Tick);
		T.Tick.Reset();
	}
	T.bTickerOn.store(false);
	// 模块关闭时 Lua 环境可能已经没了：不碰 lua_State，只停止发事件
	T.bActive = false;
	T.Main = nullptr;
	T.Stacks.Reset();
	T.Emitted.Reset();
}

#else

void AgentPanelRegisterLuaTrace() {}
void AgentPanelUnregisterLuaTrace() {}

#endif

#endif
