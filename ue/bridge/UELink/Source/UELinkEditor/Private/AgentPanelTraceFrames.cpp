// trace.query 里按帧算的两个查询（2.11，面板「UE 性能分析 MCP 接口」设计稿 7.1）：
// - framestats：每帧每条线程忙了多久（深度 0 的块落在这一帧里的部分），面板据此算瓶颈线程、各线程每帧平均、卡顿帧是谁拖的；
// - framediff：一组帧（通常是卡顿帧）和基线帧（接近中位数的普通帧）比，每帧独占时间涨得最多的计时器，一遍算完。
// 以前 Agent 要对每个卡顿帧各查一次 timers 再和平均比，十几帧就是几十次往返；这里一次给齐。
// 和其他 trace 查询一样在后台线程、会话读锁里跑（AgentPanelTrace.cpp 的 RunQuery），走事件时受查询预算约束。
// TraceServices 的类型写全名，using 只在具名命名空间里（单体构建，见 AgentPanelTrace.cpp 开头）。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Algo/BinarySearch.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/Frames.h"
#include "TraceServices/Model/Threads.h"
#include "TraceServices/Model/TimingProfiler.h"

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
namespace TraceFramesImpl
{
	/** 一帧最多回多少个涨得多的计时器、一次最多比多少帧 */
	constexpr int32 MaxDiffFrames = 200;
	constexpr int32 MaxBaseFrames = 120;

	/** 默认看的线程：GPU、游戏线程、渲染线程、RHI 线程（名字里带这几个词的都算，渲染线程在有的版本叫 RenderThread 1） */
	TArray<int32> DefaultLanes(const IAnalysisSession& S, const ITimingProfilerProvider& TP)
	{
		TArray<int32> Out;
		uint32 Index = 0;
		if (TP.GetGpuTimelineIndex(Index))
		{
			Out.Add(GpuLane);
		}
		ReadThreadProvider(S).EnumerateThreads([&](const TraceServices::FThreadInfo& T)
		{
			const FString Name = T.Name ? T.Name : TEXT("");
			uint32 TL = 0;
			if (!TP.GetCpuThreadTimelineIndex(T.Id, TL))
			{
				return;
			}
			if (Name.Contains(TEXT("GameThread")) || Name.Contains(TEXT("RenderThread")) || Name.Contains(TEXT("RHIThread")))
			{
				Out.Add(static_cast<int32>(T.Id));
			}
		});
		return Out;
	}

	FString LaneName(const IAnalysisSession& S, int32 Lane)
	{
		if (Lane == GpuLane)
		{
			return TEXT("GPU");
		}
		FString Name;
		ReadThreadProvider(S).EnumerateThreads([&](const TraceServices::FThreadInfo& T)
		{
			if (static_cast<int32>(T.Id) == Lane && T.Name)
			{
				Name = T.Name;
			}
		});
		return Name;
	}

