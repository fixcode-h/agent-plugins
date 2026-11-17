// trace.query 里和 Lua 有关的查询（Lua 性能分析 Insights 化设计稿 9.2，2.9.0 起）：
// - luainfo：这份 trace 里所有 Lua 计时器的文件和行号（UELink 录制时按 9.1 注册：Lua 函数的文件是 .lua，C 函数是 <lua:C>）；
// - timers：计时器表（从 AgentPanelTrace.cpp 挪过来），加 lua（只要 Lua 计时器）、mergeC（C 函数的时间并进调用它的函数）；
// - tree：自上而下的调用树，面板的火焰图用，UE 和 Lua 的计时器都能看。
// 会话由 AgentPanelTrace.cpp 的 trace.query 统一取（录制中跟着文件读的那一套），这里只拿分析好的 provider 来算。
// 和 AgentPanelTrace.cpp 一样：TraceServices 的类型写全名，using namespace TraceServices 只放在具名命名空间 UELinkTrace 里（单体构建）。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/TimingProfiler.h"

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
// 只在这个命名空间里 using（单体构建时不漏到别的文件）
using AgentPanel::Int;
using AgentPanel::Str;

namespace
{
	bool Flag(const TSharedPtr<FJsonObject>& A, const TCHAR* Key)
	{
		bool B = false;
		return A->TryGetBoolField(Key, B) && B;
	}

	/**
	 * mergeC：C 函数（UE.*、lua.*）不单列，它的独占时间算进调用它的那一块的独占时间。
	 * Walk 按块结束的顺序回调（子块先于父块），按深度攒「这一层的 C 子块要还给父块的时间」，父块结束时取走。
	 * C 函数里又回调进 Lua 的那部分照样算那些 Lua 块自己的，不重复算进父块。
	 */
	struct FMergeC
	{
		TArray<double> Back;

		/** 取走（并清零）深度 Depth 上攒的时间：Depth - 1 那一块的 C 子块 */
		double Take(int32 Depth)
		{
			if (!Back.IsValidIndex(Depth))
			{
				return 0.0;
			}
			const double V = Back[Depth];
			Back[Depth] = 0.0;
			return V;
		}

		void Give(int32 Depth, double V)
		{
			if (Back.Num() <= Depth)
			{
				Back.SetNumZeroed(Depth + 1);
			}
			Back[Depth] += V;
		}
	};

