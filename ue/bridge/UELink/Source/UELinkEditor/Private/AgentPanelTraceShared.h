// trace.query 两个文件（AgentPanelTrace.cpp 和 2.9.0 起的 AgentPanelTraceLua.cpp）共用的结构和函数，不对外。
// 只能在 include 了 TraceServices 头文件之后 include。类型都放在具名命名空间 UELinkTrace 里，using namespace TraceServices
// 也只在这个命名空间里：单体构建（unity）把同模块的 .cpp 拼成一个编译单元，文件作用域的 using 会漏进别的文件（见 AgentPanelTrace.cpp 开头）。
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/TimingProfiler.h"
#include "UELinkCompat.h"

namespace UELinkTrace
{
using namespace TraceServices;

	/** GPU 泳道在请求里的编号（CPU 泳道用线程 id） */
	constexpr int32 GpuLane = -1;
	/** 调用树每层最多几个子节点、最多几层（butterfly 和 tree 共用） */
	constexpr int32 TreeMaxKids = 30;
	constexpr int32 TreeMaxDepth = 16;

	inline const ITimingProfilerTimerReader* AsReader(const ITimingProfilerTimerReader& R) { return &R; }
	inline const ITimingProfilerTimerReader* AsReader(const ITimingProfilerTimerReader* R) { return R; }

	/** 计时器 id → 名字。带元数据的计时器（id 最高位是 1）换成原始计时器，和 Insights 一样合在一起算 */
	struct FTimers
	{
		const ITimingProfilerTimerReader* Reader = nullptr;

		explicit FTimers(const ITimingProfilerProvider& TP)
		{
#if UELINK_TRACE_TIMER_READER
			// 5.8 起 ReadTimers 弃用，改 GetTimerReader()；返回引用还是指针都接得住
			Reader = AsReader(TP.GetTimerReader());
#else
			TP.ReadTimers([this](const ITimingProfilerTimerReader& R) { Reader = &R; });
#endif
		}

		uint32 Resolve(uint32 Index) const
		{
			if (Reader && static_cast<int32>(Index) < 0)
			{
				return Reader->GetOriginalTimerIdFromMetadata(Index);
			}
			return Index;
		}

		FString Name(uint32 Id) const
		{
			const TraceServices::FTimingProfilerTimer* T = Reader ? Reader->GetTimer(Id) : nullptr;
			return T && T->Name ? FString(T->Name) : FString::Printf(TEXT("<timer %u>"), Id);
		}

		/** 计时器注册时带的源文件（OutputEventType 的 File），没有时空串 */
		const TCHAR* File(uint32 Id) const
		{
			const TraceServices::FTimingProfilerTimer* T = Reader ? Reader->GetTimer(Id) : nullptr;
			const TCHAR* F = T ? UELINK_TIMER_FILE(T) : nullptr;
			return F ? F : TEXT("");
		}

		uint32 Line(uint32 Id) const
		{
			const TraceServices::FTimingProfilerTimer* T = Reader ? Reader->GetTimer(Id) : nullptr;
			return T ? static_cast<uint32>(UELINK_TIMER_LINE(T)) : 0;
		}

		/**
		 * 是不是 UELink 写的 Lua 计时器（协议 9.1）：0 不是，1 Lua 函数（文件是 .lua），2 C 函数（文件是 <lua:C>）。
		 * 走泳道时每块都要问，按 id 记住
		 */
		int32 LuaKind(uint32 Id) const
		{
			if (const int8* Hit = Kinds.Find(Id))
			{
				return *Hit;
			}
			const TCHAR* F = File(Id);
			const int32 Len = FCString::Strlen(F);
			int8 Kind = 0;
			if (FCString::Strcmp(F, TEXT("<lua:C>")) == 0)
			{
				Kind = 2;
			}
			else if (Len >= 4 && FCString::Stricmp(F + Len - 4, TEXT(".lua")) == 0)
			{
				Kind = 1;
			}
			Kinds.Add(Id, Kind);
			return Kind;
		}

