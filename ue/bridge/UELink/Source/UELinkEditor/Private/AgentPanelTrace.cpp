// trace 分析服务（性能页设计 3.2、二期）：面板录下的 .utrace 交给 UE 自己的 TraceServices 分析，
// 网页的时间轴、计时器表、调用者 / 被调用者、调用堆栈、计数器、日志都按「这个范围、这个精度」来这里查。
// 用 Unreal Insights 同一套分析代码：数字和层级跟 Insights 一样，trace 格式随引擎版本变也跟着走，不自己解析二进制。
// 放在编辑器模块：后台编辑器（-run=AgentPanel）和编辑器都加载它，游戏进程不加载，分析不拖慢要测的帧率。
//
// 只用最基础的几个接口（线程列表、时间线进出事件、计时器名字、帧、书签、计数器、日志），
// TraceServices 的类型一律写全名（TraceServices::FFrame 等）：UObject 也有 FFrame（蓝图调用栈），只写短名会撞名。
// using namespace TraceServices 只能放在本文件自己的具名命名空间里（UELinkTrace），不能放文件作用域：
// 单体构建（unity）把同模块的 .cpp 拼成一个编译单元，文件作用域的 using 会漏进后面的文件，
// 后面 include 的 ContentBrowserData 等引擎头里写的短名 FFrame 就变成「不明确的符号」（5.4 上实际报过 C2872）。
// 计时器汇总和调用树都在这里自己按进出事件算，不用 CreateAggregation 之类各版本签名不一样的接口。
// 2.9.0 起 Lua 相关的查询（luainfo、tree、timers 的 lua / mergeC）在 AgentPanelTraceLua.cpp，共用的结构在 AgentPanelTraceShared.h。
#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "CoreGlobals.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "GenericPlatform/GenericPlatformFile.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "Misc/Paths.h"
#include "Misc/CoreDelegates.h"
#include "Modules/ModuleManager.h"
#include "Async/Async.h"
#include "TraceServices/AnalysisService.h"
#include "TraceServices/ITraceServicesModule.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/Bookmarks.h"
#include "TraceServices/Model/Counters.h"
#include "TraceServices/Model/Frames.h"
#include "TraceServices/Model/Log.h"
#include "TraceServices/Model/Threads.h"
#include "TraceServices/Model/TimingProfiler.h"
#include "Trace/DataStream.h"

// 和 AgentPanelTraceLua.cpp 共用的结构和函数（计时器名字、走泳道、调用树）
#include "AgentPanelTraceShared.h"

#include <atomic>

using namespace AgentPanel;

namespace UELinkTrace
{
using namespace TraceServices;

namespace
{
	/** 时间轴一次最多回这么多块（设计 6）：再多网页画不过来，也说明范围太大、该放大了 */
	constexpr int32 MaxBlocks = 20000;

	/**
	 * 一份 trace 的读取进度，分析线程（写）和查询（游戏线程，读）共用，所以全是原子量。
	 * 录制中（面板说这份文件还在录）读到文件末尾不结束，等新数据接着读，这样只分析一遍、一直追到最新，
	 * 不像以前文件一变就从头重新分析（录制中文件每秒都在变，网页就永远停在「正在分析」）。
	 */
	struct FTraceFollow
	{
		/** 已经交给分析器的字节数 */
		std::atomic<int64> ReadBytes{ 0 };
		/** 上次看到的文件大小 */
		std::atomic<int64> FileBytes{ 0 };
		/** 读到了文件当前的末尾，在等新数据（录制中「已经追上」） */
		std::atomic<bool> bAtEnd{ false };
		/** 跟到这个时间（FPlatformTime::Seconds）为止：网页看着时每次查询续一下，没人看了就读完现有数据收尾 */
		std::atomic<double> FollowUntil{ 0.0 };
		/** 会话被丢弃 / 编辑器退出：马上结束读取，分析线程才能退出 */
		std::atomic<bool> bStop{ false };

		bool Following() const { return !bStop.load() && FPlatformTime::Seconds() < FollowUntil.load(); }
	};
	using FFollowRef = TSharedRef<FTraceFollow, ESPMode::ThreadSafe>;

	/** 没人查了还跟多久：网页录制中每 1.5–3 秒问一次 info，留足余量；过了就把现有数据读完、分析结束 */
	constexpr double FollowGrace = 30.0;

	/**
	 * 给分析器的数据流：从文件读，读到末尾时按 FTraceFollow 决定结束还是等新数据。
	 * 在分析线程里调用，可以阻塞（Insights 看实时会话也是这样等数据的）；等的时候每 0.1 秒看一眼，停止标志一设就返回。
	 * 文件句柄的大小在 Windows 上是打开时记下的，追新数据要重新打开才能看到新长度。
	 */
	class FFollowStream final : public UE::Trace::IInDataStream
	{
	public:
		FFollowStream(const FString& InPath, FFollowRef InState) : Path(InPath), State(InState) {}

		virtual int32 Read(void* Data, uint32 Size) override
		{
			for (;;)
			{
				if (State->bStop.load() || IsEngineExitRequested())
				{
					return 0;
				}
				if (Pos >= Known && !Refresh())
				{
					return 0;
				}
				if (Pos < Known)
				{
					const int64 N = FMath::Min<int64>(Known - Pos, static_cast<int64>(Size));
					if (!Handle->Read(static_cast<uint8*>(Data), N))
					{
						return 0;
					}
					Pos += N;
					State->ReadBytes.store(Pos);
					State->bAtEnd.store(false);
					return static_cast<int32>(N);
				}
				State->bAtEnd.store(true);
				if (!State->Following())
				{
					return 0;
				}
				FPlatformProcess::Sleep(0.1f);
			}
		}

		virtual void Close() override { Handle.Reset(); }

	private:
		/** 重新打开文件拿到最新长度；文件没了（被删）返回 false 结束分析 */
		bool Refresh()
		{
			// 第二个参数 bAllowWrite：引擎还在写这个文件，要允许别人写才打得开
			Handle.Reset(FPlatformFileManager::Get().GetPlatformFile().OpenRead(*Path, true));
			if (!Handle.IsValid() || !Handle->Seek(Pos))
			{
				return false;
			}
			Known = Handle->Size();
			State->FileBytes.store(Known);
			return true;
		}

		FString Path;
		FFollowRef State;
		TUniquePtr<IFileHandle> Handle;
		int64 Pos = 0;
		int64 Known = 0;
	};

