// Lua 深度调试（UE 插件优化与扩展设计稿 4.4，2.4.0 起）：快照点 lua.snap、性能采样 lua.profile、
// Lua 还拿着的已销毁 UObject lua.leaks。
//
// 只用 Lua 的 C 接口和调试钩子（lua_sethook），不碰 UnLua 的内部结构（用户的 UnLua 是二次开发过的分支）。
// 不做断点：桥接在游戏线程上处理请求，游戏线程一停桥接也停了；快照点只在那一行「记下」局部变量和调用栈，游戏照常跑。
//
// 钩子：一个 lua_State 只能挂一个钩子函数，快照点（行钩子）和采样（调用 / 返回钩子）共用 HookFn 分发。
// 挂上前记下原来的钩子（IDE 的 Lua 调试器常挂一个），每次事件按原来的掩码转给它；都撤了再把原来的放回去。
// 钩子按线程（协程）各自一份：挂上后新建的协程会继承，挂之前就在的协程里的代码看不到（回包 note 里说明）。
// 2.9.0 起 trace 的 lua 通道（AgentPanelLuaTrace.cpp）也走这里：录制中开了 lua 通道时要调用 / 返回事件，HookFn 转给它。
#include "AgentPanelLuaOps.h"

#if !AGENT_PANEL_WITH_LUA

void AgentPanelRegisterLuaDebugOps(FAgentPanelBridge&) {}

#else

#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"
#include "AgentPanelLuaShared.h"
#include "AgentPanelLuaTrace.h"
#include "Blueprint/UserWidget.h"
#include "Components/ActorComponent.h"
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "HAL/PlatformTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UObjectArray.h"
#include "UObject/UObjectIterator.h"
#include "lua.hpp"

namespace AgentPanelLuaDebug
{
	using namespace AgentPanel;
	using namespace AgentPanelLuaImpl;

	/** 同时最多几个快照点、每个最多命中几次（每次命中都要取局部变量，太多会拖慢游戏线程） */
	constexpr int32 MaxSnaps = 20;
	constexpr int32 MaxSnapHits = 20;
	/** 一次快照最多记多少个局部变量、upvalue、调用栈行 */
	constexpr int32 MaxLocals = 60;
	constexpr int32 MaxUpvalues = 30;
	constexpr int32 MaxStackLines = 30;
	/** 局部变量是表时顺带记它前几项简单值（快照是事后看的，没法再点进去） */
	constexpr int32 MaxShallow = 20;

	struct FSnap
	{
		int32 Id = 0;
		FString File;
		/** 按 / 分开、小写的路径段：和 chunkname 从后往前比 */
		TArray<FString> Segs;
		int32 Line = 0;
		int32 MaxHits = 1;
		int32 Hits = 0;
		double ExpiresAt = 0;
		bool bActive = true;
		FString Created;
		TArray<TSharedPtr<FJsonValue>> Captures;
	};

	struct FProfStat
	{
		FString Name;
		FString Src;
		/** 完整的文件路径（chunkname 以 @ 开头时才有）：short_src 太长会被截成 ...，网页拿它用编辑器打开 */
		FString File;
		FString What;
		int32 Line = 0;
		int64 Calls = 0;
		uint64 Total = 0;
		uint64 Self = 0;
	};

	struct FProfFrame
	{
		const void* Fn = nullptr;
		uint64 Start = 0;
		uint64 Child = 0;
		/** 进这个函数时的栈层数：影子栈可能比实际浅（采样开始前就进去的函数不在里面），按层数对齐而不是按个数 */
		int32 Depth = 0;
	};

	struct FDebugState
	{
		lua_State* Main = nullptr;
		bool bHooked = false;
		lua_Hook PrevHook = nullptr;
		int PrevMask = 0;
		int PrevCount = 0;

		TArray<FSnap> Snaps;
		int32 NextSnap = 1;
		/** 活着的快照点的行号：行钩子先比行号，命中了才取文件名比，平时每行只多一次查表 */
		TSet<int32> Lines;

		bool bProfiling = false;
		bool bProfDone = false;
		uint64 ProfBegin = 0;
		uint64 ProfEnd = 0;
		uint64 ProfStopped = 0;
		FString ProfStartedAt;
		int64 ProfEvents = 0;
		TMap<const void*, FProfStat> Stats;
		TMap<lua_State*, TArray<FProfFrame>> Stacks;
		FString ProfReport;

		FTSTicker::FDelegateHandle Tick;
	};

	FDebugState& St()
	{
		static FDebugState S;
		return S;
	}

	void HookFn(lua_State* L, lua_Debug* Ar);

	int NeedMask()
	{
		int M = 0;
		if (St().Lines.Num())
		{
			M |= LUA_MASKLINE;
		}
		if (St().bProfiling || AgentPanelLuaTrace::WantsCallHook())
		{
			M |= LUA_MASKCALL | LUA_MASKRET;
		}
		return M;
	}