	private:
		mutable TMap<uint32, int8> Kinds;
	};

	/** 一块（一次作用域）走完时的回调：开始、结束（秒）、深度、计时器 id、它外面的调用栈（从根往里，不含自己） */
	struct FOpen
	{
		uint32 Timer;
		double Start;
		double Child;	// 子块的包含时间之和（算独占时间）
	};
	using FBlockFn = TFunctionRef<void(double Start, double End, int32 Depth, uint32 Timer, double ChildTime, const TArray<FOpen>& Parents)>;


	/**
	 * 无穷大 / NaN 换成 0：UE 的 JSON 写出来是 inf / nan，不是合法 JSON，面板整个回复都解析不了。
	 * 录制停在半帧时最后一帧的 EndTime 就是无穷大（帧条一直显示加载，就是这一帧把 frames 的回复弄坏了）
	 */
	inline double Fin(double X)
	{
		return FMath::IsFinite(X) ? X : 0.0;
	}

	struct FAgg
	{
		int64 Count = 0;
		double Incl = 0;
		double InclMax = 0;
		double Excl = 0;
		bool bGpu = false;
	};

	/** 调用树的一个节点：按计时器 id 合并同一路径上的调用 */
	struct FNode
	{
		int64 Count = 0;
		double Incl = 0;
		double Excl = 0;
		TMap<uint32, TUniquePtr<FNode>> Kids;

		FNode& Kid(uint32 Id)
		{
			TUniquePtr<FNode>& P = Kids.FindOrAdd(Id);
			if (!P)
			{
				P = MakeUnique<FNode>();
			}
			return *P;
		}
	};
	double Num(const TSharedPtr<FJsonObject>& A, const TCHAR* Key, double Default);
	/** 请求里的 lanes（泳道 id 列表）；没给时空，调用方用 AllLanes */
	TArray<int32> Lanes(const TSharedPtr<FJsonObject>& A);
	/** 所有泳道：GPU 在前，再按线程登记的顺序（Insights 的顺序） */
	TArray<int32> AllLanes(const IAnalysisSession& S, const ITimingProfilerProvider& TP);
	/**
	 * 按进出事件走一条泳道 [T0, T1]，自己维护调用栈。范围外开始、范围内还没结束的块也会给（时间按真实的）。
	 * 回调按块结束的顺序来（子块先于父块）。返回 false 表示这条泳道不存在
	 */
	bool Walk(const ITimingProfilerProvider& TP, const FTimers& Timers, int32 Lane, double T0, double T1, FBlockFn Fn);
	TSharedPtr<FJsonValue> NumArr(const TArray<double>& V);
	/** 毫秒保留 3 位小数 */
	double Ms(double Seconds);
	/** 树转 JSON：每层按包含时间倒序，最多 MaxKids 个、MaxDepth 层 */
	TSharedPtr<FJsonObject> TreeJson(uint32 Id, const FNode& N, const FTimers& Timers, int32 Depth);

	/** 请求里的布尔参数（没给或不是布尔时 false）。名字不叫 Flag：单体构建时会和 AgentPanelTraceLua.cpp 匿名命名空间里的撞名 */
	inline bool BoolArg(const TSharedPtr<FJsonObject>& A, const TCHAR* Key)
	{
		bool B = false;
		return A.IsValid() && A->TryGetBoolField(Key, B) && B;
	}

	// ---------- 查询预算（2.11）：查询在后台线程跑，单次有时间上限，编辑器退出时马上叫停 ----------
	/** 开始一次查询的计时（每个后台线程各记各的） */
	void BeginBudget(double Seconds);
	/**
	 * 超时或被叫停了没有：走事件的循环里每块都可以问，内部每 4096 次才真的看一次时钟。
	 * 超了以后一直返回 true，查询尽快收尾，回包标 truncated
	 */
	bool OverBudget();
	/** 这次查询有没有因为超时被截断 */
	bool BudgetHit();

