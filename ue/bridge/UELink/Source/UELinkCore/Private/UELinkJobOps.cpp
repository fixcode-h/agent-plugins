// 长操作变作业（2.13.0，协议文档「作业」一节）：
//   job.start {op, args} 或 {steps: [{op, args}], title?, stopOnError?: true}   马上回 {job: 作业号, ...摘要}
//   job.get {id?}                                                           不给 id 列最近的作业；给了回摘要和每步结果
//   job.wait {id, timeoutMs?: 20000}                                        做完或超时（最多 60 秒）才回，内容同 job.get
//   job.stop {id}                                                           取消还没做的步骤（正在做的那一步做完才停）
// 每一步就是一个已登记的同步操作（bp.compile、asset.rename……），经 CallOp 调，参数和返回字段和直接调时一样。
// 一帧里做到 30 毫秒为止（一步本身可能就超过，所以至少做一步），作业按先后排队，同一时间只跑一个。
// 状态变化推 uelink.job 事件（phase: started / progress / finished），做完把全部结果写进 Saved/UELink/jobs/<作业号>.json。
#include "UELinkJobOps.h"
#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"

#include "Containers/Ticker.h"
#include "CoreGlobals.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformTime.h"
#include "Misc/DateTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/GarbageCollection.h"

namespace AgentPanel
{
	// 不用匿名命名空间：单体编译时和别的文件的同名小函数会撞
	namespace JobOps
	{
		constexpr int32 MaxSteps = 500;
		/** 内存里留几个已经结束的作业：客户端只关心最近的 */
		constexpr int32 MaxKept = 20;
		/** Saved/UELink/jobs 下最多留几份结果文件 */
		constexpr int32 MaxReports = 50;
		constexpr double FrameBudgetMs = 30.0;
		constexpr int32 DefaultWaitMs = 20000;
		constexpr int32 MaxWaitMs = 60000;
		/** job.get / job.wait 回包里各步结果合计最多多少字（读结构的上限），超出的只在结果文件里 */
		constexpr int32 ResultBudget = 12000;

		struct FStep
		{
			FString Op;
			TSharedPtr<FJsonObject> Args;
			bool bDone = false;
			bool bOk = false;
			FString Error;
			TSharedPtr<FJsonObject> Result;
			double Ms = 0;
		};

		struct FWaiter
		{
			FAgentPanelReply Reply;
			double Deadline = 0;
		};

		struct FJob
		{
			FString Id;
			FString Title;
			TArray<FStep> Steps;
			int32 Next = 0;
			bool bStopOnError = true;
			/** queued / running / done / failed / cancelled */
			FString Status = TEXT("queued");
			FDateTime StartedAt;
			FDateTime EndedAt;
			FString Report;
			TArray<FWaiter> Waiters;

			bool IsFinished() const { return Status == TEXT("done") || Status == TEXT("failed") || Status == TEXT("cancelled"); }
		};

		struct FState
		{
			TArray<TSharedPtr<FJob>> Jobs;
			int32 Serial = 0;
			FTSTicker::FDelegateHandle Tick;
			bool bInTick = false;
		};

		FState& State()
		{
			static FState S;
			return S;
		}

		FString ToText(const TSharedRef<FJsonObject>& O)
		{
			FString S;
			const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> W = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&S);
			FJsonSerializer::Serialize(O, W);
			return S;
		}

		int32 CountDone(const FJob& Job, bool bOnlyFailed)
		{
			int32 N = 0;
			for (const FStep& St : Job.Steps)
			{
				N += St.bDone && (!bOnlyFailed || !St.bOk) ? 1 : 0;
			}
			return N;
		}