	/**
	 * 按现在要什么把钩子挂上、改掩码或放回原来的。L 是这次请求拿到的 lua_State；和上次挂的不是同一个时
	 * （PIE 重开、Lua 环境重建）旧的那个可能已经关了，不再碰它
	 */
	void UpdateHook(lua_State* L)
	{
		FDebugState& S = St();
		if (S.bHooked && S.Main != L)
		{
			S.bHooked = false;
			S.Main = nullptr;
		}
		const int Need = NeedMask();
		if (Need)
		{
			const lua_Hook Cur = lua_gethook(L);
			if (!S.bHooked)
			{
				if (Cur != &HookFn)
				{
					S.PrevHook = Cur;
					S.PrevMask = lua_gethookmask(L);
					S.PrevCount = lua_gethookcount(L);
				}
				S.Main = L;
				S.bHooked = true;
			}
			else if (Cur != &HookFn)
			{
				// 挂上之后别人（IDE 的 Lua 调试器）换了钩子：不抢回来。以前每帧发现掩码不对就重新挂，
				// 会把调试器的钩子顶掉，IDE 的断点、单步时灵时不灵。快照点 / 采样这时收不到事件，查询时有 warning。
				if (Cur != nullptr)
				{
					return;
				}
				// 调试器断开时会把钩子清掉：重新接上。原来记下的「前一个钩子」就是它，已经不在了，不再转发
				S.PrevHook = nullptr;
				S.PrevMask = 0;
				S.PrevCount = 0;
			}
			lua_sethook(L, &HookFn, Need | S.PrevMask, S.PrevCount);
		}
		else if (S.bHooked)
		{
			// 别人（IDE 调试器）在我们之后换了钩子：不去动它
			if (lua_gethook(L) == &HookFn)
			{
				lua_sethook(L, S.PrevHook, S.PrevMask, S.PrevCount);
			}
			S.bHooked = false;
			S.Main = nullptr;
		}
	}

	/** 钩子还是不是我们的：IDE 的调试器连上后会换掉，快照点和采样就收不到事件了 */
	bool HookTaken(lua_State* L)
	{
		return St().bHooked && L == St().Main && lua_gethook(L) != &HookFn;
	}

	FString NowIso()
	{
		return FDateTime::UtcNow().ToIso8601();
	}

	double NowSec()
	{
		return FPlatformTime::Seconds();
	}

	// ---------- 文件匹配：chunkname 的写法各分支不一样（绝对路径、相对脚本根、模块名），按路径段从后往前比 ----------

	TArray<FString> PathSegs(FString P)
	{
		P.TrimStartAndEndInline();
		if (P.StartsWith(TEXT("@")) || P.StartsWith(TEXT("=")))
		{
			P.RightChopInline(1);
		}
		P.ReplaceInline(TEXT("\\"), TEXT("/"));
		P = P.ToLower();
		// 模块名（UI.BagPanel）或没带扩展名的：点换成目录
		if (!P.EndsWith(TEXT(".lua")) && !P.Contains(TEXT("/")))
		{
			P = P.Replace(TEXT("."), TEXT("/")) + TEXT(".lua");
		}
		else if (!P.EndsWith(TEXT(".lua")))
		{
			P += TEXT(".lua");
		}
		TArray<FString> Out;
		P.ParseIntoArray(Out, TEXT("/"), true);
		return Out;
	}

	/** 短的那个整个是长的那个的结尾（按段比）：/x/Content/Script/UI/Bag.lua 和 UI/Bag.lua 算同一个文件 */
	bool SameFile(const TArray<FString>& A, const TArray<FString>& B)
	{
		const int32 K = FMath::Min(A.Num(), B.Num());
		if (K == 0)
		{
			return false;
		}
		for (int32 I = 1; I <= K; ++I)
		{
			if (A[A.Num() - I] != B[B.Num() - I])
			{
				return false;
			}
		}
		return true;
	}

	// ---------- 快照点 ----------

	void RebuildLines()
	{
		FDebugState& S = St();
		S.Lines.Reset();
		for (const FSnap& Snap : S.Snaps)
		{
			if (Snap.bActive)
			{
				S.Lines.Add(Snap.Line);
			}
		}
	}

	/** 表的前几项简单值（只用 lua_next，不触发元方法） */
	void ShallowFields(lua_State* L, int Idx, const TSharedPtr<FJsonObject>& F)
	{
		Idx = lua_absindex(L, Idx);
		TArray<TSharedPtr<FJsonValue>> Items;
		lua_pushnil(L);
		while (lua_next(L, Idx))
		{
			const int VT = lua_type(L, -1);
			const int KT = lua_type(L, -2);
			if ((KT == LUA_TSTRING || KT == LUA_TNUMBER) && (VT == LUA_TNUMBER || VT == LUA_TSTRING || VT == LUA_TBOOLEAN))
			{
				TSharedPtr<FJsonObject> E = MakeShared<FJsonObject>();
				// lua_tolstring 会把数字键原地改成字符串、搅乱 lua_next：先复制一份键
				lua_pushvalue(L, -2);
				size_t N = 0;
				const char* K = lua_tolstring(L, -1, &N);
				E->SetStringField(TEXT("k"), FromUtf8(K, N));
				lua_pop(L, 1);
				if (VT == LUA_TBOOLEAN)
				{
					E->SetBoolField(TEXT("v"), lua_toboolean(L, -1) != 0);
				}
				else if (VT == LUA_TNUMBER)
				{
					E->SetNumberField(TEXT("v"), lua_tonumber(L, -1));
				}
				else
				{
					size_t VN = 0;
					const char* V = lua_tolstring(L, -1, &VN);
					E->SetStringField(TEXT("v"), FromUtf8(V, VN).Left(200));
				}
				Items.Add(MakeShared<FJsonValueObject>(E));
			}
			lua_pop(L, 1);
			if (Items.Num() >= MaxShallow)
			{
				lua_pop(L, 1);
				break;
			}
		}
		if (Items.Num())
		{
			F->SetArrayField(TEXT("fields"), Items);
		}
	}

	TSharedPtr<FJsonObject> DescribeVar(FLuaCtx& C, const char* Name, int Idx)
	{
		TSharedPtr<FJsonObject> F = MakeShared<FJsonObject>();
		F->SetStringField(TEXT("name"), UTF8_TO_TCHAR(Name ? Name : "?"));
		Describe(C, Idx, F);
		if (lua_type(C.L, Idx) == LUA_TTABLE)
		{
			ShallowFields(C.L, Idx, F);
		}
		return F;
	}