	struct FEntry
	{
		TSharedPtr<const IAnalysisSession> Session;
		TSharedPtr<FTraceFollow, ESPMode::ThreadSafe> Follow;
		double LastUse = 0;
	};

	/**
	 * 分析过的会话：留最近两个（网页来回切两份 trace 时不用重分析）。
	 * 不能靠静态对象析构来释放：那时 TraceServices 已经卸载，释放分析会话会崩在引擎里（2.10.0 修的退出崩溃）。
	 * 所以放在堆上、静态析构时不碰它，由 ShutdownTraceOps（引擎退出前、模块卸载时）先叫停读取再清空。
	 */
	struct FSessionCache
	{
		TMap<FString, FEntry> Map;
		static void Drop(FEntry& E)
		{
			if (E.Follow.IsValid())
			{
				E.Follow->bStop.store(true);
			}
		}
		void Remove(const FString& File)
		{
			if (FEntry* E = Map.Find(File))
			{
				Drop(*E);
				Map.Remove(File);
			}
		}
		void Clear()
		{
			// 先全部叫停，跟随读取的分析线程 0.1 秒内就会返回，再释放会话（释放时会等分析线程退出）
			for (TPair<FString, FEntry>& P : Map)
			{
				Drop(P.Value);
			}
			Map.Empty();
		}
	};

	FSessionCache& Sessions()
	{
		// 故意不释放：进程退出时由系统回收，避免静态析构顺序晚于 TraceServices 卸载
		static FSessionCache* Cache = new FSessionCache();
		return *Cache;
	}

	/**
	 * bLive：面板说这份文件还在录。录制中一直跟着读（只分析一遍，查询时拿到的是已经分析到的部分）；
	 * 不在录了就读完现有数据收尾。分析完以后文件又变了（换了文件、或者录制中没人看超过 FollowGrace 又打开）才从头再分析。
	 */
	TSharedPtr<const IAnalysisSession> SessionFor(const FString& File, bool bLive, FEntry*& OutEntry, FString& Error)
	{
		IFileManager& FM = IFileManager::Get();
		const int64 Size = FM.FileSize(*File);
		if (Size <= 0)
		{
			Error = FString::Printf(TEXT("trace 文件不存在或是空的：%s"), *File);
			return nullptr;
		}
		FSessionCache& Cache = Sessions();
		const double Now = FPlatformTime::Seconds();
		if (FEntry* Hit = Cache.Map.Find(File))
		{
			Hit->Follow->FollowUntil.store(bLive ? Now + FollowGrace : 0.0);
			const bool bChanged = Hit->Follow->ReadBytes.load() != Size;
			if (!Hit->Session->IsAnalysisComplete() || !bChanged)
			{
				Hit->LastUse = Now;
				OutEntry = Hit;
				return Hit->Session;
			}
			Cache.Remove(File);
		}
		ITraceServicesModule& Module = FModuleManager::LoadModuleChecked<ITraceServicesModule>(TEXT("TraceServices"));
		TSharedPtr<IAnalysisService> Service = Module.GetAnalysisService();
		if (!Service.IsValid())
		{
			Error = TEXT("这个引擎的 TraceServices 没有提供分析服务");
			return nullptr;
		}
		FFollowRef Follow = MakeShared<FTraceFollow, ESPMode::ThreadSafe>();
		Follow->FollowUntil.store(bLive ? Now + FollowGrace : 0.0);
		Follow->FileBytes.store(Size);
		// StartAnalysis 在自己的线程里分析，马上返回；查询时没分析完就回 analyzing 和已经分析到的部分。
		// 数据流自己给（不用按文件路径的重载）：那样录制中读到末尾能等新数据，还知道读到了第几个字节
		TUniquePtr<UE::Trace::IInDataStream> Stream(new FFollowStream(File, Follow));
		TSharedPtr<const IAnalysisSession> Session = Service->StartAnalysis(0u, *File, MoveTemp(Stream));
		if (!Session.IsValid())
		{
			Error = FString::Printf(TEXT("打不开这份 trace（不是 .utrace，或者是更新版本的引擎录的）：%s"), *File);
			return nullptr;
		}
		while (Cache.Map.Num() >= 2)
		{
			FString Oldest;
			double OldestUse = TNumericLimits<double>::Max();
			for (const TPair<FString, FEntry>& P : Cache.Map)
			{
				if (P.Value.LastUse < OldestUse)
				{
					OldestUse = P.Value.LastUse;
					Oldest = P.Key;
				}
			}
			Cache.Remove(Oldest);
		}
		FEntry& E = Cache.Map.Add(File);
		E.Session = Session;
		E.Follow = Follow;
		E.LastUse = Now;
		OutEntry = &E;
		return Session;
	}
} // 匿名命名空间

	// ---------- 和 AgentPanelTraceLua.cpp 共用的（声明在 AgentPanelTraceShared.h，不能放匿名命名空间） ----------

	/** 编辑器退出 / 模块卸载：所有后台查询马上收尾 */
	std::atomic<bool> GCancelQueries{ false };

	namespace
	{
		/** 每个后台线程一份：这次查询的截止时间、问了多少次、超没超 */
		struct FBudget
		{
			double Deadline = 0;
			uint32 Ticks = 0;
			bool bHit = false;
		};
		thread_local FBudget GBudget;
	}

	void BeginBudget(double Seconds)
	{
		GBudget.Deadline = FPlatformTime::Seconds() + Seconds;
		GBudget.Ticks = 0;
		GBudget.bHit = false;
	}

	bool OverBudget()
	{
		if (GBudget.bHit)
		{
			return true;
		}
		// 看时钟也要花时间：几千个事件才看一次，一次查询多花不到几毫秒
		if ((++GBudget.Ticks & 4095u) != 0)
		{
			return false;
		}
		if (GCancelQueries.load() || (GBudget.Deadline > 0 && FPlatformTime::Seconds() > GBudget.Deadline))
		{
			GBudget.bHit = true;
		}
		return GBudget.bHit;
	}

	bool BudgetHit()
	{
		return GBudget.bHit;
	}