	void AddLuaFields(const FTimers& Timers, uint32 Id, int32 Kind, const TSharedPtr<FJsonObject>& O)
	{
		O->SetStringField(TEXT("file"), Timers.File(Id));
		O->SetNumberField(TEXT("line"), Timers.Line(Id));
		if (Kind == 2)
		{
			O->SetBoolField(TEXT("c"), true);
		}
	}
}

	bool HasLuaTimers(const ITimingProfilerProvider& TP)
	{
		FTimers Timers(TP);
		const uint32 N = Timers.Reader ? UELINK_TIMER_COUNT(Timers.Reader) : 0;
		for (uint32 Id = 0; Id < N; ++Id)
		{
			if (Timers.LuaKind(Id) != 0)
			{
				return true;
			}
		}
		return false;
	}

	void QueryLuaInfo(const ITimingProfilerProvider& TP, TSharedPtr<FJsonObject>& Out)
	{
		FTimers Timers(TP);
		TSharedPtr<FJsonObject> Map = MakeShared<FJsonObject>();
		const uint32 N = Timers.Reader ? UELINK_TIMER_COUNT(Timers.Reader) : 0;
		int32 Count = 0;
		for (uint32 Id = 0; Id < N; ++Id)
		{
			const int32 Kind = Timers.LuaKind(Id);
			if (Kind == 0)
			{
				continue;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			AddLuaFields(Timers, Id, Kind, O);
			Map->SetObjectField(FString::FromInt(static_cast<int32>(Id)), O);
			++Count;
		}
		Out->SetBoolField(TEXT("lua"), Count > 0);
		Out->SetObjectField(TEXT("timers"), Map);
	}

	void QueryTimers(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out)
	{
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const FString Filter = Str(A, TEXT("filter"));
		const int32 Top = FMath::Clamp(Int(A, TEXT("top"), 200), 1, 2000);
		const bool bLuaOnly = Flag(A, TEXT("lua"));
		const bool bMergeC = Flag(A, TEXT("mergeC"));
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = AllLanes(S, TP);
		}
		FTimers Timers(TP);
		TMap<uint32, FAgg> Agg;
		for (int32 Lane : Want)
		{
			FMergeC Merge;
			Walk(TP, Timers, Lane, T0, T1, [&](double Start, double End, int32 Depth, uint32 Timer, double Child, const TArray<FOpen>& Parents)
			{
				// mergeC 的账要在范围裁剪之前记：范围外的子块也是父块独占时间的一部分
				const double Back = bMergeC ? Merge.Take(Depth + 1) : 0.0;
				const double Full = End - Start;
				const double Self = FMath::Max(0.0, Full - Child + Back);
				const int32 Kind = bLuaOnly || bMergeC ? Timers.LuaKind(Timer) : 0;
				if (bMergeC && Kind == 2)
				{
					Merge.Give(Depth, Self);
					return;
				}
				// 只算落在范围内的那部分
				const double S0 = FMath::Max(Start, T0);
				const double S1 = FMath::Min(End, T1);
				if (S1 <= S0 || (bLuaOnly && Kind == 0))
				{
					return;
				}
				FAgg& G = Agg.FindOrAdd(Timer);
				G.bGpu |= Lane == GpuLane;
				++G.Count;
				// 同一个计时器递归套自己时，包含时间只算最外层，免得翻倍（和 Insights 一致）
				bool bNested = false;
				for (const FOpen& P : Parents)
				{
					bNested |= P.Timer == Timer;
				}
				const double Dur = S1 - S0;
				if (!bNested)
				{
					G.Incl += Dur;
				}
				G.InclMax = FMath::Max(G.InclMax, Full);
				// 独占时间按落在范围内的比例折算
				G.Excl += Self * (Dur / FMath::Max(Full, 1e-12));
			});
		}
		struct FRow
		{
			uint32 Id;
			FString Name;
			FAgg G;
		};
		TArray<FRow> Rows;
		for (const TPair<uint32, FAgg>& P : Agg)
		{
			FString Name = Timers.Name(P.Key);
			if (!Filter.IsEmpty() && !Name.Contains(Filter))
			{
				continue;
			}
			Rows.Add({ P.Key, MoveTemp(Name), P.Value });
		}
		const FString Sort = Str(A, TEXT("sort"), TEXT("excl"));
		Rows.Sort([&](const FRow& X, const FRow& Y)
		{
			if (Sort == TEXT("incl")) return X.G.Incl > Y.G.Incl;
			if (Sort == TEXT("count")) return X.G.Count > Y.G.Count;
			if (Sort == TEXT("max")) return X.G.InclMax > Y.G.InclMax;
			return X.G.Excl > Y.G.Excl;
		});
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 i = 0; i < Rows.Num() && i < Top; ++i)
		{
			const FRow& R = Rows[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetNumberField(TEXT("id"), R.Id);
			O->SetStringField(TEXT("name"), R.Name);
			O->SetNumberField(TEXT("count"), static_cast<double>(R.G.Count));
			O->SetNumberField(TEXT("incl"), Ms(R.G.Incl));
			O->SetNumberField(TEXT("inclMax"), Ms(R.G.InclMax));
			O->SetNumberField(TEXT("excl"), Ms(R.G.Excl));
			if (R.G.bGpu)
			{
				O->SetBoolField(TEXT("gpu"), true);
			}
			// 2.9.0：Lua 计时器带来源（面板「来源」列、点开 .lua）
			const int32 Kind = Timers.LuaKind(R.Id);
			if (Kind != 0)
			{
				AddLuaFields(Timers, R.Id, Kind, O);
			}
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Rows.Num());
		Out->SetNumberField(TEXT("seconds"), T1 - T0);
	}

	/**
	 * 自上而下的调用树（火焰图）：范围内每一块按「从起点到自己」的计时器路径合并，多条泳道合在一棵树里。
	 * 起点：给了 root 是它最外层的那次（和 butterfly 的被调用者一致）；luaOnly 是最外层的 Lua 计时器（跳过上面的 UE 作用域）；
	 * 都没给是泳道的根。根节点是虚的（id -1、「全部」），下面挂各个起点。
	 */
	bool QueryTree(const IAnalysisSession& S, const ITimingProfilerProvider& TP, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		if (T1 <= T0)
		{
			Error = TEXT("t1 要大于 t0（秒，trace 里的时间）");
			return false;
		}
		double RootNum = -1;
		const bool bRoot = A->TryGetNumberField(TEXT("root"), RootNum) && RootNum >= 0;
		const uint32 RootId = bRoot ? static_cast<uint32>(RootNum) : 0;
		const bool bLuaOnly = !bRoot && Flag(A, TEXT("luaOnly"));
		const bool bMergeC = Flag(A, TEXT("mergeC"));
		TArray<int32> Want = Lanes(A);
		if (Want.Num() == 0)
		{
			Want = AllLanes(S, TP);
		}
		FTimers Timers(TP);
		FNode Root;
		for (int32 Lane : Want)
		{
			FMergeC Merge;
			Walk(TP, Timers, Lane, T0, T1, [&](double Start, double End, int32 Depth, uint32 Timer, double Child, const TArray<FOpen>& Parents)
			{
				const double Back = bMergeC ? Merge.Take(Depth + 1) : 0.0;
				const double Full = End - Start;
				const double Self = FMath::Max(0.0, Full - Child + Back);
				if (bMergeC && Timers.LuaKind(Timer) == 2)
				{
					Merge.Give(Depth, Self);
					return;
				}
				const double S0 = FMath::Max(Start, T0);
				const double S1 = FMath::Min(End, T1);
				if (S1 <= S0)
				{
					return;
				}
				// 路径从 Parents[From] 开始；From == Parents.Num() 表示自己就是起点
				int32 From = 0;
				if (bRoot || bLuaOnly)
				{
					int32 Outer = INDEX_NONE;
					for (int32 i = 0; i < Parents.Num(); ++i)
					{
						if (bRoot ? Parents[i].Timer == RootId : Timers.LuaKind(Parents[i].Timer) != 0)
						{
							Outer = i;
							break;
						}
					}
					if (Outer == INDEX_NONE)
					{
						const bool bStart = bRoot ? Timer == RootId : Timers.LuaKind(Timer) != 0;
						if (!bStart)
						{
							return;
						}
						From = Parents.Num();
					}
					else
					{
						From = Outer;
					}
				}
				FNode* N = &Root;
				for (int32 i = From; i < Parents.Num(); ++i)
				{
					if (bMergeC && Timers.LuaKind(Parents[i].Timer) == 2)
					{
						continue;
					}
					N = &N->Kid(Parents[i].Timer);
				}
				const bool bTop = N == &Root;
				N = &N->Kid(Timer);
				const double Dur = S1 - S0;
				++N->Count;
				N->Incl += Dur;
				N->Excl += Self * (Dur / FMath::Max(Full, 1e-12));
				if (bTop)
				{
					++Root.Count;
					Root.Incl += Dur;
				}
			});
		}
		// 虚根自己拼：TreeJson 会按 id 查计时器名字，-1 不是计时器
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetNumberField(TEXT("id"), -1);
		O->SetStringField(TEXT("name"), TEXT("全部"));
		O->SetNumberField(TEXT("count"), static_cast<double>(Root.Count));
		O->SetNumberField(TEXT("incl"), Ms(Root.Incl));
		O->SetNumberField(TEXT("excl"), 0);
		TArray<TPair<uint32, const FNode*>> Sorted;
		for (const TPair<uint32, TUniquePtr<FNode>>& P : Root.Kids)
		{
			Sorted.Add({ P.Key, P.Value.Get() });
		}
		Sorted.Sort([](const TPair<uint32, const FNode*>& X, const TPair<uint32, const FNode*>& Y) { return X.Value->Incl > Y.Value->Incl; });
		TArray<TSharedPtr<FJsonValue>> Kids;
		for (int32 i = 0; i < Sorted.Num() && i < TreeMaxKids; ++i)
		{
			Kids.Add(MakeShared<FJsonValueObject>(TreeJson(Sorted[i].Key, *Sorted[i].Value, Timers, 1)));
		}
		O->SetArrayField(TEXT("children"), Kids);
		if (Sorted.Num() > TreeMaxKids)
		{
			O->SetNumberField(TEXT("more"), Sorted.Num() - TreeMaxKids);
		}
		Out->SetObjectField(TEXT("root"), O);
		return true;
	}
} // namespace UELinkTrace