	/** 在命中的那一帧记下函数、局部变量、upvalue 和调用栈 */
	TSharedPtr<FJsonObject> Capture(lua_State* L, lua_Debug* Ar)
	{
		FTop Guard(L);
		lua_checkstack(L, 20);
		FLuaCtx C;
		C.L = L;
		if (PushObjectMap(L))
		{
			C.Map = lua_gettop(L);
		}
		TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
		Out->SetStringField(TEXT("at"), NowIso());
		lua_getinfo(L, "nSlf", Ar);
		const int Fn = lua_gettop(L);
		Out->SetStringField(TEXT("fn"), UTF8_TO_TCHAR(Ar->name ? Ar->name : "?"));
		Out->SetStringField(TEXT("src"), UTF8_TO_TCHAR(Ar->short_src));
		Out->SetNumberField(TEXT("line"), Ar->currentline);
		if (Ar->source && Ar->source[0] == '@')
		{
			Out->SetStringField(TEXT("file"), UTF8_TO_TCHAR(Ar->source + 1));
		}

		TArray<TSharedPtr<FJsonValue>> Locals;
		for (int I = 1; Locals.Num() < MaxLocals; ++I)
		{
			const char* Name = lua_getlocal(L, Ar, I);
			if (!Name)
			{
				break;
			}
			// (temporary)、(for state) 这类是虚拟机内部的槽，不是变量
			if (Name[0] != '(')
			{
				Locals.Add(MakeShared<FJsonValueObject>(DescribeVar(C, Name, -1)));
			}
			lua_pop(L, 1);
		}
		Out->SetArrayField(TEXT("locals"), Locals);

		TArray<TSharedPtr<FJsonValue>> Ups;
		for (int I = 1; Ups.Num() < MaxUpvalues; ++I)
		{
			const char* Name = lua_getupvalue(L, Fn, I);
			if (!Name)
			{
				break;
			}
			if (Name[0] && FCStringAnsi::Strcmp(Name, "_ENV") != 0)
			{
				Ups.Add(MakeShared<FJsonValueObject>(DescribeVar(C, Name, -1)));
			}
			lua_pop(L, 1);
		}
		if (Ups.Num())
		{
			Out->SetArrayField(TEXT("upvalues"), Ups);
		}

		luaL_traceback(L, L, nullptr, 0);
		size_t N = 0;
		const char* Tb = lua_tolstring(L, -1, &N);
		TArray<FString> Lines;
		FromUtf8(Tb, N).ParseIntoArrayLines(Lines);
		TArray<TSharedPtr<FJsonValue>> Stack;
		for (const FString& Line : Lines)
		{
			const FString T = Line.TrimStartAndEnd();
			if (T.IsEmpty() || T == TEXT("stack traceback:"))
			{
				continue;
			}
			Stack.Add(MakeShared<FJsonValueString>(T));
			if (Stack.Num() >= MaxStackLines)
			{
				break;
			}
		}
		Out->SetArrayField(TEXT("stack"), Stack);
		return Out;
	}

	void OnLine(lua_State* L, lua_Debug* Ar)
	{
		FDebugState& S = St();
		const double Now = NowSec();
		if (!lua_getinfo(L, "S", Ar) || !Ar->source)
		{
			return;
		}
		const TArray<FString> Src = PathSegs(UTF8_TO_TCHAR(Ar->source));
		bool bChanged = false;
		for (FSnap& Snap : S.Snaps)
		{
			if (!Snap.bActive || Snap.Line != Ar->currentline || !SameFile(Snap.Segs, Src))
			{
				continue;
			}
			if (Now > Snap.ExpiresAt)
			{
				Snap.bActive = false;
				bChanged = true;
				continue;
			}
			TSharedPtr<FJsonObject> Cap = Capture(L, Ar);
			Snap.Captures.Add(MakeShared<FJsonValueObject>(Cap));
			++Snap.Hits;
			if (Snap.Hits >= Snap.MaxHits)
			{
				// 命中够了自动撤掉，免得一直拖慢这一行
				Snap.bActive = false;
				bChanged = true;
			}
			TSharedRef<FJsonObject> Ev = MakeShared<FJsonObject>();
			Ev->SetNumberField(TEXT("id"), Snap.Id);
			Ev->SetNumberField(TEXT("hits"), Snap.Hits);
			Ev->SetNumberField(TEXT("max"), Snap.MaxHits);
			Ev->SetBoolField(TEXT("active"), Snap.bActive);
			Ev->SetObjectField(TEXT("capture"), Cap);
			FAgentPanelBridge::Get().PublishEvent(TEXT("lua.snap"), Ev);
		}
		if (bChanged)
		{
			// 只改记录，钩子掩码留给定时器（钩子里换钩子虽然允许，放在外面更稳）
			RebuildLines();
		}
	}

	// ---------- 性能采样：调用 / 返回钩子，按函数（闭包）累计用时 ----------

	/** 当前调用栈有几层（出错时 longjmp 跳过的帧没有返回事件，靠层数把影子栈对齐） */
	int32 Depth(lua_State* L)
	{
		lua_Debug Tmp;
		int32 N = 0;
		while (lua_getstack(L, N, &Tmp))
		{
			++N;
		}
		return N;
	}

	void Account(const FProfFrame& F, uint64 Now, TArray<FProfFrame>& Stack)
	{
		const uint64 Elapsed = Now > F.Start ? Now - F.Start : 0;
		if (FProfStat* Stat = St().Stats.Find(F.Fn))
		{
			Stat->Total += Elapsed;
			Stat->Self += Elapsed > F.Child ? Elapsed - F.Child : 0;
		}
		if (Stack.Num())
		{
			Stack.Last().Child += Elapsed;
		}
	}

