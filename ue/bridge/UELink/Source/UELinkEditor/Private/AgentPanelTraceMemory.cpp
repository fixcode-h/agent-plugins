// trace.query 的内存两类（2.11，面板「UE 性能分析 MCP 接口」设计稿 3 节）：
// - memtags：LLM 内存标签（memtag 通道，UE 要用 -llm 启动）——每个标签在范围内的平均、峰值、首尾差，给一个标签时回降采样走势；
// - allocs：内存分配（memalloc 通道，UE 要用 -trace=memory 启动）——某一时刻还活着的分配，或 A 到 B 之间分配了到 B 还没释放的
//   （泄漏和增长），按标签 / 调用栈 / 大小聚合。调用栈只回每组最上面几层有符号的帧（跳过分配器自己的帧）。
// 分配查询是 TraceServices 的异步查询：在后台线程里轮询到做完，超出查询预算就取消，回已经拿到的部分。
// 引擎版本差异只在 UELinkCompat.h 的宏里；哪类编不过就把对应的 UELINK_TRACE_* 改成 0。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/PlatformProcess.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/TimingProfiler.h"
#if UELINK_TRACE_MEMTAGS
#include "TraceServices/Model/Memory.h"
#endif
#if UELINK_TRACE_ALLOCS
#include "TraceServices/Model/AllocationsProvider.h"
#include "TraceServices/Model/Callstack.h"
#endif

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
namespace TraceMemoryImpl
{
	/** KB，保留一位小数 */
	double Kb(double Bytes)
	{
		return Fin(FMath::RoundToDouble(Bytes / 102.4) / 10.0);
	}