	void ReadFrames(const IAnalysisSession& S, bool bRender, TArray<double>& OutStart, TArray<double>& OutEnd)
	{
		const IFrameProvider& FP = ReadFrameProvider(S);
		const ETraceFrameType Type = bRender ? TraceFrameType_Rendering : TraceFrameType_Game;
		const uint64 Count = FMath::Min<uint64>(FP.GetFrameCount(Type), 200000);
		const double Last = S.GetDurationSeconds();
		OutStart.Reset();
		OutEnd.Reset();
		OutStart.Reserve(Count);
		OutEnd.Reserve(Count);
		// 起点写成 uint64：5.8 起 EnumerateFrames 另有按时间（double）取的重载，写 0 两边都能转、重载不明确
		FP.EnumerateFrames(Type, uint64(0), Count, [&](const TraceServices::FFrame& F)
		{
			if (!FMath::IsFinite(F.StartTime))
			{
				return;
			}
			OutStart.Add(F.StartTime);
			OutEnd.Add(FMath::IsFinite(F.EndTime) ? F.EndTime : FMath::Max(F.StartTime, Last));
		});
	}

	double Num(const TSharedPtr<FJsonObject>& A, const TCHAR* Key, double Default)
	{
		double V = Default;
		return A->TryGetNumberField(Key, V) ? V : Default;
	}

	TArray<int32> Lanes(const TSharedPtr<FJsonObject>& A)
	{
		TArray<int32> Out;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (A->TryGetArrayField(TEXT("lanes"), Arr))
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				Out.Add(static_cast<int32>(V->AsNumber()));
			}
		}
		return Out;
	}

	/** 所有泳道：GPU 在前，再按线程登记的顺序（Insights 的顺序） */
	TArray<int32> AllLanes(const IAnalysisSession& S, const ITimingProfilerProvider& TP)
	{
		TArray<int32> Out;
		uint32 Index = 0;
		if (TP.GetGpuTimelineIndex(Index))
		{
			Out.Add(GpuLane);
		}
		ReadThreadProvider(S).EnumerateThreads([&](const TraceServices::FThreadInfo& T)
		{
			uint32 TL = 0;
			if (TP.GetCpuThreadTimelineIndex(T.Id, TL))
			{
				Out.Add(static_cast<int32>(T.Id));
			}
		});
		return Out;
	}
	/**
	 * 按进出事件走一条泳道 [T0, T1]，自己维护调用栈。范围外开始、范围内还没结束的块也会给（时间按真实的）。
	 * 返回 false 表示这条泳道不存在
	 */
	bool Walk(const ITimingProfilerProvider& TP, const FTimers& Timers, int32 Lane, double T0, double T1, FBlockFn Fn)
	{
		uint32 Index = 0;
		const bool bOk = Lane == GpuLane ? TP.GetGpuTimelineIndex(Index) : TP.GetCpuThreadTimelineIndex(static_cast<uint32>(Lane), Index);
		if (!bOk)
		{
			return false;
		}
		TP.ReadTimeline(Index, [&](const ITimingProfilerProvider::Timeline& TL)
		{
			TArray<FOpen> Stack;
			double Last = T0;
			TL.EnumerateEvents(T0, T1, [&](bool bStart, double Time, const TraceServices::FTimingProfilerEvent& Ev)
			{
				// 查询超时或编辑器在退出（2.11）：不再往下走，已经走过的照常收尾
				if (OverBudget())
				{
					return EEventEnumerate::Stop;
				}
				Last = Time;
				if (bStart)
				{
					Stack.Add({ Timers.Resolve(Ev.TimerIndex), Time, 0.0 });
					return EEventEnumerate::Continue;
				}
				if (Stack.Num() == 0)
				{
					return EEventEnumerate::Continue;
				}
				const FOpen Top = Stack.Pop(EAllowShrinking::No);
				const double Dur = Time - Top.Start;
				if (Stack.Num() > 0)
				{
					Stack.Last().Child += Dur;
				}
				Fn(Top.Start, Time, Stack.Num(), Top.Timer, Top.Child, Stack);
				return EEventEnumerate::Continue;
			});
			// 录制被截断时最后几层没有结束事件：按最后一个事件的时间收尾
			while (Stack.Num() > 0)
			{
				const FOpen Top = Stack.Pop(EAllowShrinking::No);
				if (Stack.Num() > 0)
				{
					Stack.Last().Child += FMath::Max(0.0, Last - Top.Start);
				}
				Fn(Top.Start, FMath::Max(Last, Top.Start), Stack.Num(), Top.Timer, Top.Child, Stack);
			}
		});
		return true;
	}

	TSharedPtr<FJsonValue> NumArr(const TArray<double>& V)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		Out.Reserve(V.Num());
		for (double X : V)
		{
			Out.Add(MakeShared<FJsonValueNumber>(Fin(X)));
		}
		return MakeShared<FJsonValueArray>(Out);
	}

	/** 毫秒保留 3 位小数：JSON 小一半，网页也用不到更细 */
	double Ms(double Seconds)
	{
		return Fin(FMath::RoundToDouble(Seconds * 1000000.0) / 1000.0);
	}
	/** 树转 JSON：每层按包含时间倒序，最多 MaxKids 个、MaxDepth 层，其余的合进「其他」的计数里 */
	TSharedPtr<FJsonObject> TreeJson(uint32 Id, const FNode& N, const FTimers& Timers, int32 Depth)
	{
		constexpr int32 MaxKids = TreeMaxKids;
		constexpr int32 MaxDepth = TreeMaxDepth;
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetNumberField(TEXT("id"), Id);
		O->SetStringField(TEXT("name"), Timers.Name(Id));
		O->SetNumberField(TEXT("count"), static_cast<double>(N.Count));
		O->SetNumberField(TEXT("incl"), Ms(N.Incl));
		O->SetNumberField(TEXT("excl"), Ms(N.Excl));
		if (Depth >= MaxDepth || N.Kids.Num() == 0)
		{
			if (N.Kids.Num() > 0)
			{
				O->SetNumberField(TEXT("more"), N.Kids.Num());
			}
			return O;
		}
		TArray<TPair<uint32, const FNode*>> Sorted;
		for (const TPair<uint32, TUniquePtr<FNode>>& P : N.Kids)
		{
			Sorted.Add({ P.Key, P.Value.Get() });
		}
		Sorted.Sort([](const TPair<uint32, const FNode*>& X, const TPair<uint32, const FNode*>& Y) { return X.Value->Incl > Y.Value->Incl; });
		TArray<TSharedPtr<FJsonValue>> Kids;
		for (int32 i = 0; i < Sorted.Num() && i < MaxKids; ++i)
		{
			Kids.Add(MakeShared<FJsonValueObject>(TreeJson(Sorted[i].Key, *Sorted[i].Value, Timers, Depth + 1)));
		}
		O->SetArrayField(TEXT("children"), Kids);
		if (Sorted.Num() > MaxKids)
		{
			O->SetNumberField(TEXT("more"), Sorted.Num() - MaxKids);
		}
		return O;
	}

