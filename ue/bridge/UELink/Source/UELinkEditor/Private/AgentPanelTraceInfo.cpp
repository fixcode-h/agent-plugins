// trace.query 的 session 和 regions（2.11，面板「UE 性能分析 MCP 接口」设计稿 3 节）：
// - session：录的是什么平台、什么构建配置、什么程序和命令行（Agent 判断数字可不可信：Debug 构建、PIE、编辑器里录的都偏慢），
//   以及这份 trace 里有哪几类数据（内存、加载、任务、网络……），没有的就不用去查；
// - regions：Timing Regions（TRACE_BEGIN_REGION / TRACE_END_REGION 标的时间段）。
// 和其他查询一样在后台线程、会话读锁里跑。引擎版本差异只在 UELinkCompat.h 的宏里。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "GenericPlatform/GenericPlatformMisc.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/Counters.h"
#include "TraceServices/Model/Frames.h"
#include "TraceServices/Model/Threads.h"
#include "TraceServices/Model/TimingProfiler.h"
#if UELINK_TRACE_SESSION
#include "TraceServices/Model/Diagnostics.h"
#endif
#if UELINK_TRACE_REGIONS
#include "TraceServices/Model/Regions.h"
#endif

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
	void QuerySession(const IAnalysisSession& S, TSharedPtr<FJsonObject>& Out)
	{
		Out->SetStringField(TEXT("name"), S.GetName());
#if UELINK_TRACE_SESSION
		const IDiagnosticsProvider* DP = ReadDiagnosticsProvider(S);
		if (DP && DP->IsSessionInfoAvailable())
		{
			const auto& Info = DP->GetSessionInfo();
			Out->SetStringField(TEXT("platform"), Info.Platform);
			Out->SetStringField(TEXT("app"), Info.AppName);
			Out->SetStringField(TEXT("commandLine"), Info.CommandLine.Left(2000));
			Out->SetStringField(TEXT("branch"), Info.Branch);
			Out->SetStringField(TEXT("build"), Info.BuildVersion);
			Out->SetNumberField(TEXT("changelist"), Info.Changelist);
			Out->SetStringField(TEXT("config"), LexToString(Info.ConfigurationType));
			Out->SetStringField(TEXT("target"), LexToString(Info.TargetType));
		}
#endif
		const IFrameProvider& FP = ReadFrameProvider(S);
		Out->SetNumberField(TEXT("gameFrames"), static_cast<double>(FP.GetFrameCount(TraceFrameType_Game)));
		Out->SetNumberField(TEXT("renderFrames"), static_cast<double>(FP.GetFrameCount(TraceFrameType_Rendering)));
		int32 Threads = 0;
		ReadThreadProvider(S).EnumerateThreads([&](const TraceServices::FThreadInfo&) { ++Threads; });
		Out->SetNumberField(TEXT("threads"), Threads);
		int32 Counters = 0;
		ReadCounterProvider(S).EnumerateCounters([&](uint32, const TraceServices::ICounter&) { ++Counters; });
		Out->SetNumberField(TEXT("counters"), Counters);
		// 有哪几类数据：Agent 据此决定查什么、缺什么要重录
		TSharedPtr<FJsonObject> Has = MakeShared<FJsonObject>();
		const ITimingProfilerProvider* TP = ReadTimingProfilerProvider(S);
		uint32 Gpu = 0;
		Has->SetBoolField(TEXT("cpu"), TP != nullptr);
		Has->SetBoolField(TEXT("gpu"), TP && TP->GetGpuTimelineIndex(Gpu));
		Has->SetBoolField(TEXT("lua"), TP && HasLuaTimers(*TP));
		Has->SetBoolField(TEXT("regions"), HasRegions(S));
		Has->SetBoolField(TEXT("memtags"), HasMemTags(S));
		Has->SetBoolField(TEXT("allocs"), HasAllocs(S));
		Has->SetBoolField(TEXT("loads"), HasLoads(S));
		Has->SetBoolField(TEXT("files"), HasFiles(S));
		Has->SetBoolField(TEXT("tasks"), HasTasks(S));
		Has->SetBoolField(TEXT("switches"), HasSwitches(S));
		Has->SetBoolField(TEXT("net"), HasNet(S));
		Out->SetObjectField(TEXT("has"), Has);
	}

	bool HasRegions(const IAnalysisSession& S)
	{
#if UELINK_TRACE_REGIONS
		return UELINK_REGION_PROVIDER(S)->GetRegionCount() > 0;
#else
		return false;
#endif
	}

	bool QueryRegions(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_REGIONS
		const IRegionProvider* RP = UELINK_REGION_PROVIDER(S);
		if (!RP || RP->GetRegionCount() == 0)
		{
			Error = NoData(TEXT("区域（Timing Regions）"), TEXT("region"), TEXT("；代码里要用 TRACE_BEGIN_REGION / TRACE_END_REGION 标时间段"));
			return false;
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const FString Filter = AgentPanel::Str(A, TEXT("filter"));
		const int32 Top = FMath::Clamp(AgentPanel::Int(A, TEXT("top"), 200), 1, 2000);
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Total = 0;
		RP->EnumerateRegions(T0, T1, [&](const TraceServices::FTimeRegion& R) -> bool
		{
			const FString Text = R.Text ? R.Text : TEXT("");
			if (!Filter.IsEmpty() && !Text.Contains(Filter))
			{
				return true;
			}
			++Total;
			if (Items.Num() < Top)
			{
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("text"), Text);
				O->SetNumberField(TEXT("start"), Fin(R.BeginTime));
				O->SetNumberField(TEXT("ms"), FMath::IsFinite(R.EndTime) ? Ms(R.EndTime - R.BeginTime) : -1.0);
				O->SetNumberField(TEXT("depth"), R.Depth);
				Items.Add(MakeShared<FJsonValueObject>(O));
			}
			return !OverBudget();
		});
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
		return true;
#else
		Error = Disabled(TEXT("区域"));
		return false;
#endif
	}
}