	/** 结算并弹出层数不小于 MinDepth 的帧（被错误跳过的、被尾调用替换的、正在返回的） */
	void Unwind(TArray<FProfFrame>& Stack, int32 MinDepth, uint64 Now)
	{
		while (Stack.Num() && Stack.Last().Depth >= MinDepth)
		{
			const FProfFrame F = Stack.Pop(EAllowShrinking::No);
			Account(F, Now, Stack);
		}
	}

	void OnCallRet(lua_State* L, lua_Debug* Ar)
	{
		FDebugState& S = St();
		const uint64 Now = FPlatformTime::Cycles64();
		if (Now >= S.ProfEnd)
		{
			// 到时间了：先停记录，钩子掩码由定时器放回
			S.bProfiling = false;
			S.ProfStopped = Now;
			return;
		}
		++S.ProfEvents;
		TArray<FProfFrame>& Stack = S.Stacks.FindOrAdd(L);
		const int32 D = Depth(L);
		if (Ar->event == LUA_HOOKRET)
		{
			// 返回的是第 D 层；比它深的是出错时 longjmp 跳过、没有返回事件的帧。采样开始前就进去的函数不在影子栈里，弹不到它
			Unwind(Stack, D, Now);
			return;
		}
		// 调用和尾调用：尾调用替换了当前帧，旧的那帧没有返回事件，按层数对齐时一起结算
		Unwind(Stack, D, Now);
		lua_getinfo(L, "f", Ar);
		const int FnIdx = lua_gettop(L);
		const void* Fn = lua_topointer(L, FnIdx);
		FProfStat* Stat = S.Stats.Find(Fn);
		if (!Stat)
		{
			Stat = &S.Stats.Add(Fn);
			if (lua_getinfo(L, "Sn", Ar))
			{
				// 2.9.0：和 trace 共用名字解析（模块:函数、模块表里的字段名、UE.*、lua.*），不再一堆 ?
				Stat->Name = AgentPanelLuaTrace::FunctionName(L, Ar, FnIdx);
				Stat->Src = UTF8_TO_TCHAR(Ar->short_src);
				Stat->What = UTF8_TO_TCHAR(Ar->what ? Ar->what : "");
				if (Ar->source && Ar->source[0] == '@')
				{
					Stat->File = UTF8_TO_TCHAR(Ar->source + 1);
				}
				Stat->Line = Ar->linedefined;
			}
		}
		lua_settop(L, FnIdx - 1);
		++Stat->Calls;
		Stack.Add({ Fn, Now, 0, D });
	}

	double Ms(uint64 Cycles)
	{
		return FPlatformTime::ToMilliseconds64(Cycles);
	}