namespace
{
	// ---------- 各个查询 ----------

	void QueryInfo(const IAnalysisSession& S, TSharedPtr<FJsonObject>& Out)
	{
		TArray<TSharedPtr<FJsonValue>> Threads;
		const ITimingProfilerProvider* TP = ReadTimingProfilerProvider(S);
		uint32 Index = 0;
		if (TP && TP->GetGpuTimelineIndex(Index))
		{
			TSharedPtr<FJsonObject> G = MakeShared<FJsonObject>();
			G->SetNumberField(TEXT("id"), GpuLane);
			G->SetStringField(TEXT("name"), TEXT("GPU"));
			G->SetStringField(TEXT("group"), TEXT("GPU"));
			Threads.Add(MakeShared<FJsonValueObject>(G));
		}
		ReadThreadProvider(S).EnumerateThreads([&](const TraceServices::FThreadInfo& T)
		{
			uint32 TL = 0;
			if (!TP || !TP->GetCpuThreadTimelineIndex(T.Id, TL))
			{
				return;	// 没有 CPU 事件的线程不列，免得一屏空泳道
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("id"), T.Id);
			O->SetStringField(TEXT("name"), T.Name ? T.Name : TEXT(""));
			O->SetStringField(TEXT("group"), T.GroupName ? T.GroupName : TEXT(""));
			Threads.Add(MakeShared<FJsonValueObject>(O));
		});
		Out->SetArrayField(TEXT("threads"), Threads);
		// 2.9.0：有没有 Lua 计时器（录制时开了 lua 通道），面板给抓取列表打「Lua」标签
		Out->SetBoolField(TEXT("lua"), TP && HasLuaTimers(*TP));
		const IFrameProvider& FP = ReadFrameProvider(S);
		Out->SetNumberField(TEXT("frames"), static_cast<double>(FP.GetFrameCount(TraceFrameType_Game)));
	}

	/** 第一个游戏帧的开始时间（秒）；还没有帧时是 0 */
	double FirstFrameTime(const IAnalysisSession& S)
	{
		const IFrameProvider& FP = ReadFrameProvider(S);
		double T = 0;
		if (FP.GetFrameCount(TraceFrameType_Game) > 0)
		{
			FP.EnumerateFrames(TraceFrameType_Game, uint64(0), uint64(1), [&](const TraceServices::FFrame& F)
			{
				T = Fin(F.StartTime);
			});
		}
		return T;
	}

	/** 帧（2.11 起 type=render 取渲染帧，默认游戏帧）：10 分钟 60 帧也才 3.6 万帧，整段给，网页自己按宽度画 */
	void QueryFrames(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out)
	{
		const bool bRender = Str(A, TEXT("type")) == TEXT("render");
		const IFrameProvider& FP = ReadFrameProvider(S);
		TArray<double> Begin;
		TArray<double> End;
		ReadFrames(S, bRender, Begin, End);
		TArray<double> Start;
		TArray<double> Dur;
		Start.Reserve(Begin.Num());
		Dur.Reserve(Begin.Num());
		for (int32 i = 0; i < Begin.Num(); ++i)
		{
			Start.Add(FMath::RoundToDouble(Begin[i] * 100000.0) / 100000.0);
			Dur.Add(Ms(End[i] - Begin[i]));
		}
		Out->SetField(TEXT("start"), NumArr(Start));
		Out->SetField(TEXT("ms"), NumArr(Dur));
		Out->SetNumberField(TEXT("total"), static_cast<double>(FP.GetFrameCount(bRender ? TraceFrameType_Rendering : TraceFrameType_Game)));
	}

