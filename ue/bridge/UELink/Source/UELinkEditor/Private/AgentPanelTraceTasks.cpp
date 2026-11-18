// trace.query 的任务和线程切换两类（2.11，面板「UE 性能分析 MCP 接口」设计稿 3 节）：
// - tasks：任务系统（task 通道）——按任务名聚合：次数、执行时间、从发起到开始执行等了多久（排队）；最慢的几个任务；
// - switches：线程切换（contextswitch 通道，Windows 上要管理员权限）——每条线程在范围内真正在 CPU 上跑的时间和被切换的次数，
//   和计时器的「忙」对照就能分清「在算」还是「被抢占 / 在等锁」。
// 和其他查询一样在后台线程、会话读锁里跑。引擎版本差异只在 UELinkCompat.h 的宏里；哪类编不过就把对应的 UELINK_TRACE_* 改成 0。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/Threads.h"
#include "TraceServices/Model/TimingProfiler.h"
#if UELINK_TRACE_TASKS
#include "TraceServices/Model/TasksProfiler.h"
#endif
#if UELINK_TRACE_SWITCHES
#include "TraceServices/Model/ContextSwitches.h"
#endif

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
	// ---------- 任务 ----------

	bool HasTasks(const IAnalysisSession& S)
	{
#if UELINK_TRACE_TASKS
		const ITasksProvider* TP = ReadTasksProvider(S);
		return TP && TP->GetNumTasks() > 0;
#else
		return false;
#endif
	}

	bool QueryTasks(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_TASKS
		const ITasksProvider* TP = ReadTasksProvider(S);
		if (!TP || TP->GetNumTasks() == 0)
		{
			Error = NoData(TEXT("任务"), TEXT("task"), TEXT("（或用 preset=task）"));
			return false;
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const FString Filter = AgentPanel::Str(A, TEXT("filter"));
		const FString Sort = AgentPanel::Str(A, TEXT("sort"), TEXT("exec"));
		const int32 Top = FMath::Clamp(AgentPanel::Int(A, TEXT("top"), 30), 1, 200);
		struct FAggT
		{
			int64 Count = 0;
			double Exec = 0;
			double ExecMax = 0;
			double Wait = 0;
			double WaitMax = 0;
		};
		struct FSlow
		{
			FString Name;
			double Start;
			double Exec;
			double Wait;
			uint32 Thread;
		};
		TMap<FString, FAggT> Agg;
		TArray<FSlow> Slow;
		int64 Total = 0;
		TP->EnumerateTasks(T0, T1, UELINK_TASK_ENUM_OPTION, [&](const TraceServices::FTaskInfo& T)
		{
			if (OverBudget())
			{
				return TraceServices::ETaskEnumerationResult::Stop;
			}
			const FString Name = T.DebugName ? T.DebugName : TEXT("(没有名字)");
			if (!Filter.IsEmpty() && !Name.Contains(Filter))
			{
				return TraceServices::ETaskEnumerationResult::Continue;
			}
			// 没开始或没结束的（录制边界上的）只算看得到的部分
			const bool bStarted = FMath::IsFinite(T.StartedTimestamp) && T.StartedTimestamp > 0;
			const bool bFinished = FMath::IsFinite(T.FinishedTimestamp) && T.FinishedTimestamp > 0;
			const double Exec = bStarted && bFinished ? FMath::Max(0.0, T.FinishedTimestamp - T.StartedTimestamp) : 0.0;
			const bool bLaunched = FMath::IsFinite(T.LaunchedTimestamp) && T.LaunchedTimestamp > 0;
			const double Wait = bLaunched && bStarted ? FMath::Max(0.0, T.StartedTimestamp - T.LaunchedTimestamp) : 0.0;
			FAggT& G = Agg.FindOrAdd(Name);
			++G.Count;
			G.Exec += Exec;
			G.ExecMax = FMath::Max(G.ExecMax, Exec);
			G.Wait += Wait;
			G.WaitMax = FMath::Max(G.WaitMax, Wait);
			++Total;
			Slow.Add({ Name, bStarted ? T.StartedTimestamp : T.LaunchedTimestamp, Exec, Wait, T.StartedThreadId });
			return TraceServices::ETaskEnumerationResult::Continue;
		});
		const bool bWait = Sort == TEXT("wait");
		TArray<TPair<FString, FAggT>> Rows;
		for (const TPair<FString, FAggT>& P : Agg)
		{
			Rows.Add(P);
		}
		Rows.Sort([bWait](const TPair<FString, FAggT>& X, const TPair<FString, FAggT>& Y) { return bWait ? X.Value.Wait > Y.Value.Wait : X.Value.Exec > Y.Value.Exec; });
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 i = 0; i < Rows.Num() && i < Top; ++i)
		{
			const FAggT& G = Rows[i].Value;
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), Rows[i].Key);
			O->SetNumberField(TEXT("count"), static_cast<double>(G.Count));
			O->SetNumberField(TEXT("execMs"), Ms(G.Exec));
			O->SetNumberField(TEXT("execMaxMs"), Ms(G.ExecMax));
			O->SetNumberField(TEXT("waitMs"), Ms(G.Wait));
			O->SetNumberField(TEXT("waitMaxMs"), Ms(G.WaitMax));
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		Slow.Sort([bWait](const FSlow& X, const FSlow& Y) { return bWait ? X.Wait > Y.Wait : X.Exec > Y.Exec; });
		TArray<TSharedPtr<FJsonValue>> SlowItems;
		for (int32 i = 0; i < Slow.Num() && i < 10; ++i)
		{
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), Slow[i].Name);
			O->SetNumberField(TEXT("start"), Fin(Slow[i].Start));
			O->SetNumberField(TEXT("execMs"), Ms(Slow[i].Exec));
			O->SetNumberField(TEXT("waitMs"), Ms(Slow[i].Wait));
			O->SetNumberField(TEXT("lane"), Slow[i].Thread);
			SlowItems.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetNumberField(TEXT("tasks"), static_cast<double>(Total));
		Out->SetNumberField(TEXT("names"), Rows.Num());
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetArrayField(TEXT("slowest"), SlowItems);
		return true;
