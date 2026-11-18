// trace.query 的加载和文件两类（2.11，面板「UE 性能分析 MCP 接口」设计稿 3 节）：
// - loads：包加载（loadtime / assetloadtime 通道）——最慢 / 最大的包（主线程 + 异步加载线程的时间、序列化大小），以及按对象类型聚合；
// - files：文件读写（file 通道）——最慢 / 最大的读写，以及按文件聚合。
// 都是 TraceServices 现成的表（ITable），这里只读、排序、截前 top 条。和其他查询一样在后台线程、会话读锁里跑。
// 引擎版本差异只在 UELinkCompat.h 的宏里；哪类编不过就把对应的 UELINK_TRACE_* 改成 0。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/TimingProfiler.h"
#if UELINK_TRACE_LOADS || UELINK_TRACE_FILES
#include "TraceServices/Containers/Tables.h"
#endif
#if UELINK_TRACE_LOADS
#include "TraceServices/Model/LoadTimeProfiler.h"
#endif
#if UELINK_TRACE_FILES
#include "TraceServices/Model/FileActivity.h"
#endif

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
namespace TraceLoadImpl
{
	double Kb(double Bytes)
	{
		return Fin(FMath::RoundToDouble(Bytes / 102.4) / 10.0);
	}

#if UELINK_TRACE_LOADS || UELINK_TRACE_FILES
	/** 读完一张表的每一行（表和读取器都由调用方释放：TraceServices 的 Create* 返回的是新建的对象） */
	template <typename RowType, typename FnType>
	void EachRow(const TraceServices::ITable<RowType>& Table, FnType&& Fn)
	{
		TUniquePtr<TraceServices::ITableReader<RowType>> Reader(Table.CreateReader());
		if (!Reader.IsValid())
		{
			return;
		}
		while (Reader->IsValid() && !OverBudget())
		{
			if (const RowType* Row = Reader->GetCurrentRow())
			{
				Fn(*Row);
			}
			Reader->NextRow();
		}
	}
#endif
}

	// ---------- 包加载 ----------

	bool HasLoads(const IAnalysisSession& S)
	{
#if UELINK_TRACE_LOADS
		const ILoadTimeProfilerProvider* LP = ReadLoadTimeProfilerProvider(S);
		if (!LP)
		{
			return false;
		}
		TUniquePtr<TraceServices::ITable<TraceServices::FPackagesTableRow>> Table(LP->CreatePackageDetailsTable(0, S.GetDurationSeconds()));
		return Table.IsValid() && Table->GetRowCount() > 0;
#else
		return false;
#endif
	}

	bool QueryLoads(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_LOADS
		using namespace TraceLoadImpl;
		const ILoadTimeProfilerProvider* LP = ReadLoadTimeProfilerProvider(S);
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		TUniquePtr<TraceServices::ITable<TraceServices::FPackagesTableRow>> Packages(LP ? LP->CreatePackageDetailsTable(T0, T1) : nullptr);
		if (!Packages.IsValid() || Packages->GetRowCount() == 0)
		{
			Error = NoData(TEXT("包加载"), TEXT("loadtime,assetloadtime"), TEXT("（或用 preset=loading）"));
			return false;
		}
		const bool bBySize = AgentPanel::Str(A, TEXT("sort")) == TEXT("size");
		const FString Filter = AgentPanel::Str(A, TEXT("filter"));
		const int32 Top = FMath::Clamp(AgentPanel::Int(A, TEXT("top"), 30), 1, 200);
		struct FRow
		{
			FString Name;
			double Main;
			double Async;
			double Bytes;
			int32 Exports;
		};
		TArray<FRow> Rows;
		double MainSum = 0;
		double AsyncSum = 0;
		EachRow(*Packages, [&](const TraceServices::FPackagesTableRow& R)
		{
			const FString Name = R.PackageInfo && R.PackageInfo->Name ? R.PackageInfo->Name : TEXT("?");
			if (!Filter.IsEmpty() && !Name.Contains(Filter))
			{
				return;
			}
			MainSum += R.MainThreadTime;
			AsyncSum += R.AsyncLoadingThreadTime;
			Rows.Add({ Name, R.MainThreadTime, R.AsyncLoadingThreadTime, static_cast<double>(R.SerializedHeaderSize + R.SerializedExportsSize), static_cast<int32>(R.SerializedExportsCount) });
		});
		Rows.Sort([bBySize](const FRow& X, const FRow& Y) { return bBySize ? X.Bytes > Y.Bytes : (X.Main + X.Async) > (Y.Main + Y.Async); });
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 i = 0; i < Rows.Num() && i < Top; ++i)
		{
			const FRow& R = Rows[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("package"), R.Name);
			O->SetNumberField(TEXT("mainMs"), Ms(R.Main));
			O->SetNumberField(TEXT("asyncMs"), Ms(R.Async));
			O->SetNumberField(TEXT("kb"), Kb(R.Bytes));
			O->SetNumberField(TEXT("exports"), R.Exports);
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		// 按对象类型聚合：哪一类资源（贴图、蓝图类、材质……）加载最花时间
		TArray<TSharedPtr<FJsonValue>> Types;
		TUniquePtr<TraceServices::ITable<TraceServices::FLoadTimeProfilerAggregatedStats>> Agg(LP->CreateObjectTypeAggregation(T0, T1));
		if (Agg.IsValid())
		{
			struct FType
			{
				FString Name;
				double Total;
				uint64 Count;
				double Max;
			};
			TArray<FType> All;
			EachRow(*Agg, [&](const TraceServices::FLoadTimeProfilerAggregatedStats& R)
			{
				All.Add({ R.Name ? FString(R.Name) : FString(TEXT("?")), R.Total, R.Count, R.Max });
			});
			All.Sort([](const FType& X, const FType& Y) { return X.Total > Y.Total; });
			for (int32 i = 0; i < All.Num() && i < 15; ++i)
			{
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("type"), All[i].Name);
				O->SetNumberField(TEXT("totalMs"), Ms(All[i].Total));
				O->SetNumberField(TEXT("count"), static_cast<double>(All[i].Count));
				O->SetNumberField(TEXT("maxMs"), Ms(All[i].Max));
				Types.Add(MakeShared<FJsonValueObject>(O));
			}
		}
		Out->SetNumberField(TEXT("packages"), Rows.Num());
		Out->SetNumberField(TEXT("mainMs"), Ms(MainSum));
		Out->SetNumberField(TEXT("asyncMs"), Ms(AsyncSum));
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetArrayField(TEXT("types"), Types);
		return true;