	bool QueryTiming(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), T0 + 0.05);
		const double Px = FMath::Max(100.0, Num(A, TEXT("px"), 1200));
		// 比半个像素还短的块画出来也看不见：不回，泳道上记个数（Insights 是合并成灰块，网页按 hidden 画一条细线提示）
		const double MinDur = (T1 - T0) / Px * 0.5;
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = AllLanes(S, TP);
		}
		FTimers Timers(TP);
		TSet<uint32> Used;
		TArray<TSharedPtr<FJsonValue>> LanesOut;
		int32 Total = 0;
		bool bCut = false;
		for (int32 Lane : Want)
		{
			TArray<double> St, Du, De, Ti, Ex;
			int32 Hidden = 0;
			Walk(TP, Timers, Lane, T0, T1, [&](double Start, double End, int32 Depth, uint32 Timer, double Child, const TArray<FOpen>&)
			{
				if (End - Start < MinDur)
				{
					++Hidden;
					return;
				}
				if (Total >= MaxBlocks)
				{
					bCut = true;
					return;
				}
				++Total;
				St.Add(Start);
				Du.Add(Ms(End - Start));
				De.Add(Depth);
				Ti.Add(Timer);
				// 独占时间（悬浮提示要的 Exclusive Time）：子块再短、没回给网页也算在里面，网页自己减不准
				Ex.Add(Ms(FMath::Max(0.0, End - Start - Child)));
				Used.Add(Timer);
			});
			TSharedPtr<FJsonObject> L = MakeShared<FJsonObject>();
			L->SetNumberField(TEXT("id"), Lane);
			L->SetField(TEXT("s"), NumArr(St));
			L->SetField(TEXT("ms"), NumArr(Du));
			L->SetField(TEXT("d"), NumArr(De));
			L->SetField(TEXT("t"), NumArr(Ti));
			L->SetField(TEXT("x"), NumArr(Ex));
			L->SetNumberField(TEXT("hidden"), Hidden);
			LanesOut.Add(MakeShared<FJsonValueObject>(L));
		}
		TSharedPtr<FJsonObject> Names = MakeShared<FJsonObject>();
		for (uint32 Id : Used)
		{
			Names->SetStringField(FString::FromInt(static_cast<int32>(Id)), Timers.Name(Id));
		}
		Out->SetArrayField(TEXT("lanes"), LanesOut);
		Out->SetObjectField(TEXT("names"), Names);
		Out->SetBoolField(TEXT("cut"), bCut);
		return true;
	}
	/**
	 * 调用者 / 被调用者（Insights 的 Butterfly）：选中计时器的每一次调用，
	 * 往外的调用栈并进「调用者」树（自己在根，往下是父、祖父…），往里的子调用并进「被调用者」树。
	 */
	bool QueryButterfly(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		double TimerNum = -1;
		if (!A->TryGetNumberField(TEXT("timer"), TimerNum) || TimerNum < 0)
		{
			Error = TEXT("要给 timer（计时器 id，从 timers 查询里拿）");
			return false;
		}
		const uint32 Target = static_cast<uint32>(TimerNum);
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = AllLanes(S, TP);
		}
		FTimers Timers(TP);
		FNode Callers;
		FNode Callees;
		for (int32 Lane : Want)
		{
			Walk(TP, Timers, Lane, T0, T1, [&](double Start, double End, int32, uint32 Timer, double Child, const TArray<FOpen>& Parents)
			{
				const double Dur = End - Start;
				const double Self = FMath::Max(0.0, Dur - Child);
				// 外面最近一层的选中计时器在栈里的位置：有就说明这一块是它的子孙
				int32 Outer = INDEX_NONE;
				for (int32 i = 0; i < Parents.Num(); ++i)
				{
					if (Parents[i].Timer == Target)
					{
						Outer = i;
						break;
					}
				}
				if (Timer == Target && Outer == INDEX_NONE)
				{
					// 选中的计时器本身（最外层那次）：调用者树沿父链往外走
					// 调用者树里每一层的独占时间写的都是选中计时器自己的独占时间（Insights 的 Callers 也这么读）
					++Callers.Count;
					Callers.Incl += Dur;
					Callers.Excl += Self;
					++Callees.Count;
					Callees.Incl += Dur;
					Callees.Excl += Self;
					FNode* N = &Callers;
					for (int32 i = Parents.Num() - 1; i >= 0; --i)
					{
						N = &N->Kid(Parents[i].Timer);
						++N->Count;
						N->Incl += Dur;
						N->Excl += Self;
					}
				}
				else if (Outer != INDEX_NONE)
				{
					// 它里面的块：从选中的那层往里一路建到自己
					FNode* N = &Callees;
					for (int32 i = Outer + 1; i < Parents.Num(); ++i)
					{
						N = &N->Kid(Parents[i].Timer);
					}
					N = &N->Kid(Timer);
					++N->Count;
					N->Incl += Dur;
					N->Excl += Self;
				}
			});
		}
		// 子块比父块先结束，被调用者树里路径上的中间节点是在子块回调里建的：计数和时间以它自己结束时加的为准
		Out->SetObjectField(TEXT("callers"), TreeJson(Target, Callers, Timers, 0));
		Out->SetObjectField(TEXT("callees"), TreeJson(Target, Callees, Timers, 0));
		return true;
	}

	/**
	 * 一个计时器在范围内的每一次调用（Insights 计时器悬浮提示里的统计 + 「找最慢的一次」）：
	 * 次数、总和、最短 / 平均 / 中位 / 最长，和最慢的 top 次（泳道、开始、耗时、深度），网页点一下跳到那一块
	 */
	bool QueryInstances(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		double TimerNum = -1;
		if (!A->TryGetNumberField(TEXT("timer"), TimerNum) || TimerNum < 0)
		{
			Error = TEXT("要给 timer（计时器 id，从 timers 查询里拿）");
			return false;
		}
		const uint32 Target = static_cast<uint32>(TimerNum);
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const int32 Top = FMath::Clamp(Int(A, TEXT("top"), 50), 1, 500);
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = AllLanes(S, TP);
		}
		FTimers Timers(TP);
		struct FHit
		{
			int32 Lane;
			double Start;
			double Dur;
			double Self;
			int32 Depth;
		};
		TArray<FHit> Hits;
		for (int32 Lane : Want)
		{
			Walk(TP, Timers, Lane, T0, T1, [&](double Start, double End, int32 Depth, uint32 Timer, double Child, const TArray<FOpen>&)
			{
				if (Timer == Target && End > T0 && Start < T1)
				{
					Hits.Add({ Lane, Start, End - Start, FMath::Max(0.0, End - Start - Child), Depth });
				}
			});
		}
		Hits.Sort([](const FHit& X, const FHit& Y) { return X.Dur > Y.Dur; });
		double Sum = 0;
		double SelfSum = 0;
		for (const FHit& H : Hits)
		{
			Sum += H.Dur;
			SelfSum += H.Self;
		}
		const int32 N = Hits.Num();
		Out->SetNumberField(TEXT("id"), Target);
		Out->SetStringField(TEXT("name"), Timers.Name(Target));
		Out->SetNumberField(TEXT("count"), N);
		Out->SetNumberField(TEXT("incl"), Ms(Sum));
		Out->SetNumberField(TEXT("excl"), Ms(SelfSum));
		Out->SetNumberField(TEXT("min"), N ? Ms(Hits.Last().Dur) : 0);
		Out->SetNumberField(TEXT("max"), N ? Ms(Hits[0].Dur) : 0);
		Out->SetNumberField(TEXT("avg"), N ? Ms(Sum / N) : 0);
		Out->SetNumberField(TEXT("median"), N ? Ms(Hits[N / 2].Dur) : 0);
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 i = 0; i < N && i < Top; ++i)
		{
			const FHit& H = Hits[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("lane"), H.Lane);
			O->SetNumberField(TEXT("start"), H.Start);
			O->SetNumberField(TEXT("ms"), Ms(H.Dur));
			O->SetNumberField(TEXT("excl"), Ms(H.Self));
			O->SetNumberField(TEXT("depth"), H.Depth);
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		return true;
	}

	/** 某个时间点、某条泳道上从根到最深一层的调用栈，以及选中那一层的直接子调用（按计时器合并） */
	bool QueryStack(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const int32 Lane = Int(A, TEXT("lane"), 0);
		const double Time = Num(A, TEXT("time"), 0);
		const int32 Want = Int(A, TEXT("depth"), -1);
		FTimers Timers(TP);
		struct FHit
		{
			uint32 Timer;
			double Start;
			double End;
			double Child;
		};
		TArray<FHit> Chain;
		const bool bLane = Walk(TP, Timers, Lane, Time, Time, [&](double Start, double End, int32 Depth, uint32 Timer, double Child, const TArray<FOpen>&)
		{
			if (Start <= Time && End >= Time)
			{
				if (Chain.Num() <= Depth)
				{
					Chain.SetNum(Depth + 1);
				}
				Chain[Depth] = { Timer, Start, End, Child };
			}
		});
		if (!bLane)
		{
			Error = TEXT("这份 trace 里没有这条泳道");
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Stack;
		for (int32 i = 0; i < Chain.Num(); ++i)
		{
			const FHit& H = Chain[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("id"), H.Timer);
			O->SetStringField(TEXT("name"), Timers.Name(H.Timer));
			O->SetNumberField(TEXT("start"), H.Start);
			O->SetNumberField(TEXT("ms"), Ms(H.End - H.Start));
			O->SetNumberField(TEXT("excl"), Ms(FMath::Max(0.0, H.End - H.Start - H.Child)));
			O->SetNumberField(TEXT("depth"), i);
			Stack.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetArrayField(TEXT("stack"), Stack);
		const int32 Sel = Want >= 0 && Want < Chain.Num() ? Want : Chain.Num() - 1;
		if (Sel < 0)
		{
			Out->SetArrayField(TEXT("children"), TArray<TSharedPtr<FJsonValue>>());
			return true;
		}
		const FHit Picked = Chain[Sel];
		TMap<uint32, FAgg> Kids;
		Walk(TP, Timers, Lane, Picked.Start, Picked.End, [&](double Start, double End, int32 Depth, uint32 Timer, double, const TArray<FOpen>&)
		{
			if (Depth == Sel + 1 && Start >= Picked.Start && End <= Picked.End)
			{
				FAgg& G = Kids.FindOrAdd(Timer);
				++G.Count;
				G.Incl += End - Start;
				G.InclMax = FMath::Max(G.InclMax, End - Start);
			}
		});
		Kids.ValueSort([](const FAgg& X, const FAgg& Y) { return X.Incl > Y.Incl; });
		TArray<TSharedPtr<FJsonValue>> Children;
		for (const TPair<uint32, FAgg>& P : Kids)
		{
			if (Children.Num() >= 100)
			{
				break;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("id"), P.Key);
			O->SetStringField(TEXT("name"), Timers.Name(P.Key));
			O->SetNumberField(TEXT("count"), static_cast<double>(P.Value.Count));
			O->SetNumberField(TEXT("incl"), Ms(P.Value.Incl));
			O->SetNumberField(TEXT("inclMax"), Ms(P.Value.InclMax));
			Children.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetArrayField(TEXT("children"), Children);
		Out->SetNumberField(TEXT("selected"), Sel);
		return true;
	}

	/** 计数器：不给 names 时列出所有计数器的名字；给了就按 px 个点降采样（每段取最大值，尖峰不丢） */
	void QueryCounters(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out)
	{
		const ICounterProvider& CP = ReadCounterProvider(S);
		TSet<FString> Names;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (A->TryGetArrayField(TEXT("names"), Arr))
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				Names.Add(V->AsString());
			}
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const int32 Px = FMath::Clamp(Int(A, TEXT("px"), 600), 10, 4000);
		const bool bStats = BoolArg(A, TEXT("stats"));
		const double Step = FMath::Max(1e-9, (T1 - T0) / Px);
		TArray<TSharedPtr<FJsonValue>> List;
		CP.EnumerateCounters([&](uint32, const TraceServices::ICounter& C)
		{
			const FString Name = C.GetName();
			if (Names.Num() == 0)
			{
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("name"), Name);
				// 2.11：stats=true 时顺便给范围内的统计（一遍扫完），Agent 不用一条条取走势才知道哪个在涨
				if (bStats && !OverBudget())
				{
					int64 N = 0;
					double Sum = 0, Min = 0, Max = 0, First = 0, Lastv = 0, FirstT = 0, LastT = 0;
					auto Take = [&](double Time, double Value)
					{
						if (N == 0)
						{
							Min = Max = First = Value;
							FirstT = Time;
						}
						Min = FMath::Min(Min, Value);
						Max = FMath::Max(Max, Value);
						Sum += Value;
						Lastv = Value;
						LastT = Time;
						++N;
					};
					if (C.IsFloatingPoint())
					{
						C.EnumerateFloatValues(T0, T1, false, [&](double Time, double Value) { Take(Time, Value); });
					}
					else
					{
						C.EnumerateValues(T0, T1, false, [&](double Time, int64 Value) { Take(Time, static_cast<double>(Value)); });
					}
					O->SetNumberField(TEXT("n"), static_cast<double>(N));
					if (N > 0)
					{
						O->SetNumberField(TEXT("min"), Fin(Min));
						O->SetNumberField(TEXT("max"), Fin(Max));
						O->SetNumberField(TEXT("avg"), Fin(Sum / N));
						O->SetNumberField(TEXT("first"), Fin(First));
						O->SetNumberField(TEXT("last"), Fin(Lastv));
						O->SetNumberField(TEXT("firstT"), Fin(FirstT));
						O->SetNumberField(TEXT("lastT"), Fin(LastT));
					}
				}
				List.Add(MakeShared<FJsonValueObject>(O));
				return;
			}
			if (!Names.Contains(Name))
			{
				return;
			}
			TArray<double> Ts;
			TArray<double> Vs;
			auto Add = [&](double Time, double Value)
			{
				const int32 Slot = static_cast<int32>((Time - T0) / Step);
				if (Ts.Num() > 0 && static_cast<int32>((Ts.Last() - T0) / Step) == Slot)
				{
					Vs.Last() = FMath::Max(Vs.Last(), Value);
					return;
				}
				Ts.Add(Time);
				Vs.Add(Value);
			};
			if (C.IsFloatingPoint())
			{
				C.EnumerateFloatValues(T0, T1, true, [&](double Time, double Value) { Add(Time, Value); });
			}
			else
			{
				C.EnumerateValues(T0, T1, true, [&](double Time, int64 Value) { Add(Time, static_cast<double>(Value)); });
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), Name);
			O->SetField(TEXT("t"), NumArr(Ts));
			O->SetField(TEXT("v"), NumArr(Vs));
			List.Add(MakeShared<FJsonValueObject>(O));
		});
		Out->SetArrayField(Names.Num() == 0 ? TEXT("counters") : TEXT("series"), List);
	}

	void QueryLog(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out)
	{
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const FString Filter = Str(A, TEXT("filter"));
		const int32 Top = FMath::Clamp(Int(A, TEXT("top"), 500), 1, 5000);
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Total = 0;
		ReadLogProvider(S).EnumerateMessages(T0, T1, [&](const TraceServices::FLogMessageInfo& M)
		{
			const FString Text = M.Message ? M.Message : TEXT("");
			const FString Cat = M.Category && M.Category->Name ? M.Category->Name : TEXT("");
			if (!Filter.IsEmpty() && !Text.Contains(Filter) && !Cat.Contains(Filter))
			{
				return;
			}
			++Total;
			if (Items.Num() >= Top)
			{
				return;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("t"), M.Time);
			O->SetStringField(TEXT("v"), ToString(M.Verbosity));
			O->SetStringField(TEXT("c"), Cat);
			O->SetStringField(TEXT("m"), Text.Left(2000));
			Items.Add(MakeShared<FJsonValueObject>(O));
		});
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
	}

	void QueryBookmarks(const IAnalysisSession& S, TSharedPtr<FJsonObject>& Out)
	{
		TArray<TSharedPtr<FJsonValue>> Items;
		ReadBookmarkProvider(S).EnumerateBookmarks(0, S.GetDurationSeconds(), [&](const TraceServices::FBookmark& B)
		{
			if (Items.Num() >= 2000)
			{
				return;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("t"), B.Time);
			O->SetStringField(TEXT("text"), B.Text ? B.Text : TEXT(""));
			Items.Add(MakeShared<FJsonValueObject>(O));
		});
		Out->SetArrayField(TEXT("items"), Items);
	}
}
	// ---------- 查询在后台线程跑（2.11） ----------
	// 以前 trace.query 在游戏线程上同步算：大 trace 查一次编辑器卡几秒，几个子任务一起查只能排队、编辑器一直卡。
	// 现在游戏线程只做「找会话」（缓存表只在游戏线程上动），计算交给线程池，最多同时 MaxParallel 个，多的排队。
	// 会话的引用在查询期间放在 Busy 里（游戏线程持有）：被挤出缓存也不会在后台线程上释放，编辑器退出时等查询收尾再一起放掉。

	/** 同时跑的查询上限：多个子任务一起查也只占这么几个线程池线程，不把编辑器拖慢 */
	constexpr int32 MaxParallel = 4;
	/** 单次查询的时间上限（秒）：超了返回已经算出的部分，标 truncated */
	constexpr double QuerySeconds = 20.0;

	/** 实际执行一次查询（后台线程，持有会话读锁）。What 不认识时返回 false */
	bool RunQuery(const IAnalysisSession& S, const FTraceFollow& Follow, const FString& What, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		// 分析线程在往里写：读之前拿读锁（Insights 也这么读）
		FAnalysisSessionReadScope Scope(S);
		const bool bDone = S.IsAnalysisComplete();
		Out->SetBoolField(TEXT("analyzing"), !bDone);
		Out->SetNumberField(TEXT("duration"), S.GetDurationSeconds());
		// 读取进度（2.8.1）：没分析完时网页显示「已读 X / Y MB」，录制中追上了（caughtUp）就先把已有的部分显示出来
		Out->SetNumberField(TEXT("readBytes"), static_cast<double>(Follow.ReadBytes.load()));
		Out->SetNumberField(TEXT("fileBytes"), static_cast<double>(Follow.FileBytes.load()));
		if (!bDone && Follow.Following())
		{
			Out->SetBoolField(TEXT("live"), true);
		}
		if (Follow.bAtEnd.load())
		{
			Out->SetBoolField(TEXT("caughtUp"), true);
		}
		// 第一帧的开始时间（2.8.1）：trace 的时间从进程启动算，面板按它换成「从录制开始算」
		Out->SetNumberField(TEXT("origin"), FirstFrameTime(S));
		if (What == TEXT("info"))
		{
			QueryInfo(S, Out);
			return true;
		}
		if (What == TEXT("frames"))
		{
			QueryFrames(S, A, Out);
			return true;
		}
		if (What == TEXT("bookmarks"))
		{
			QueryBookmarks(S, Out);
			return true;
		}
		if (What == TEXT("log"))
		{
			QueryLog(S, A, Out);
			return true;
		}
		if (What == TEXT("counters"))
		{
			QueryCounters(S, A, Out);
			return true;
		}
		// 2.11：不靠计时器的几类（各自的 Provider 不在时返回 false 并说明要录哪个通道）
		if (What == TEXT("session"))
		{
			QuerySession(S, Out);
			return true;
		}
		if (What == TEXT("regions"))
		{
			return QueryRegions(S, A, Out, Error);
		}
		if (What == TEXT("memtags"))
		{
			return QueryMemTags(S, A, Out, Error);
		}
		if (What == TEXT("allocs"))
		{
			return QueryAllocs(S, A, Out, Error);
		}
		if (What == TEXT("loads"))
		{
			return QueryLoads(S, A, Out, Error);
		}
		if (What == TEXT("files"))
		{
			return QueryFiles(S, A, Out, Error);
		}
		if (What == TEXT("tasks"))
		{
			return QueryTasks(S, A, Out, Error);
		}
		if (What == TEXT("switches"))
		{
			return QuerySwitches(S, A, Out, Error);
		}
		if (What == TEXT("net"))
		{
			return QueryNet(S, A, Out, Error);
		}
		const ITimingProfilerProvider* TP = ReadTimingProfilerProvider(S);
		if (!TP)
		{
			Error = TEXT("这份 trace 里没有 CPU / GPU 计时数据：录制时要开 cpu 通道");
			return false;
		}
		if (What == TEXT("timing"))
		{
			return QueryTiming(S, *TP, A, Out, Error);
		}
		if (What == TEXT("timers"))
		{
			QueryTimers(S, *TP, A, Out);
			return true;
		}
		if (What == TEXT("butterfly"))
		{
			return QueryButterfly(S, *TP, A, Out, Error);
		}
		if (What == TEXT("stack"))
		{
			return QueryStack(S, *TP, A, Out, Error);
		}
		if (What == TEXT("instances"))
		{
			return QueryInstances(S, *TP, A, Out, Error);
		}
		// 2.9.0：Lua 计时器的文件和行号、自上而下的调用树（AgentPanelTraceLua.cpp）
		if (What == TEXT("luainfo"))
		{
			QueryLuaInfo(*TP, Out);
			return true;
		}
		if (What == TEXT("tree"))
		{
			return QueryTree(S, *TP, A, Out, Error);
		}
		// 2.11：帧内各线程耗时、卡顿归因（AgentPanelTraceFrames.cpp）
		if (What == TEXT("framestats"))
		{
			return QueryFrameStats(S, *TP, A, Out, Error);
		}
		if (What == TEXT("framediff"))
		{
			return QueryFrameDiff(S, *TP, A, Out, Error);
		}
		Error = FString::Printf(TEXT("不认识的查询：%s（info / frames / timing / timers / butterfly / stack / instances / tree / luainfo / counters / log / bookmarks / framestats / framediff / session / regions / memtags / allocs / loads / files / tasks / switches / net）"), *What);
		return false;
	}

	namespace
	{
		struct FQueryJob
		{
			int32 Id = 0;
			TSharedPtr<const IAnalysisSession> Session;
			TSharedPtr<FTraceFollow, ESPMode::ThreadSafe> Follow;
			FString What;
			TSharedPtr<FJsonObject> Args;
			FAgentPanelReply Reply;
		};

		/** 下面这些只在游戏线程上动 */
		struct FQueryQueue
		{
			TArray<FQueryJob> Pending;
			/** 正在后台算的查询持有的会话（按查询编号） */
			TMap<int32, TSharedPtr<const IAnalysisSession>> Busy;
			int32 NextId = 1;
		};

		FQueryQueue& Queue()
		{
			// 和会话缓存一样不静态析构（见 Sessions()）
			static FQueryQueue* Q = new FQueryQueue();
			return *Q;
		}

		/** 正在后台跑的查询数（后台线程结束时减，退出时等它归零） */
		std::atomic<int32> GRunning{ 0 };

		void Pump();

		void Launch(FQueryJob&& Job)
		{
			FQueryQueue& Q = Queue();
			Q.Busy.Add(Job.Id, Job.Session);
			const IAnalysisSession* S = Job.Session.Get();
			GRunning.fetch_add(1);
			Async(EAsyncExecution::ThreadPool, [S, Follow = Job.Follow, What = Job.What, Args = Job.Args, Reply = MoveTemp(Job.Reply), Id = Job.Id]()
			{
				TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
				FString Error;
				BeginBudget(QuerySeconds);
				const bool bOk = S && Follow.IsValid() && RunQuery(*S, *Follow, What, Args, Out, Error);
				if (bOk && BudgetHit())
				{
					Out->SetBoolField(TEXT("truncated"), true);
					Out->SetStringField(TEXT("truncatedNote"), GCancelQueries.load()
						? TEXT("编辑器正在退出，查询没算完")
						: FString::Printf(TEXT("查询超过 %.0f 秒，只算了一部分：缩小范围（from / to、frame、lane）再查"), QuerySeconds));
				}
				Reply(bOk, Out, Error);
				// 会话引用回到游戏线程再放（不在后台线程上释放分析会话），顺便放下一个排队的查询进来
				AsyncTask(ENamedThreads::GameThread, [Id]()
				{
					Queue().Busy.Remove(Id);
					Pump();
				});
				GRunning.fetch_sub(1);
			});
		}

		void Pump()
		{
			FQueryQueue& Q = Queue();
			while (Q.Busy.Num() < MaxParallel && Q.Pending.Num() > 0 && !GCancelQueries.load())
			{
				FQueryJob Job = MoveTemp(Q.Pending[0]);
				Q.Pending.RemoveAt(0);
				Launch(MoveTemp(Job));
			}
		}
	}
} // namespace UELinkTrace