	/** 帧号列表（请求里的 frames / base 数组），越界的丢掉 */
	TArray<int32> FrameList(const TSharedPtr<FJsonObject>& A, const TCHAR* Key, int32 Count, int32 Max)
	{
		TArray<int32> Out;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (A->TryGetArrayField(Key, Arr) && Arr)
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				const int32 F = V.IsValid() ? static_cast<int32>(V->AsNumber()) : -1;
				if (F >= 0 && F < Count && Out.Num() < Max)
				{
					Out.AddUnique(F);
				}
			}
		}
		return Out;
	}

	/** 两位小数的毫秒：几万帧乘几条线程，JSON 小很多 */
	double Ms2(double Seconds)
	{
		return Fin(FMath::RoundToDouble(Seconds * 100000.0) / 100.0);
	}

	/** 一帧里各计时器的独占时间（秒）：开始时间落在这一帧里的块记它自己的独占时间 */
	void FrameExcl(const ITimingProfilerProvider& TP, const FTimers& Timers, const TArray<int32>& LaneIds, double T0, double T1, TMap<uint32, double>& Into, TSet<uint32>* GpuTimers)
	{
		for (int32 Lane : LaneIds)
		{
			Walk(TP, Timers, Lane, T0, T1, [&](double Start, double End, int32, uint32 Timer, double Child, const TArray<FOpen>&)
			{
				if (Start < T0 || Start >= T1)
				{
					return;
				}
				Into.FindOrAdd(Timer) += FMath::Max(0.0, End - Start - Child);
				if (GpuTimers && Lane == GpuLane)
				{
					GpuTimers->Add(Timer);
				}
			});
		}
	}
}

	bool QueryFrameStats(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		using namespace TraceFramesImpl;
		const bool bRender = AgentPanel::Str(A, TEXT("type")) == TEXT("render");
		TArray<double> Begin;
		TArray<double> End;
		ReadFrames(S, bRender, Begin, End);
		const int32 Count = Begin.Num();
		if (Count == 0)
		{
			Error = TEXT("这份 trace 里还没有帧：录制时要开 frame 通道，或者录得太短");
			return false;
		}
		const int32 F0 = FMath::Clamp(AgentPanel::Int(A, TEXT("f0"), 0), 0, Count - 1);
		const int32 F1 = FMath::Clamp(AgentPanel::Int(A, TEXT("f1"), Count), F0 + 1, Count);
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = DefaultLanes(S, TP);
		}
		FTimers Timers(TP);
		const double T0 = Begin[F0];
		const double T1 = End[F1 - 1];
		TArray<TSharedPtr<FJsonValue>> LanesOut;
		for (int32 Lane : Want)
		{
			TArray<double> Busy;
			Busy.SetNumZeroed(F1 - F0);
			const bool bLane = Walk(TP, Timers, Lane, T0, T1, [&](double Start, double Stop, int32 Depth, uint32, double, const TArray<FOpen>&)
			{
				if (Depth != 0 || Stop <= T0 || Start >= T1)
				{
					return;
				}
				// 第一个结束时间晚于块开始的帧，往后逐帧加上重叠的部分
				int32 F = Algo::UpperBound(End, Start);
				F = FMath::Max(F, F0);
				for (; F < F1 && Begin[F] < Stop; ++F)
				{
					const double Overlap = FMath::Min(Stop, End[F]) - FMath::Max(Start, Begin[F]);
					if (Overlap > 0)
					{
						Busy[F - F0] += Overlap;
					}
				}
			});
			if (!bLane)
			{
				continue;
			}
			TArray<double> BusyMs;
			BusyMs.Reserve(Busy.Num());
			for (double B : Busy)
			{
				BusyMs.Add(Ms2(B));
			}
			TSharedPtr<FJsonObject> L = MakeShared<FJsonObject>();
			L->SetNumberField(TEXT("id"), Lane);
			L->SetStringField(TEXT("name"), LaneName(S, Lane));
			L->SetField(TEXT("busy"), NumArr(BusyMs));
			LanesOut.Add(MakeShared<FJsonValueObject>(L));
		}
		TArray<double> FrameMs;
		FrameMs.Reserve(F1 - F0);
		for (int32 F = F0; F < F1; ++F)
		{
			FrameMs.Add(Ms2(End[F] - Begin[F]));
		}
		Out->SetStringField(TEXT("type"), bRender ? TEXT("render") : TEXT("game"));
		Out->SetNumberField(TEXT("f0"), F0);
		Out->SetNumberField(TEXT("count"), F1 - F0);
		Out->SetNumberField(TEXT("total"), Count);
		Out->SetField(TEXT("ms"), NumArr(FrameMs));
		Out->SetArrayField(TEXT("lanes"), LanesOut);
		return true;
	}

	bool QueryFrameDiff(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		using namespace TraceFramesImpl;
		const bool bRender = AgentPanel::Str(A, TEXT("type")) == TEXT("render");
		TArray<double> Begin;
		TArray<double> End;
		ReadFrames(S, bRender, Begin, End);
		const int32 Count = Begin.Num();
		if (Count == 0)
		{
			Error = TEXT("这份 trace 里还没有帧：录制时要开 frame 通道，或者录得太短");
			return false;
		}
		const TArray<int32> Targets = FrameList(A, TEXT("frames"), Count, MaxDiffFrames);
		if (Targets.Num() == 0)
		{
			Error = TEXT("要给 frames（帧号数组，从 frames / hitches 查询里拿）");
			return false;
		}
		TArray<int32> Base = FrameList(A, TEXT("base"), Count, MaxBaseFrames);
		if (Base.Num() == 0)
		{
			// 没给基线：按帧时间排序取中间那一段（P40–P60），均匀挑最多 MaxBaseFrames 帧，代表「平时的一帧」
			TArray<int32> Order;
			Order.Reserve(Count);
			for (int32 i = 0; i < Count; ++i)
			{
				Order.Add(i);
			}
			Order.Sort([&](int32 X, int32 Y) { return (End[X] - Begin[X]) < (End[Y] - Begin[Y]); });
			const int32 Lo = Count * 2 / 5;
			const int32 Hi = FMath::Max(Lo + 1, Count * 3 / 5);
			const int32 Step = FMath::Max(1, (Hi - Lo) / MaxBaseFrames);
			for (int32 i = Lo; i < Hi && Base.Num() < MaxBaseFrames; i += Step)
			{
				Base.Add(Order[i]);
			}
		}
		const int32 Top = FMath::Clamp(AgentPanel::Int(A, TEXT("top"), 8), 1, 50);
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = AllLanes(S, TP);
		}
		FTimers Timers(TP);
		TSet<uint32> Gpu;
		TMap<uint32, double> BaseSum;
		double BaseMs = 0;
		for (int32 F : Base)
		{
			FrameExcl(TP, Timers, Want, Begin[F], End[F], BaseSum, &Gpu);
			BaseMs += End[F] - Begin[F];
		}
		const double NBase = FMath::Max(1, Base.Num());
		TArray<TSharedPtr<FJsonValue>> Frames;
		for (int32 F : Targets)
		{
			if (OverBudget())
			{
				break;
			}
			TMap<uint32, double> Mine;
			FrameExcl(TP, Timers, Want, Begin[F], End[F], Mine, &Gpu);
			struct FRow
			{
				uint32 Id;
				double Excl;
				double Base;
			};
			TArray<FRow> Rows;
			for (const TPair<uint32, double>& P : Mine)
			{
				const double* B = BaseSum.Find(P.Key);
				Rows.Add({ P.Key, P.Value, B ? *B / NBase : 0.0 });
			}
			Rows.Sort([](const FRow& X, const FRow& Y) { return (X.Excl - X.Base) > (Y.Excl - Y.Base); });
			TArray<TSharedPtr<FJsonValue>> Items;
			for (int32 i = 0; i < Rows.Num() && i < Top; ++i)
			{
				const FRow& R = Rows[i];
				if (R.Excl - R.Base <= 0)
				{
					break;
				}
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetNumberField(TEXT("id"), R.Id);
				O->SetStringField(TEXT("name"), Timers.Name(R.Id));
				O->SetNumberField(TEXT("excl"), Ms2(R.Excl));
				O->SetNumberField(TEXT("base"), Ms2(R.Base));
				if (Gpu.Contains(R.Id))
				{
					O->SetBoolField(TEXT("gpu"), true);
				}
				const int32 Lua = Timers.LuaKind(R.Id);
				if (Lua != 0)
				{
					O->SetStringField(TEXT("file"), Timers.File(R.Id));
					O->SetNumberField(TEXT("line"), Timers.Line(R.Id));
					if (Lua == 2)
					{
						O->SetBoolField(TEXT("c"), true);
					}
				}
				Items.Add(MakeShared<FJsonValueObject>(O));
			}
			TSharedPtr<FJsonObject> FO = MakeShared<FJsonObject>();
			FO->SetNumberField(TEXT("frame"), F);
			FO->SetNumberField(TEXT("start"), Begin[F]);
			FO->SetNumberField(TEXT("ms"), Ms2(End[F] - Begin[F]));
			FO->SetArrayField(TEXT("items"), Items);
			Frames.Add(MakeShared<FJsonValueObject>(FO));
		}
		TSharedPtr<FJsonObject> BO = MakeShared<FJsonObject>();
		BO->SetNumberField(TEXT("frames"), Base.Num());
		BO->SetNumberField(TEXT("ms"), Ms2(BaseMs / NBase));
		Out->SetObjectField(TEXT("base"), BO);
		Out->SetArrayField(TEXT("frames"), Frames);
		return true;
	}
}