#else
		Error = Disabled(TEXT("包加载"));
		return false;
#endif
	}

	// ---------- 文件读写 ----------

	bool HasFiles(const IAnalysisSession& S)
	{
#if UELINK_TRACE_FILES
		const IFileActivityProvider* FP = ReadFileActivityProvider(S);
		return FP && FP->GetFileActivityTable().GetRowCount() > 0;
#else
		return false;
#endif
	}

	bool QueryFiles(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_FILES
		using namespace TraceLoadImpl;
		const IFileActivityProvider* FP = ReadFileActivityProvider(S);
		if (!FP || FP->GetFileActivityTable().GetRowCount() == 0)
		{
			Error = NoData(TEXT("文件读写"), TEXT("file"), TEXT("（或用 preset=loading）"));
			return false;
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const bool bBySize = AgentPanel::Str(A, TEXT("sort")) == TEXT("size");
		const FString Filter = AgentPanel::Str(A, TEXT("filter"));
		const int32 Top = FMath::Clamp(AgentPanel::Int(A, TEXT("top"), 30), 1, 200);
		struct FOp
		{
			FString Path;
			double Start;
			double Dur;
			uint64 Bytes;
			int32 Type;
			bool bFailed;
		};
		struct FFile
		{
			double Dur = 0;
			uint64 Bytes = 0;
			int32 Ops = 0;
		};
		TArray<FOp> Ops;
		TMap<FString, FFile> Files;
		EachRow(FP->GetFileActivityTable(), [&](const TraceServices::FFileActivity& R)
		{
			if (R.EndTime < T0 || R.StartTime > T1)
			{
				return;
			}
			const FString Path = R.File && R.File->Path ? R.File->Path : TEXT("?");
			if (!Filter.IsEmpty() && !Path.Contains(Filter))
			{
				return;
			}
			const double Dur = FMath::IsFinite(R.EndTime) ? R.EndTime - R.StartTime : 0.0;
			Ops.Add({ Path, R.StartTime, Dur, R.Size, static_cast<int32>(R.ActivityType), R.Failed });
			FFile& F = Files.FindOrAdd(Path);
			F.Dur += Dur;
			F.Bytes += R.Size;
			++F.Ops;
		});
		Ops.Sort([bBySize](const FOp& X, const FOp& Y) { return bBySize ? X.Bytes > Y.Bytes : X.Dur > Y.Dur; });
		static const TCHAR* TypeNames[] = { TEXT("open"), TEXT("reopen"), TEXT("close"), TEXT("read"), TEXT("write") };
		TArray<TSharedPtr<FJsonValue>> Items;
		for (int32 i = 0; i < Ops.Num() && i < Top; ++i)
		{
			const FOp& R = Ops[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("path"), R.Path);
			O->SetStringField(TEXT("op"), R.Type >= 0 && R.Type < 5 ? TypeNames[R.Type] : TEXT("other"));
			O->SetNumberField(TEXT("start"), Fin(R.Start));
			O->SetNumberField(TEXT("ms"), Ms(R.Dur));
			O->SetNumberField(TEXT("kb"), Kb(static_cast<double>(R.Bytes)));
			if (R.bFailed)
			{
				O->SetBoolField(TEXT("failed"), true);
			}
			Items.Add(MakeShared<FJsonValueObject>(O));
		}
		TArray<TPair<FString, FFile>> ByFile;
		for (const TPair<FString, FFile>& P : Files)
		{
			ByFile.Add(P);
		}
		ByFile.Sort([](const TPair<FString, FFile>& X, const TPair<FString, FFile>& Y) { return X.Value.Dur > Y.Value.Dur; });
		TArray<TSharedPtr<FJsonValue>> FileItems;
		for (int32 i = 0; i < ByFile.Num() && i < 15; ++i)
		{
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("path"), ByFile[i].Key);
			O->SetNumberField(TEXT("ms"), Ms(ByFile[i].Value.Dur));
			O->SetNumberField(TEXT("kb"), Kb(static_cast<double>(ByFile[i].Value.Bytes)));
			O->SetNumberField(TEXT("ops"), ByFile[i].Value.Ops);
			FileItems.Add(MakeShared<FJsonValueObject>(O));
		}
		Out->SetNumberField(TEXT("ops"), Ops.Num());
		Out->SetNumberField(TEXT("files"), Files.Num());
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetArrayField(TEXT("byFile"), FileItems);
		return true;
#else
		Error = Disabled(TEXT("文件读写"));
		return false;
#endif
	}
}