namespace AgentPanelEd
{
	static FDelegateHandle GTracePreExit;

	void ShutdownTraceOps()
	{
		FCoreDelegates::OnEnginePreExit.Remove(GTracePreExit);
		GTracePreExit.Reset();
		// 先叫停后台查询（走事件的循环几千个事件内就会停），排队的直接回「在退出」，等正在跑的收尾（最多 3 秒）
		UELinkTrace::GCancelQueries.store(true);
		UELinkTrace::FQueryQueue& Q = UELinkTrace::Queue();
		for (UELinkTrace::FQueryJob& Job : Q.Pending)
		{
			Job.Reply(false, nullptr, TEXT("编辑器正在退出，查询取消了"));
		}
		Q.Pending.Empty();
		const double Until = FPlatformTime::Seconds() + 3.0;
		while (UELinkTrace::GRunning.load() > 0 && FPlatformTime::Seconds() < Until)
		{
			FPlatformProcess::Sleep(0.01f);
		}
		UELinkTrace::FSessionCache& Cache = UELinkTrace::Sessions();
		if (FModuleManager::Get().IsModuleLoaded(TEXT("TraceServices")) && UELinkTrace::GRunning.load() == 0)
		{
			Q.Busy.Empty();
			Cache.Clear();
			return;
		}
		// TraceServices 已经卸载，或者还有查询没收尾：会话不能再释放，叫停读取后整个丢给进程退出回收
		for (TPair<FString, UELinkTrace::FEntry>& P : Cache.Map)
		{
			UELinkTrace::FSessionCache::Drop(P.Value);
		}
		static TMap<FString, UELinkTrace::FEntry>* Leaked = nullptr;
		Leaked = new TMap<FString, UELinkTrace::FEntry>(MoveTemp(Cache.Map));
		Cache.Map.Reset();
		static TMap<int32, TSharedPtr<const TraceServices::IAnalysisSession>>* LeakedBusy = nullptr;
		LeakedBusy = new TMap<int32, TSharedPtr<const TraceServices::IAnalysisSession>>(MoveTemp(Q.Busy));
		Q.Busy.Reset();
	}