	TSharedPtr<FJsonValue> Strs(const TArray<FString>& V)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (const FString& S : V)
		{
			Out.Add(MakeShared<FJsonValueString>(S));
		}
		return MakeShared<FJsonValueArray>(Out);
	}
}

	// ---------- LLM 标签 ----------

	bool HasMemTags(const IAnalysisSession& S)
	{
#if UELINK_TRACE_MEMTAGS
		const IMemoryProvider* MP = ReadMemoryProvider(S);
		return MP && MP->GetTagCount() > 0;
#else
		return false;
#endif
	}

	bool QueryMemTags(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_MEMTAGS
		using namespace TraceMemoryImpl;
		const IMemoryProvider* MP = ReadMemoryProvider(S);
		if (!MP || MP->GetTagCount() == 0)
		{
			Error = NoData(TEXT(" LLM 内存标签"), TEXT("memtag"), TEXT("，并且 UE 要用 -llm 启动"));
			return false;
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const FString Want = AgentPanel::Str(A, TEXT("name"));
		const FString TrackerName = AgentPanel::Str(A, TEXT("tracker"), TEXT("Default"));
		const int32 Px = FMath::Clamp(AgentPanel::Int(A, TEXT("px"), 120), 10, 2000);
		// 跟踪器：LLM 有 Default（引擎按标签记的）和 Platform（按平台分配器记的）两套，默认 Default
		FMemoryTrackerId Tracker = 0;
		bool bTracker = false;
		TArray<FString> TrackerNames;
		MP->EnumerateTrackers([&](const FMemoryTrackerInfo& T)
		{
			// 名字在有的版本是 FString、有的是 TCHAR*：统一转成 FString
			const FString Name(T.Name);
			TrackerNames.Add(Name);
			if (!bTracker && Name.Equals(TrackerName, ESearchCase::IgnoreCase))
			{
				Tracker = T.Id;
				bTracker = true;
			}
		});
		if (!bTracker)
		{
			Error = FString::Printf(TEXT("没有叫 %s 的 LLM 跟踪器（有：%s）"), *TrackerName, *FString::Join(TrackerNames, TEXT("、")));
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Items;
		UELINK_MEM_ENUM_TAGS(MP, [&](const FMemoryTagInfo& Tag)
		{
			if (OverBudget())
			{
				return;
			}
			const FString TagName(Tag.Name);
			if (!Want.IsEmpty() && !TagName.Contains(Want))
			{
				return;
			}
			if (MP->GetTagSampleCount(Tracker, Tag.Id) == 0)
			{
				return;
			}
			int64 N = 0;
			double Sum = 0, Peak = 0, First = 0, Last = 0, Weight = 0;
			const bool bSeries = !Want.IsEmpty() && TagName.Equals(Want, ESearchCase::IgnoreCase);
			TArray<double> Ts;
			TArray<double> Vs;
			const double Step = FMath::Max(1e-9, (T1 - T0) / Px);
			MP->EnumerateTagSamples(Tracker, Tag.Id, T0, T1, true, [&](double Time, double Duration, const FMemoryTagSample& Sample)
			{
				const double V = static_cast<double>(Sample.Value);
				if (N == 0)
				{
					First = V;
				}
				Last = V;
				Peak = FMath::Max(Peak, V);
				// 按持续时间加权平均：采样间隔不均匀时不偏向密集的那一段
				const double W = FMath::Max(Duration, 1e-6);
				Sum += V * W;
				Weight += W;
				++N;
				if (bSeries)
				{
					const int32 Slot = static_cast<int32>((Time - T0) / Step);
					if (Ts.Num() > 0 && static_cast<int32>((Ts.Last() - T0) / Step) == Slot)
					{
						Vs.Last() = FMath::Max(Vs.Last(), Kb(V));
					}
					else
					{
						Ts.Add(Time);
						Vs.Add(Kb(V));
					}
				}
			});
			if (N == 0)
			{
				return;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), TagName);
			O->SetNumberField(TEXT("avgKB"), Kb(Weight > 0 ? Sum / Weight : 0));
			O->SetNumberField(TEXT("peakKB"), Kb(Peak));
			O->SetNumberField(TEXT("firstKB"), Kb(First));
			O->SetNumberField(TEXT("lastKB"), Kb(Last));
			if (bSeries)
			{
				O->SetField(TEXT("t"), NumArr(Ts));
				O->SetField(TEXT("v"), NumArr(Vs));
			}
			Items.Add(MakeShared<FJsonValueObject>(O));
		});
		Out->SetStringField(TEXT("tracker"), TrackerName);
		Out->SetArrayField(TEXT("items"), Items);
		return true;
#else
		Error = Disabled(TEXT(" LLM 内存标签"));
		return false;
#endif
	}

	// ---------- 内存分配 ----------

	bool HasAllocs(const IAnalysisSession& S)
	{
#if UELINK_TRACE_ALLOCS
		const IAllocationsProvider* AP = ReadAllocationsProvider(S);
		return AP && AP->IsInitialized();
#else
		return false;
#endif
	}

#if UELINK_TRACE_ALLOCS
namespace TraceMemoryImpl
{
	/** 分配器自己的帧（FMemory::Malloc、operator new、容器扩容……）不算「是谁分配的」，往外找第一个不是它们的 */
	bool IsAllocatorFrame(const FString& Name)
	{
		static const TCHAR* Skip[] = {
			TEXT("FMemory::"), TEXT("Malloc"), TEXT("Realloc"), TEXT("operator new"), TEXT("FMallocBinned"), TEXT("FMallocAnsi"),
			TEXT("TSizedHeapAllocator"), TEXT("TArray<"), TEXT("ResizeGrow"), TEXT("ResizeTo"), TEXT("FContainerAllocator"),
			TEXT("TSet<"), TEXT("TMap<"), TEXT("TSparseArray<"), TEXT("FString::"), TEXT("TStringBuilder"), TEXT("LLM"), TEXT("FTrackedMalloc"),
		};
		for (const TCHAR* P : Skip)
		{
			if (Name.Contains(P))
			{
				return true;
			}
		}
		return false;
	}

	/** 一个调用栈最上面几层有意义的帧：符号还没解析的写模块和地址（本机没有 PDB 时就只有这些） */
	TArray<FString> TopFrames(const TraceServices::FCallstack* Stack, int32 Max)
	{
		TArray<FString> Out;
		if (!Stack)
		{
			return Out;
		}
		const uint32 N = static_cast<uint32>(Stack->Num());
		for (uint32 i = 0; i < N && Out.Num() < Max; ++i)
		{
			const TraceServices::FStackFrame* F = Stack->Frame(i);
			if (!F)
			{
				continue;
			}
			const TCHAR* Sym = UELINK_SYMBOL_NAME(F);
			const FString Name = Sym && *Sym ? FString(Sym) : FString::Printf(TEXT("0x%llx"), static_cast<unsigned long long>(F->Addr));
			if (Out.Num() == 0 && IsAllocatorFrame(Name))
			{
				continue;
			}
			Out.Add(Name);
		}
		return Out;
	}

	FString SizeBucket(uint64 Size)
	{
		return Size < 1024 ? TEXT("<1KB") : Size < 64 * 1024 ? TEXT("1KB-64KB") : Size < 1024 * 1024 ? TEXT("64KB-1MB") : Size < 16 * 1024 * 1024 ? TEXT("1MB-16MB") : TEXT(">=16MB");
	}

	struct FGroup
	{
		uint64 Bytes = 0;
		int64 Count = 0;
		uint64 MaxBytes = 0;
		const TraceServices::FCallstack* Sample = nullptr;
	};
}
#endif

	bool QueryAllocs(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_ALLOCS
		using namespace TraceMemoryImpl;
		const IAllocationsProvider* AP = ReadAllocationsProvider(S);
		if (!AP || !AP->IsInitialized())
		{
			Error = NoData(TEXT("内存分配"), TEXT("memalloc"), TEXT("：内存分配要在 UE 启动时就开，用 -trace=default,memory 启动后再录"));
			return false;
		}
		// at：那一刻还活着的分配；from / to（t0 / t1）：这段时间里分配、到 to 还没释放的（增长、泄漏嫌疑）
		double At = -1;
		const bool bAt = A->TryGetNumberField(TEXT("at"), At) && At >= 0;
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const FString GroupBy = AgentPanel::Str(A, TEXT("groupBy"), TEXT("tag"));
		const FString Filter = AgentPanel::Str(A, TEXT("filter"));
		const int32 Top = FMath::Clamp(AgentPanel::Int(A, TEXT("top"), 30), 1, 200);
		const int32 Depth = FMath::Clamp(AgentPanel::Int(A, TEXT("depth"), 6), 1, 20);
		IAllocationsProvider::FQueryParams Params;
		Params.Rule = bAt ? UELINK_ALLOC_RULE_LIVE : UELINK_ALLOC_RULE_GROWTH;
		Params.TimeA = bAt ? At : T0;
		Params.TimeB = bAt ? At : T1;
		Params.TimeC = Params.TimeB;
		Params.TimeD = Params.TimeB;
		TMap<FString, FGroup> Groups;
		TMap<const TraceServices::FCallstack*, FGroup> ByStack;
		uint64 TotalBytes = 0;
		int64 TotalCount = 0;
		IAllocationsProvider::FQueryHandle Query = AP->StartQuery(Params);
		bool bDone = false;
		while (!bDone)
		{
			if (OverBudget())
			{
				AP->CancelQuery(Query);
				break;
			}
			const IAllocationsProvider::FQueryStatus Status = AP->PollQuery(Query);
			if (Status.Status == IAllocationsProvider::EQueryStatus::Done)
			{
				bDone = true;
			}
			else if (Status.Status == IAllocationsProvider::EQueryStatus::Available)
			{
				for (;;)
				{
					IAllocationsProvider::FQueryResult Result = Status.NextResult();
					if (!Result.IsValid())
					{
						break;
					}
					for (uint32 i = 0; i < Result->Num(); ++i)
					{
						const IAllocationsProvider::FAllocation* Alloc = Result->Get(i);
						if (!Alloc)
						{
							continue;
						}
						const uint64 Size = Alloc->GetSize();
						const TCHAR* TagName = UELINK_ALLOC_TAG_NAME(AP, Alloc);
						const FString Tag = TagName ? TagName : TEXT("?");
						if (!Filter.IsEmpty() && !Tag.Contains(Filter))
						{
							continue;
						}
						TotalBytes += Size;
						++TotalCount;
						FGroup* G = nullptr;
						if (GroupBy == TEXT("callstack"))
						{
							G = &ByStack.FindOrAdd(Alloc->GetCallstack());
						}
						else
						{
							G = &Groups.FindOrAdd(GroupBy == TEXT("size") ? SizeBucket(Size) : Tag);
						}
						G->Bytes += Size;
						++G->Count;
						G->MaxBytes = FMath::Max(G->MaxBytes, Size);
						if (!G->Sample)
						{
							G->Sample = Alloc->GetCallstack();
						}
					}
				}
			}
			else if (Status.Status == IAllocationsProvider::EQueryStatus::Unknown)
			{
				Error = TEXT("内存分配查询失败（TraceServices 返回未知状态）");
				return false;
			}
			else
			{
				FPlatformProcess::Sleep(0.002f);
			}
		}
		struct FRow
		{
			FString Key;
			FGroup G;
		};
		TArray<FRow> Rows;
		for (const TPair<FString, FGroup>& P : Groups)
		{
			Rows.Add({ P.Key, P.Value });
		}
		for (const TPair<const TraceServices::FCallstack*, FGroup>& P : ByStack)
		{
			const TArray<FString> Frames = TopFrames(P.Key, 1);
			Rows.Add({ Frames.Num() ? Frames[0] : FString(TEXT("(没有调用栈)")), P.Value });
		}
		Rows.Sort([](const FRow& X, const FRow& Y) { return X.G.Bytes > Y.G.Bytes; });
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 i = 0; i < Rows.Num() && i < Top; ++i)
		{
			const FRow& R = Rows[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("key"), R.Key);
			O->SetNumberField(TEXT("kb"), Kb(static_cast<double>(R.G.Bytes)));
			O->SetNumberField(TEXT("count"), static_cast<double>(R.G.Count));
			O->SetNumberField(TEXT("maxKB"), Kb(static_cast<double>(R.G.MaxBytes)));
			// 每组带一个调用栈样本（最上面几层有意义的帧），Agent 据此找到代码
			const TArray<FString> Frames = TopFrames(R.G.Sample, Depth);
			if (Frames.Num())
			{
				O->SetField(TEXT("stack"), Strs(Frames));
			}
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetStringField(TEXT("mode"), bAt ? TEXT("live") : TEXT("growth"));
		Out->SetStringField(TEXT("groupBy"), GroupBy);
		Out->SetNumberField(TEXT("totalKB"), Kb(static_cast<double>(TotalBytes)));
		Out->SetNumberField(TEXT("totalCount"), static_cast<double>(TotalCount));
		Out->SetNumberField(TEXT("groups"), Rows.Num());
		Out->SetArrayField(TEXT("items"), Items);
		if (!bDone)
		{
			Out->SetBoolField(TEXT("partial"), true);
		}
		return true;
#else
		Error = Disabled(TEXT("内存分配"));
		return false;
#endif
	}
}