#else
		Error = Disabled(TEXT("任务"));
		return false;
#endif
	}

	// ---------- 线程切换 ----------

	bool HasSwitches(const IAnalysisSession& S)
	{
#if UELINK_TRACE_SWITCHES
		const IContextSwitchesProvider* CP = ReadContextSwitchesProvider(S);
		return CP && CP->HasData();
#else
		return false;
#endif
	}

	bool QuerySwitches(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_SWITCHES
		const IContextSwitchesProvider* CP = ReadContextSwitchesProvider(S);
		if (!CP || !CP->HasData())
		{
			Error = NoData(TEXT("线程切换"), TEXT("contextswitch"), TEXT("（或用 preset=task；Windows 上 UE 要用管理员权限运行）"));
			return false;
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		TArray<int32> Want = Lanes(A);
		const double Span = FMath::Max(1e-9, T1 - T0);
		TArray<TSharedPtr<FJsonValue>> Items;
		ReadThreadProvider(S).EnumerateThreads([&](const TraceServices::FThreadInfo& T)
		{
			if (Want.Num() > 0 && !Want.Contains(static_cast<int32>(T.Id)))
			{
				return;
			}
			if (OverBudget())
			{
				return;
			}
			double Run = 0;
			int64 Count = 0;
			CP->EnumerateContextSwitches(T.Id, T0, T1, [&](const TraceServices::FContextSwitch& C)
			{
				const double Overlap = FMath::Min(C.End, T1) - FMath::Max(C.Start, T0);
				if (Overlap > 0)
				{
					Run += Overlap;
				}
				++Count;
				return TraceServices::EContextSwitchEnumerationResult::Continue;
			});
			if (Count == 0)
			{
				return;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("lane"), T.Id);
			O->SetStringField(TEXT("name"), T.Name ? T.Name : TEXT(""));
			O->SetNumberField(TEXT("runMs"), Ms(Run));
			O->SetNumberField(TEXT("runShare"), Fin(FMath::RoundToDouble(Run / Span * 1000.0) / 1000.0));
			O->SetNumberField(TEXT("switches"), static_cast<double>(Count));
			Items.Add(MakeShared<FJsonValueObject>(O));
		});
		Items.Sort([](const TSharedPtr<FJsonValue>& X, const TSharedPtr<FJsonValue>& Y)
		{
			const TSharedPtr<FJsonObject> XO = X->AsObject();
			const TSharedPtr<FJsonObject> YO = Y->AsObject();
			return XO.IsValid() && YO.IsValid() && XO->GetNumberField(TEXT("runMs")) > YO->GetNumberField(TEXT("runMs"));
		});
		Out->SetArrayField(TEXT("items"), Items);
		return true;
#else
		Error = Disabled(TEXT("线程切换"));
		return false;
#endif
	}
}