		TSharedRef<FJsonObject> Summary(const FJob& Job)
		{
			const TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("id"), Job.Id);
			O->SetStringField(TEXT("title"), Job.Title);
			O->SetStringField(TEXT("status"), Job.Status);
			O->SetNumberField(TEXT("total"), Job.Steps.Num());
			const int32 Done = CountDone(Job, false);
			O->SetNumberField(TEXT("finished"), Done);
			O->SetNumberField(TEXT("failed"), CountDone(Job, true));
			if (Job.IsFinished())
			{
				// 出错停下或取消时没做的步数
				O->SetNumberField(TEXT("skipped"), Job.Steps.Num() - Done);
				O->SetStringField(TEXT("endedAt"), Job.EndedAt.ToIso8601());
				O->SetNumberField(TEXT("ms"), (Job.EndedAt - Job.StartedAt).GetTotalMilliseconds());
			}
			else if (Job.Steps.IsValidIndex(Job.Next))
			{
				O->SetStringField(TEXT("current"), Job.Steps[Job.Next].Op);
			}
			O->SetStringField(TEXT("startedAt"), Job.StartedAt.ToIso8601());
			return O;
		}

		TSharedRef<FJsonObject> StepJson(const FStep& St, bool bWithResult)
		{
			const TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("op"), St.Op);
			O->SetStringField(TEXT("state"), !St.bDone ? TEXT("skipped") : St.bOk ? TEXT("ok") : TEXT("failed"));
			if (!St.Error.IsEmpty())
			{
				O->SetStringField(TEXT("error"), St.Error);
			}
			if (St.bDone)
			{
				O->SetNumberField(TEXT("ms"), St.Ms);
			}
			if (bWithResult && St.Result.IsValid())
			{
				O->SetObjectField(TEXT("result"), St.Result);
			}
			return O;
		}

		/**
		 * job.get / job.wait 的回包：摘要 + 每步结果（合计不超过 ResultBudget 字，超出的只给状态并标 truncated，全量看 report 文件）。
		 * 只有一步的作业把这一步的 result / error 提到顶层，客户端拿到的和直接调这个操作一样
		 */
		TSharedRef<FJsonObject> Describe(const FJob& Job)
		{
			const TSharedRef<FJsonObject> O = Summary(Job);
			TArray<TSharedPtr<FJsonValue>> Steps;
			int32 Used = 0;
			bool bTruncated = false;
			for (const FStep& St : Job.Steps)
			{
				TSharedRef<FJsonObject> One = StepJson(St, true);
				const int32 Len = ToText(One).Len();
				if (Used + Len > ResultBudget && St.Result.IsValid())
				{
					One = StepJson(St, false);
					bTruncated = true;
				}
				else
				{
					Used += Len;
				}
				Steps.Add(MakeShared<FJsonValueObject>(One));
			}
			if (Job.Steps.Num() == 1)
			{
				const FStep& St = Job.Steps[0];
				if (St.Result.IsValid() && St.bOk)
				{
					O->SetObjectField(TEXT("result"), St.Result);
				}
				if (!St.Error.IsEmpty())
				{
					O->SetStringField(TEXT("error"), St.Error);
				}
			}
			else
			{
				O->SetArrayField(TEXT("steps"), Steps);
			}
			if (bTruncated)
			{
				O->SetBoolField(TEXT("truncated"), true);
			}
			if (!Job.Report.IsEmpty())
			{
				O->SetStringField(TEXT("report"), Job.Report);
			}
			return O;
		}

		void Publish(const FJob& Job, const TCHAR* Phase)
		{
			const TSharedRef<FJsonObject> Event = Summary(Job);
			Event->SetStringField(TEXT("phase"), Phase);
			FAgentPanelBridge::Get().PublishEvent(TEXT("uelink.job"), Event);
		}

		/** 全部结果写进 Saved/UELink/jobs/<作业号>.json，只留最近 MaxReports 份 */
		void WriteReport(FJob& Job)
		{
			const FString Dir = FPaths::Combine(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()), TEXT("UELink"), TEXT("jobs"));
			const TSharedRef<FJsonObject> O = Summary(Job);
			TArray<TSharedPtr<FJsonValue>> Steps;
			for (const FStep& St : Job.Steps)
			{
				const TSharedRef<FJsonObject> One = StepJson(St, true);
				if (St.Args.IsValid())
				{
					One->SetObjectField(TEXT("args"), St.Args);
				}
				Steps.Add(MakeShared<FJsonValueObject>(One));
			}
			O->SetArrayField(TEXT("steps"), Steps);
			const FString File = FPaths::Combine(Dir, Job.Id + TEXT(".json"));
			if (!FFileHelper::SaveStringToFile(ToText(O), *File, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
			{
				return;
			}
			Job.Report = File;
			TArray<FString> Files;
			IFileManager::Get().FindFiles(Files, *FPaths::Combine(Dir, TEXT("*.json")), true, false);
			if (Files.Num() <= MaxReports)
			{
				return;
			}
			Files.Sort([&Dir](const FString& L, const FString& R) { return IFileManager::Get().GetTimeStamp(*FPaths::Combine(Dir, L)) < IFileManager::Get().GetTimeStamp(*FPaths::Combine(Dir, R)); });
			for (int32 i = 0; i < Files.Num() - MaxReports; ++i)
			{
				IFileManager::Get().Delete(*FPaths::Combine(Dir, Files[i]), false, false, true);
			}
		}

		void ReplyAll(FJob& Job)
		{
			TArray<FWaiter> Waiters = MoveTemp(Job.Waiters);
			Job.Waiters.Reset();
			for (FWaiter& W : Waiters)
			{
				W.Reply(true, Describe(Job), FString());
			}
		}

		void Finish(FJob& Job, const FString& Status)
		{
			Job.Status = Status;
			Job.EndedAt = FDateTime::UtcNow();
			WriteReport(Job);
			Publish(Job, TEXT("finished"));
			ReplyAll(Job);
		}

		void RunStep(FJob& Job)
		{
			FStep& St = Job.Steps[Job.Next];
			const double T0 = FPlatformTime::Seconds();
			TSharedPtr<FJsonObject> Out;
			FString Err;
			St.bOk = FAgentPanelBridge::Get().CallOp(St.Op, St.Args, Out, Err);
			St.Result = Out;
			St.Error = St.bOk ? FString() : Err;
			St.Ms = (FPlatformTime::Seconds() - T0) * 1000.0;
			St.bDone = true;
			++Job.Next;
			// 出错停下：后面的步骤不做了，算 skipped
			if (!St.bOk && Job.bStopOnError)
			{
				Job.Next = Job.Steps.Num();
			}
		}

		TSharedPtr<FJob> FindJob(const FString& Id)
		{
			for (const TSharedPtr<FJob>& J : State().Jobs)
			{
				if (J->Id == Id)
				{
					return J;
				}
			}
			return nullptr;
		}

		bool Tick(float)
		{
			FState& S = State();
			// 一步里可能弹进度框、加载资源，引擎在这期间又驱动 ticker 时不要重入；回收垃圾时对象随时会被销毁
			if (S.bInTick || IsGarbageCollecting())
			{
				return true;
			}
			TGuardValue<bool> Guard(S.bInTick, true);
			if (IsEngineExitRequested())
			{
				for (const TSharedPtr<FJob>& J : S.Jobs)
				{
					if (!J->IsFinished())
					{
						J->Status = TEXT("cancelled");
						J->EndedAt = FDateTime::UtcNow();
						J->Waiters.Reset();
					}
				}
				S.Tick.Reset();
				return false;
			}
			TSharedPtr<FJob> Job;
			for (const TSharedPtr<FJob>& J : S.Jobs)
			{
				if (!J->IsFinished())
				{
					Job = J;
					break;
				}
			}
			if (Job.IsValid())
			{
				if (Job->Status == TEXT("queued"))
				{
					Job->Status = TEXT("running");
					Job->StartedAt = FDateTime::UtcNow();
					Publish(*Job, TEXT("started"));
				}
				const double T0 = FPlatformTime::Seconds();
				do
				{
					RunStep(*Job);
				}
				// 一步里引擎可能又处理了 HTTP 请求（job.stop）：已经被取消就不再往下做
				while (!Job->IsFinished() && Job->Next < Job->Steps.Num() && (FPlatformTime::Seconds() - T0) * 1000.0 < FrameBudgetMs);
				if (!Job->IsFinished())
				{
					if (Job->Next >= Job->Steps.Num())
					{
						Finish(*Job, CountDone(*Job, true) > 0 ? TEXT("failed") : TEXT("done"));
					}
					else
					{
						Publish(*Job, TEXT("progress"));
					}
				}
			}
			// 等到点的等待者：回当前状态（还在跑），客户端再调一次 job.wait 接着等
			const double Now = FPlatformTime::Seconds();
			bool bAny = false;
			for (const TSharedPtr<FJob>& J : S.Jobs)
			{
				if (J->IsFinished())
				{
					continue;
				}
				bAny = true;
				for (int32 i = J->Waiters.Num() - 1; i >= 0; --i)
				{
					if (J->Waiters[i].Deadline <= Now)
					{
						FAgentPanelReply Reply = MoveTemp(J->Waiters[i].Reply);
						J->Waiters.RemoveAt(i);
						Reply(true, Describe(*J), FString());
					}
				}
			}
			if (!bAny)
			{
				S.Tick.Reset();
				return false;
			}
			return true;
		}

		void EnsureTicking()
		{
			FState& S = State();
			if (!S.Tick.IsValid())
			{
				S.Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.0f);
			}
		}

		/** 一步：{op, args}；作业里不能再套 job.*（会自己等自己） */
		bool ParseStep(const TSharedPtr<FJsonObject>& O, FStep& St, FString& Error)
		{
			St.Op = Str(O, TEXT("op"));
			if (St.Op.IsEmpty())
			{
				Error = TEXT("每一步都要给 op（操作名）");
				return false;
			}
			if (St.Op.StartsWith(TEXT("job.")))
			{
				Error = TEXT("作业里不能再调 job.* 操作");
				return false;
			}
			if (!FAgentPanelBridge::Get().HasOp(St.Op))
			{
				Error = FString::Printf(TEXT("这个进程不支持 %s，不能放进作业（只能放同步操作）"), *St.Op);
				return false;
			}
			const TSharedPtr<FJsonObject>* ArgsPtr = nullptr;
			St.Args = O.IsValid() && O->TryGetObjectField(TEXT("args"), ArgsPtr) && ArgsPtr ? *ArgsPtr : MakeShared<FJsonObject>();
			return true;
		}

		bool StartJob(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const TSharedPtr<FJob> Job = MakeShared<FJob>();
			const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
			if (A->TryGetArrayField(TEXT("steps"), Arr) && Arr)
			{
				if (Arr->Num() == 0 || Arr->Num() > MaxSteps)
				{
					Error = FString::Printf(TEXT("steps 要有 1 到 %d 步，给了 %d 步"), MaxSteps, Arr->Num());
					return false;
				}
				for (const TSharedPtr<FJsonValue>& V : *Arr)
				{
					const TSharedPtr<FJsonObject>* StepObj = nullptr;
					if (!V.IsValid() || !V->TryGetObject(StepObj) || !StepObj)
					{
						Error = TEXT("steps 里每一项都要是 {op, args}");
						return false;
					}
					if (!ParseStep(*StepObj, Job->Steps.AddDefaulted_GetRef(), Error))
					{
						return false;
					}
				}
			}
			else if (!ParseStep(A, Job->Steps.AddDefaulted_GetRef(), Error))
			{
				return false;
			}
			FState& S = State();
			Job->Id = FString::Printf(TEXT("uelink-%d"), ++S.Serial);
			Job->Title = Str(A, TEXT("title"), Job->Steps.Num() == 1 ? Job->Steps[0].Op : FString::Printf(TEXT("%d 步"), Job->Steps.Num()));
			Job->bStopOnError = Bool(A, TEXT("stopOnError"), true);
			Job->StartedAt = FDateTime::UtcNow();
			S.Jobs.Add(Job);
			// 只删已经结束的旧作业，排队和正在跑的不能丢
			for (int32 i = 0; i < S.Jobs.Num() && S.Jobs.Num() > MaxKept;)
			{
				if (S.Jobs[i]->IsFinished())
				{
					S.Jobs.RemoveAt(i);
				}
				else
				{
					++i;
				}
			}
			EnsureTicking();
			Publish(*Job, TEXT("queued"));
			Out = Summary(*Job);
			Out->SetStringField(TEXT("job"), Job->Id);
			return true;
		}
	}

	void RegisterJobOps(FAgentPanelBridge& Bridge)
	{
		using namespace JobOps;
		Bridge.AddOp(TEXT("job.start"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			return StartJob(A, Out, Error);
		});

		Bridge.AddOp(TEXT("job.get"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString Id = Str(A, TEXT("id"));
			if (Id.IsEmpty())
			{
				TArray<TSharedPtr<FJsonValue>> Items;
				const TArray<TSharedPtr<FJob>>& Jobs = State().Jobs;
				for (int32 i = Jobs.Num() - 1; i >= 0; --i)
				{
					Items.Add(MakeShared<FJsonValueObject>(Summary(*Jobs[i])));
				}
				Out->SetArrayField(TEXT("items"), Items);
				return true;
			}
			const TSharedPtr<FJob> Job = FindJob(Id);
			if (!Job.IsValid())
			{
				Error = FString::Printf(TEXT("没有作业 %s（只留最近 %d 个，编辑器重启后也没了）：结果文件在 Saved/UELink/jobs/%s.json"), *Id, MaxKept, *Id);
				return false;
			}
			Out = Describe(*Job);
			return true;
		});

		Bridge.AddOp(TEXT("job.stop"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString Id = Str(A, TEXT("id"));
			const TSharedPtr<FJob> Job = FindJob(Id);
			if (!Job.IsValid())
			{
				Error = FString::Printf(TEXT("没有作业 %s"), *Id);
				return false;
			}
			const bool bStopped = !Job->IsFinished();
			if (bStopped)
			{
				// 每一步都在一帧里做完，能走到这里说明没有步骤正在做：剩下的直接不做了
				Finish(*Job, TEXT("cancelled"));
			}
			Out = Summary(*Job);
			Out->SetBoolField(TEXT("stopped"), bStopped);
			return true;
		});

		Bridge.AddAsyncOp(TEXT("job.wait"), [](const TSharedPtr<FJsonObject>& A, FAgentPanelReply Reply)
		{
			const FString Id = Str(A, TEXT("id"));
			const TSharedPtr<FJob> Job = FindJob(Id);
			if (!Job.IsValid())
			{
				Reply(false, nullptr, FString::Printf(TEXT("没有作业 %s（只留最近 %d 个，编辑器重启后也没了）"), *Id, MaxKept));
				return;
			}
			if (Job->IsFinished())
			{
				Reply(true, Describe(*Job), FString());
				return;
			}
			const int32 WaitMs = FMath::Clamp(Int(A, TEXT("timeoutMs"), DefaultWaitMs), 0, MaxWaitMs);
			FWaiter& W = Job->Waiters.AddDefaulted_GetRef();
			W.Reply = MoveTemp(Reply);
			W.Deadline = FPlatformTime::Seconds() + WaitMs / 1000.0;
			EnsureTicking();
		});
	}

	void ShutdownJobOps()
	{
		JobOps::FState& S = JobOps::State();
		if (S.Tick.IsValid())
		{
			FTSTicker::GetCoreTicker().RemoveTicker(S.Tick);
			S.Tick.Reset();
		}
		S.Jobs.Reset();
	}
}