	TSharedPtr<FJsonObject> StatJson(const FProfStat& Stat)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("fn"), Stat.Name);
		O->SetStringField(TEXT("src"), Stat.Src);
		O->SetNumberField(TEXT("line"), Stat.Line);
		if (!Stat.File.IsEmpty())
		{
			O->SetStringField(TEXT("file"), Stat.File);
		}
		O->SetBoolField(TEXT("c"), Stat.What == TEXT("C"));
		O->SetNumberField(TEXT("calls"), (double)Stat.Calls);
		O->SetNumberField(TEXT("totalMs"), FMath::RoundToDouble(Ms(Stat.Total) * 1000.0) / 1000.0);
		O->SetNumberField(TEXT("selfMs"), FMath::RoundToDouble(Ms(Stat.Self) * 1000.0) / 1000.0);
		return O;
	}

	FString SavedFile(const TCHAR* Dir, const FString& Prefix)
	{
		const FString Stamp = FDateTime::Now().ToString(TEXT("%Y%m%d-%H%M%S"));
		return FPaths::Combine(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()), TEXT("UELink"), Dir, Prefix + Stamp + TEXT(".json"));
	}

	bool WriteJsonFile(const FString& File, const TSharedRef<FJsonObject>& Obj)
	{
		FString Text;
		const TSharedRef<TJsonWriter<>> W = TJsonWriterFactory<>::Create(&Text);
		FJsonSerializer::Serialize(Obj, W);
		return FFileHelper::SaveStringToFile(Text, *File, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}

	/** 采样结束：没返回的帧按结束时间结算，完整结果写文件 */
	void FinishProfile()
	{
		FDebugState& S = St();
		if (S.bProfDone)
		{
			return;
		}
		S.bProfiling = false;
		S.bProfDone = true;
		if (!S.ProfStopped)
		{
			S.ProfStopped = FMath::Min(FPlatformTime::Cycles64(), S.ProfEnd);
		}
		for (TPair<lua_State*, TArray<FProfFrame>>& P : S.Stacks)
		{
			Unwind(P.Value, 0, S.ProfStopped);
		}
		S.Stacks.Reset();
		TArray<FProfStat> All;
		S.Stats.GenerateValueArray(All);
		All.Sort([](const FProfStat& A, const FProfStat& B) { return A.Self > B.Self; });
		TArray<TSharedPtr<FJsonValue>> Items;
		for (const FProfStat& Stat : All)
		{
			Items.Add(MakeShared<FJsonValueObject>(StatJson(Stat)));
		}
		TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
		Report->SetStringField(TEXT("startedAt"), S.ProfStartedAt);
		Report->SetNumberField(TEXT("seconds"), Ms(S.ProfStopped - S.ProfBegin) / 1000.0);
		Report->SetNumberField(TEXT("events"), (double)S.ProfEvents);
		Report->SetArrayField(TEXT("items"), Items);
		const FString File = SavedFile(TEXT("lua-profile"), TEXT("profile-"));
		S.ProfReport = WriteJsonFile(File, Report) ? File : FString();
	}

	// ---------- 定时器：快照点过期、采样到时间后把钩子放回（只在有东西挂着时跑） ----------

	bool OnTick(float)
	{
		FDebugState& S = St();
		const double Now = NowSec();
		bool bChanged = false;
		for (FSnap& Snap : S.Snaps)
		{
			if (Snap.bActive && Now > Snap.ExpiresAt)
			{
				Snap.bActive = false;
				bChanged = true;
			}
		}
		if (bChanged)
		{
			RebuildLines();
		}
		if (!S.bProfDone && S.ProfBegin && (!S.bProfiling || FPlatformTime::Cycles64() >= S.ProfEnd))
		{
			FinishProfile();
		}
		if (S.bHooked)
		{
			// 只碰现在能拿到的 lua_State：拿到的不是挂钩子的那个，说明旧环境已经关了（PIE 停了），不能再碰它
			FString Ignore;
			lua_State* L = StateFor(nullptr, Ignore);
			if (L == S.Main)
			{
				if (NeedMask() != (lua_gethookmask(L) & ~S.PrevMask))
				{
					UpdateHook(L);
				}
			}
			else
			{
				S.bHooked = false;
				S.Main = nullptr;
			}
		}
		const bool bKeep = S.bHooked || S.bProfiling;
		if (!bKeep)
		{
			S.Tick.Reset();
		}
		return bKeep;
	}

	void EnsureTick()
	{
		FDebugState& S = St();
		if (!S.Tick.IsValid())
		{
			S.Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&OnTick), 0.5f);
		}
	}

	void HookFn(lua_State* L, lua_Debug* Ar)
	{
		FDebugState& S = St();
		const int Ev = Ar->event;
		if (Ev == LUA_HOOKLINE)
		{
			if (S.Lines.Contains(Ar->currentline))
			{
				OnLine(L, Ar);
			}
		}
		else if (Ev == LUA_HOOKCALL || Ev == LUA_HOOKTAILCALL || Ev == LUA_HOOKRET)
		{
			if (S.bProfiling)
			{
				OnCallRet(L, Ar);
			}
			if (AgentPanelLuaTrace::WantsCallHook())
			{
				AgentPanelLuaTrace::OnHook(L, Ar);
			}
		}
		// 原来的钩子（IDE 调试器）照它自己要的事件转过去
		const int EvMask = Ev == LUA_HOOKTAILCALL ? LUA_MASKCALL : (1 << Ev);
		if (S.PrevHook && (S.PrevMask & EvMask))
		{
			S.PrevHook(L, Ar);
		}
		// 挂着时新建的协程继承了这个钩子，主线程摘了它们也摘不到：谁都不要事件了，就在它自己第一次进来时放回原来的，
		// 不然录完 trace / 采样完以后这些协程每次调用还进一趟钩子（2.9.0）
		if (L != S.Main && NeedMask() == 0)
		{
			lua_sethook(L, S.PrevHook, S.PrevMask, S.PrevCount);
		}
	}

	TSharedPtr<FJsonObject> SnapJson(const FSnap& Snap, bool bCaptures)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetNumberField(TEXT("id"), Snap.Id);
		O->SetStringField(TEXT("file"), Snap.File);
		O->SetNumberField(TEXT("line"), Snap.Line);
		O->SetNumberField(TEXT("hits"), Snap.Hits);
		O->SetNumberField(TEXT("max"), Snap.MaxHits);
		O->SetBoolField(TEXT("active"), Snap.bActive);
		O->SetStringField(TEXT("created"), Snap.Created);
		O->SetNumberField(TEXT("expiresIn"), FMath::Max(0.0, FMath::RoundToDouble(Snap.ExpiresAt - NowSec())));
		if (bCaptures)
		{
			O->SetArrayField(TEXT("captures"), Snap.Captures);
		}
		return O;
	}

	const TCHAR* CoroutineNote = TEXT("钩子挂上之前就已经在跑的协程看不到（挂上后新建的协程能看到）；IDE 的 Lua 调试器连着时钩子归它，断开后自动接上");

	// ---------- 持有的已销毁 UObject ----------

	bool IsLiveWorld(const UWorld* W)
	{
		if (!W || W->bIsTearingDown || !GEngine)
		{
			return false;
		}
		for (const FWorldContext& Ctx : GEngine->GetWorldContexts())
		{
			if (Ctx.World() == W)
			{
				return true;
			}
		}
		return false;
	}

	/**
	 * 现在活着的全部 UObject 的地址。对象表里要找的恰恰是「已经销毁」的项，它们的地址可能已经被释放：
	 * 不能像 GUObjectArray.IsValid 那样先读对象自己的内存（读已释放的内存可能直接崩），
	 * 先拿地址在这张表里查，查到了才当成对象去读。只在这个排查操作里建一次，几十万个对象也只是一次遍历。
	 */
	TSet<const UObjectBase*> CollectLiveObjects()
	{
		TSet<const UObjectBase*> Live;
		Live.Reserve(GUObjectArray.GetObjectArrayNumMinusAvailable());
		for (TObjectIterator<UObject> It(RF_NoFlags); It; ++It)
		{
			Live.Add(*It);
		}
		return Live;
	}

	/** 对象表里的一项有没有问题：已经不在了、已标记销毁、所在的世界没了（只看 Actor、组件、UMG 控件） */
	const TCHAR* MapEntryProblem(const void* P, const TSet<const UObjectBase*>& InLive, FString& OutPath, FString& OutClass)
	{
		const UObjectBase* Base = static_cast<const UObjectBase*>(P);
		if (!InLive.Contains(Base) || !GUObjectArray.IsValid(Base))
		{
			return TEXT("stale");
		}
		UObject* Obj = static_cast<UObject*>(const_cast<UObjectBase*>(Base));
		OutPath = Obj->GetPathName();
		OutClass = Obj->GetClass()->GetName();
		if (!IsValid(Obj))
		{
			return TEXT("garbage");
		}
		if (Obj->IsA<AActor>() || Obj->IsA<UActorComponent>() || Obj->IsA<UUserWidget>())
		{
			if (Obj->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
			{
				return nullptr;
			}
			if (!IsLiveWorld(Obj->GetWorld()))
			{
				return TEXT("noworld");
			}
		}
		return nullptr;
	}

	/** 引用链上的一段：字符串键写成 .name，别的写成 [值]，upvalue、元表写成 <...> */
	FString KeySeg(lua_State* L, int K)
	{
		const int T = lua_type(L, K);
		if (T == LUA_TSTRING)
		{
			size_t N = 0;
			const char* S = lua_tolstring(L, K, &N);
			const FString Key = FromUtf8(S, N).Left(80);
			bool bIdent = Key.Len() > 0 && !FChar::IsDigit(Key[0]);
			for (TCHAR Ch : Key)
			{
				bIdent &= FChar::IsAlnum(Ch) || Ch == TEXT('_');
			}
			return bIdent ? TEXT(".") + Key : FString::Printf(TEXT("[\"%s\"]"), *Key);
		}
		if (T == LUA_TNUMBER)
		{
			return lua_isinteger(L, K) ? FString::Printf(TEXT("[%lld]"), (long long)lua_tointeger(L, K)) : FString::Printf(TEXT("[%g]"), lua_tonumber(L, K));
		}
		if (T == LUA_TBOOLEAN)
		{
			return lua_toboolean(L, K) ? TEXT("[true]") : TEXT("[false]");
		}
		return FString::Printf(TEXT("[<%s>]"), UTF8_TO_TCHAR(lua_typename(L, T)));
	}

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

	FString WeakMode(lua_State* L, int T)
	{
		FString Mode;
		if (lua_getmetatable(L, T))
		{
			lua_pushstring(L, "__mode");
			lua_rawget(L, -2);
			if (lua_type(L, -1) == LUA_TSTRING)
			{
				Mode = UTF8_TO_TCHAR(lua_tostring(L, -1));
			}
			lua_pop(L, 2);
		}
		return Mode;
	}

	bool LeaksOp(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		lua_State* L = C.L;
		FTop Guard(L);
		if (!C.Map)
		{
			Error = TEXT("Lua 注册表里没找到 UnLua 的对象表（这个 UnLua 分支可能改了存法），没法判断哪些对象已经销毁");
			return false;
		}
		lua_checkstack(L, 64);
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 100), 1, 500);
		const FString ObjKey = Str(A, TEXT("objectKey"), TEXT("Object"));
		FTCHARToUTF8 ObjKeyUtf8(*ObjKey);
		const double Begin = NowSec();

		// 一、对象表：哪些表是 UnLua 认得的实例表；表里本身有问题的项（对象不在了、标记销毁、世界没了）
		lua_newtable(L);
		const int Inst = lua_gettop(L);
		lua_newtable(L);
		const int Flag = lua_gettop(L);
		TArray<TSharedPtr<FJsonObject>> Found;
		int32 Scanned = 0;
		const TSet<const UObjectBase*> LiveObjects = CollectLiveObjects();
		lua_pushnil(L);
		while (lua_next(L, C.Map))
		{
			if (lua_type(L, -2) == LUA_TLIGHTUSERDATA)
			{
				const void* P = lua_touserdata(L, -2);
				const bool bTable = lua_istable(L, -1);
				if (bTable)
				{
					lua_pushvalue(L, -1);
					lua_pushlightuserdata(L, const_cast<void*>(P));
					lua_rawset(L, Inst);
				}
				FString ObjPath, Class;
				if (const TCHAR* Kind = MapEntryProblem(P, LiveObjects, ObjPath, Class))
				{
					TSharedPtr<FJsonObject> E = MakeShared<FJsonObject>();
					E->SetStringField(TEXT("kind"), Kind);
					if (!ObjPath.IsEmpty())
					{
						E->SetStringField(TEXT("object"), ObjPath);
						E->SetStringField(TEXT("class"), Class);
					}
					if (bTable)
					{
						E->SetStringField(TEXT("module"), C.ModuleOf(-1));
						lua_pushvalue(L, -1);
						lua_pushinteger(L, Found.Num());
						lua_rawset(L, Flag);
					}
					Found.Add(E);
				}
			}
			lua_pop(L, 1);
			if (++Scanned >= 500000)
			{
				lua_pop(L, 1);
				break;
			}
		}

		// 二、走 Lua 堆：拿着实例表、但对象表里已经没有它的（UnLua 在对象销毁时会删掉对象表里的项）
		FHeapWalk W;
		W.L = L;
		W.Max = FMath::Clamp(Int(A, TEXT("maxVisit"), 200000), 1000, 1000000);
		lua_newtable(L);
		W.Q = lua_gettop(L);
		lua_newtable(L);
		W.Seen = lua_gettop(L);
		W.Block(C.Map);
		lua_pushglobaltable(L);
		W.Visit(0, TEXT("_G"));
		lua_pop(L, 1);
		lua_pushvalue(L, LUA_REGISTRYINDEX);
		W.Visit(0, TEXT("<registry>"));
		lua_pop(L, 1);

		TArray<TSharedPtr<FJsonObject>> Held;
		for (int32 I = 1; I <= W.Count; ++I)
		{
			lua_rawgeti(L, W.Q, I);
			const int V = lua_gettop(L);
			if (lua_istable(L, V))
			{
				// 对象表里有问题的那几项：记下 Lua 里是从哪拿着它的
				lua_pushvalue(L, V);
				lua_rawget(L, Flag);
				if (lua_isinteger(L, -1))
				{
					const int32 Idx = (int32)lua_tointeger(L, -1);
					if (Found.IsValidIndex(Idx) && !Found[Idx]->HasField(TEXT("path")))
					{
						Found[Idx]->SetStringField(TEXT("path"), W.PathOf(I));
					}
				}
				lua_pop(L, 1);

				// 像实例表（有 Object 字段是 userdata、有元表），却不在对象表里
				if (I > 2)
				{
					lua_pushvalue(L, V);
					lua_rawget(L, Inst);
					const bool bKnown = !lua_isnil(L, -1);
					lua_pop(L, 1);
					if (!bKnown && lua_getmetatable(L, V))
					{
						lua_pop(L, 1);
						// 用 rawget 取，不触发 __index（UnLua 的实例表 __index 会去找 UObject 的属性）
						lua_pushstring(L, ObjKeyUtf8.Get());
						lua_rawget(L, V);
						if (lua_type(L, -1) == LUA_TUSERDATA)
						{
							TSharedPtr<FJsonObject> E = MakeShared<FJsonObject>();
							E->SetStringField(TEXT("kind"), TEXT("destroyed"));
							E->SetStringField(TEXT("module"), C.ModuleOf(V));
							E->SetStringField(TEXT("path"), W.PathOf(I));
							Held.Add(E);
						}
						lua_pop(L, 1);
					}
				}

				const FString Mode = WeakMode(L, V);
				const bool bWeakK = Mode.Contains(TEXT("k"));
				const bool bWeakV = Mode.Contains(TEXT("v"));
				int32 N = 0;
				lua_pushnil(L);
				while (lua_next(L, V))
				{
					if (!bWeakV)
					{
						lua_pushvalue(L, -2);
						const FString Seg = KeySeg(L, -1);
						lua_pop(L, 1);
						W.Visit(I, Seg);
					}
					if (!bWeakK)
					{
						lua_pushvalue(L, -2);
						W.Visit(I, TEXT("[<key>]"));
						lua_pop(L, 1);
					}
					lua_pop(L, 1);
					if (++N >= 100000)
					{
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
				// 模块顶部 local 存的表（例如 local Panels = {}）只有经函数的 upvalue 才走得到
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

		Found.Append(Held);
		TArray<TSharedPtr<FJsonValue>> All;
		for (const TSharedPtr<FJsonObject>& E : Found)
		{
			All.Add(MakeShared<FJsonValueObject>(E));
		}
		TArray<TSharedPtr<FJsonValue>> Items(All.GetData(), FMath::Min(All.Num(), Limit));

		TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
		Report->SetStringField(TEXT("at"), NowIso());
		Report->SetArrayField(TEXT("items"), All);
		const FString File = SavedFile(TEXT("lua-leaks"), TEXT("leaks-"));
		if (WriteJsonFile(File, Report))
		{
			Out->SetStringField(TEXT("report"), File);
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), All.Num());
		Out->SetNumberField(TEXT("visited"), W.Count);
		Out->SetBoolField(TEXT("truncated"), W.bTruncated);
		Out->SetNumberField(TEXT("ms"), FMath::RoundToDouble((NowSec() - Begin) * 1000.0));
		Out->SetStringField(TEXT("note"), TEXT("destroyed 按「有 Object 字段的实例表不在 UnLua 对象表里」判断，是推测；协程栈上的局部变量没有走到"));
		return true;
	}
}

void AgentPanelRegisterLuaDebugOps(FAgentPanelBridge& B)
{
	using namespace AgentPanel;
	using namespace AgentPanelLuaDebug;

	B.AddOp(TEXT("lua.snap"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FDebugState& S = St();
		const FString Action = Str(A, TEXT("action"), TEXT("list"));
		if (Action == TEXT("list"))
		{
			const int32 Id = Int(A, TEXT("id"), 0);
			TArray<TSharedPtr<FJsonValue>> Items;
			for (const FSnap& Snap : S.Snaps)
			{
				if (!Id || Snap.Id == Id)
				{
					Items.Add(MakeShared<FJsonValueObject>(SnapJson(Snap, Id != 0)));
				}
			}
			if (Id && !Items.Num())
			{
				Error = FString::Printf(TEXT("没有编号 %d 的快照点（桥接重启后快照点会清空）"), Id);
				return false;
			}
			Out->SetArrayField(TEXT("items"), Items);
			FString Ignore;
			if (lua_State* L = StateFor(WorldContext(A), Ignore))
			{
				if (HookTaken(L))
				{
					Out->SetStringField(TEXT("warning"), TEXT("Lua 的调试钩子被 IDE 的 Lua 调试器接管了，快照点暂时收不到；调试器断开后自动接上"));
				}
			}
			return true;
		}
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		if (Action == TEXT("remove"))
		{
			const int32 Id = Int(A, TEXT("id"), 0);
			const int32 Removed = S.Snaps.RemoveAll([Id](const FSnap& Snap) { return !Id || Snap.Id == Id; });
			RebuildLines();
			UpdateHook(C.L);
			Out->SetNumberField(TEXT("removed"), Removed);
			return true;
		}
		if (Action != TEXT("add"))
		{
			Error = TEXT("action 只能是 add、list、remove");
			return false;
		}
		const FString File = Str(A, TEXT("file"));
		const int32 Line = Int(A, TEXT("line"), 0);
		if (File.IsEmpty() || Line <= 0)
		{
			Error = TEXT("要给 file（Lua 文件路径或模块名，如 UI/BagPanel.lua、UI.BagPanel）和 line（行号）");
			return false;
		}
		S.Snaps.RemoveAll([](const FSnap& Snap) { return !Snap.bActive && !Snap.Captures.Num(); });
		int32 Active = 0;
		for (const FSnap& Snap : S.Snaps)
		{
			Active += Snap.bActive ? 1 : 0;
		}
		if (Active >= MaxSnaps)
		{
			Error = FString::Printf(TEXT("同时最多 %d 个快照点，先撤掉不用的"), MaxSnaps);
			return false;
		}
		FSnap Snap;
		Snap.Id = S.NextSnap++;
		Snap.File = File;
		Snap.Segs = PathSegs(File);
		Snap.Line = Line;
		Snap.MaxHits = FMath::Clamp(Int(A, TEXT("hits"), 1), 1, MaxSnapHits);
		Snap.ExpiresAt = NowSec() + FMath::Clamp(Int(A, TEXT("ttlSec"), 600), 10, 3600);
		Snap.Created = NowIso();
		S.Snaps.Add(MoveTemp(Snap));
		RebuildLines();
		UpdateHook(C.L);
		EnsureTick();
		Out->SetObjectField(TEXT("snap"), SnapJson(S.Snaps.Last(), false));
		Out->SetStringField(TEXT("note"), CoroutineNote);
		return true;
	});

	B.AddOp(TEXT("lua.profile"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FDebugState& S = St();
		const FString Action = Str(A, TEXT("action"), TEXT("result"));
		if (Action == TEXT("start"))
		{
			if (S.bProfiling)
			{
				Error = TEXT("已经在采样了，等它结束或先 stop");
				return false;
			}
			FLuaCtx C;
			if (!C.Open(WorldContext(A), Error))
			{
				return false;
			}
			const int32 Seconds = FMath::Clamp(Int(A, TEXT("seconds"), 5), 1, 60);
			AgentPanelLuaTrace::PrepareNames(C.L);
			S.Stats.Reset();
			S.Stacks.Reset();
			S.ProfEvents = 0;
			S.ProfReport.Reset();
			S.bProfDone = false;
			S.ProfStopped = 0;
			S.ProfBegin = FPlatformTime::Cycles64();
			S.ProfEnd = S.ProfBegin + (uint64)(Seconds / FPlatformTime::GetSecondsPerCycle64());
			S.ProfStartedAt = NowIso();
			S.bProfiling = true;
			UpdateHook(C.L);
			EnsureTick();
			if (HookTaken(C.L))
			{
				Out->SetStringField(TEXT("warning"), TEXT("IDE 的 Lua 调试器连着，Lua 钩子归它，这次采样收不到事件；改用 IDE 的采样（调试窗口的采样，或 MCP lua_debug_inspect action=profile）"));
			}
			Out->SetBoolField(TEXT("started"), true);
			Out->SetNumberField(TEXT("seconds"), Seconds);
			Out->SetStringField(TEXT("note"), CoroutineNote);
			return true;
		}
		if (Action == TEXT("stop"))
		{
			if (S.bProfiling)
			{
				S.ProfStopped = FPlatformTime::Cycles64();
				FinishProfile();
				FLuaCtx C;
				FString Ignore;
				if (C.Open(WorldContext(A), Ignore))
				{
					UpdateHook(C.L);
				}
			}
			Out->SetBoolField(TEXT("stopped"), true);
			return true;
		}
		if (Action != TEXT("result"))
		{
			Error = TEXT("action 只能是 start、stop、result");
			return false;
		}
		if (!S.ProfBegin)
		{
			Error = TEXT("还没有采样过：先 action=start");
			return false;
		}
		const bool bRunning = S.bProfiling && FPlatformTime::Cycles64() < S.ProfEnd;
		Out->SetBoolField(TEXT("running"), bRunning);
		if (bRunning)
		{
			Out->SetNumberField(TEXT("remaining"), FMath::CeilToDouble(Ms(S.ProfEnd - FPlatformTime::Cycles64()) / 1000.0));
			return true;
		}
		FinishProfile();
		const FString Sort = Str(A, TEXT("sort"), TEXT("self"));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 50), 1, 300);
		TArray<const FProfStat*> All;
		for (const TPair<const void*, FProfStat>& P : S.Stats)
		{
			All.Add(&P.Value);
		}
		All.Sort([&Sort](const FProfStat& X, const FProfStat& Y)
		{
			return Sort == TEXT("total") ? X.Total > Y.Total : Sort == TEXT("calls") ? X.Calls > Y.Calls : X.Self > Y.Self;
		});
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 I = 0; I < All.Num() && I < Limit; ++I)
		{
			Items.Add(MakeShared<FJsonValueObject>(StatJson(*All[I])));
		}
		Out->SetStringField(TEXT("startedAt"), S.ProfStartedAt);
		Out->SetNumberField(TEXT("seconds"), Ms(S.ProfStopped - S.ProfBegin) / 1000.0);
		Out->SetNumberField(TEXT("events"), (double)S.ProfEvents);
		Out->SetNumberField(TEXT("total"), All.Num());
		Out->SetArrayField(TEXT("items"), Items);
		if (!S.ProfReport.IsEmpty())
		{
			Out->SetStringField(TEXT("report"), S.ProfReport);
		}
		return true;
	});

	B.AddOp(TEXT("lua.leaks"), &LeaksOp);
}

#endif