	/** 游戏帧（Game）或渲染帧（Rendering）的开始和结束时间（秒），按帧号；还没结束的帧按 trace 结尾收 */
	void ReadFrames(const IAnalysisSession& S, bool bRender, TArray<double>& OutStart, TArray<double>& OutEnd);

	// AgentPanelTraceFrames.cpp（2.11）
	/** what=framestats：每帧每条线程忙了多久（深度 0 的块在帧内的部分），给瓶颈线程、卡顿归因用 */
	bool QueryFrameStats(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);
	/** what=framediff：一组帧和基线帧比，每帧独占时间涨得最多的计时器 */
	bool QueryFrameDiff(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);

	// AgentPanelTraceInfo.cpp（2.11）
	/** what=session：平台、构建配置、程序名、命令行，以及这份 trace 里有哪些数据 */
	void QuerySession(const IAnalysisSession& S, TSharedPtr<FJsonObject>& Out);
	/** what=regions：Timing Regions */
	bool QueryRegions(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);

	// AgentPanelTraceMemory.cpp（2.11）
	/** what=memtags：LLM 内存标签（memtag 通道，UE 要 -llm 启动） */
	bool QueryMemTags(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);
	/** what=allocs：内存分配（memalloc 通道，UE 要 -trace=memory 启动），按标签 / 调用栈 / 大小聚合 */
	bool QueryAllocs(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);

	// AgentPanelTraceLoad.cpp（2.11）
	/** what=loads：包加载（loadtime / assetloadtime 通道） */
	bool QueryLoads(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);
	/** what=files：文件读写（file 通道） */
	bool QueryFiles(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);

	// AgentPanelTraceTasks.cpp（2.11）
	/** what=tasks：任务和等待（task 通道） */
	bool QueryTasks(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);
	/** what=switches：线程切换（contextswitch 通道），每条线程真正在跑的时间 */
	bool QuerySwitches(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);

	// AgentPanelTraceNet.cpp（2.11）
	/** what=net：网络（net 通道）每个连接的收发包统计 */
	bool QueryNet(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);

	/** 这份 trace 里有没有这类数据（session 的 has 用；各自的文件里实现，编译时关掉的一律 false） */
	bool HasRegions(const IAnalysisSession& S);
	bool HasMemTags(const IAnalysisSession& S);
	bool HasAllocs(const IAnalysisSession& S);
	bool HasLoads(const IAnalysisSession& S);
	bool HasFiles(const IAnalysisSession& S);
	bool HasTasks(const IAnalysisSession& S);
	bool HasSwitches(const IAnalysisSession& S);
	bool HasNet(const IAnalysisSession& S);

	/** 「这份 trace 没有某类数据」的统一说明：要开哪个通道、启动 UE 时要加什么参数 */
	inline FString NoData(const TCHAR* What, const TCHAR* Channel, const TCHAR* Extra = TEXT(""))
	{
		return FString::Printf(TEXT("这份 trace 里没有%s：录制时要开 %s 通道（ue_perf action=start preset=custom channels=…）%s"), What, Channel, Extra);
	}
	/** 编译时关掉的查询（UELinkCompat.h 的 UELINK_TRACE_* 开关） */
	inline FString Disabled(const TCHAR* What)
	{
		return FString::Printf(TEXT("这个 UELink 编译时关掉了%s的分析（这个引擎版本的接口还没适配）：把编译报错发给面板维护者"), What);
	}

	// AgentPanelTraceLua.cpp
	/** what=timers：计时器表；2.9.0 起带 lua / mergeC 参数，Lua 计时器的行带 file / line / c */
	void QueryTimers(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out);
	/** what=luainfo：这份 trace 里所有 Lua 计时器的文件和行号 */
	void QueryLuaInfo(const ITimingProfilerProvider& TP, TSharedPtr<FJsonObject>& Out);
	/** 有没有 Lua 计时器（info 的 lua 字段） */
	bool HasLuaTimers(const ITimingProfilerProvider& TP);
	/** what=tree：自上而下的调用树（火焰图） */
	bool QueryTree(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);
}