	void RegisterTraceOps()
	{
		// 引擎退出前（TraceServices 还在）就把分析会话放掉；模块卸载时 ShutdownTraceOps 再兜一次
		GTracePreExit = FCoreDelegates::OnEnginePreExit.AddStatic(&ShutdownTraceOps);
		UELinkTrace::GCancelQueries.store(false);
		// 块作用域的 using 不会漏到别的文件（见文件头）
		using namespace UELinkTrace;
		using namespace TraceServices;
		// 2.11 起是异步操作：游戏线程上只找会话（必要时开始分析），计算在线程池里做，编辑器不卡
		FAgentPanelBridge::Get().AddAsyncOp(TEXT("trace.query"), [](const TSharedPtr<FJsonObject>& A, FAgentPanelReply Reply)
		{
			const FString File = FPaths::ConvertRelativePathToFull(Str(A, TEXT("file")));
			bool bLive = false;
			A->TryGetBoolField(TEXT("live"), bLive);
			FEntry* Entry = nullptr;
			FString Error;
			TSharedPtr<const IAnalysisSession> Session = SessionFor(File, bLive, Entry, Error);
			if (!Session.IsValid() || !Entry)
			{
				Reply(false, nullptr, Error);
				return;
			}
			FQueryQueue& Q = Queue();
			FQueryJob Job;
			Job.Id = Q.NextId++;
			Job.Session = Session;
			Job.Follow = Entry->Follow;
			Job.What = Str(A, TEXT("what"), TEXT("info"));
			Job.Args = A;
			Job.Reply = MoveTemp(Reply);
			Q.Pending.Add(MoveTemp(Job));
			Pump();
		});
	}
}
