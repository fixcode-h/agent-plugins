// 批量（2.14.0，协议文档「批量」一节）：
//   <操作> {paths: [...] | items: [{path, vars?, ...这一项的参数}], ...其余参数, dryRun?, onError?: "rollback"|"keep", compile?: "end"}
//   job.batch {op, 同上}
// 同一组参数套用到每个资源，展开成一个作业（UELinkJobOps.cpp）逐个执行，回作业号；客户端用 job.wait 等、job.get 看汇总。
// 写操作（登记时 bWrite）且操作认 dryRun 时分两段：先每个资源演练一遍，有一个失败就整批不改；全部通过再真改。
// 真改时有失败：onError=rollback（默认）把这批里已经改好的按倒序撤回（tx 交给 asset.undo，或用 prev 把值设回去），keep 保留成功的。
// 为什么不包成一个跨资源的大事务：几十上百个蓝图的编译装进一个事务，撤销缓冲容易爆，编辑器 Ctrl+Z 也会一下撤掉整批。
// 字符串参数里的 {name}（资源名）、{path}、{dir}、{vars.键}（这一项 vars 里的值）逐个替换；整个字符串就是 {vars.键} 时原样换成那个值（数字、对象都行）。
#include "UELinkBatch.h"
#include "UELinkJobOps.h"
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

namespace AgentPanel
{
	namespace JobOps
	{
		/** 批量作业的状态：每个资源在各阶段是哪一步（步骤下标，没有是 INDEX_NONE） */
		struct FBatchJob
		{
			FString Op;
			FAgentPanelBatchInfo Info;
			TArray<FString> Paths;
			TArray<int32> DryStep;
			TArray<int32> ApplyStep;
			TArray<int32> CompileStep;
			TArray<int32> UndoStep;
			/** 演练阶段的最后一步；没有演练阶段是 INDEX_NONE */
			int32 LastDry = INDEX_NONE;
			bool bRollback = true;
			bool bDryFailed = false;
			/** 演练有失败，整批没改 */
			bool bAborted = false;
			/** 真改有失败，已经开始回滚 */
			bool bRolledBack = false;
		};

		namespace Batch
		{
			const FString PhaseDry = TEXT("dryRun");
			const FString PhaseApply = TEXT("apply");
			const FString PhaseRun = TEXT("run");
			const FString PhaseCompile = TEXT("compile");
			const FString PhaseUndo = TEXT("undo");

			/** 一步算不算失败：操作报错，或者蓝图编译出错（bp.edit 改成功了但编不过，留着也是坏的） */
			bool StepFailed(const FStep& St)
			{
				if (!St.bDone)
				{
					return false;
				}
				if (!St.bOk)
				{
					return true;
				}
				const TSharedPtr<FJsonObject>* Compile = nullptr;
				if (St.Result.IsValid() && St.Result->TryGetObjectField(TEXT("compile"), Compile) && Compile && Compile->IsValid())
				{
					return Str(*Compile, TEXT("status")) == TEXT("error");
				}
				return false;
			}

			FString StepError(const FStep& St)
			{
				if (!St.bOk)
				{
					return St.Error;
				}
				const TSharedPtr<FJsonObject>* Compile = nullptr;
				if (St.Result.IsValid() && St.Result->TryGetObjectField(TEXT("compile"), Compile) && Compile && Compile->IsValid())
				{
					return FString::Printf(TEXT("编译出错（%d 个错误），详情见 report 里这一步的 compile"), Int(*Compile, TEXT("errors"), 0));
				}
				return FString();
			}

			/** 资源名：/Game/A/BP_X.BP_X → BP_X */
			FString AssetName(const FString& Path)
			{
				FString Name = Path;
				int32 Slash = INDEX_NONE;
				if (Name.FindLastChar(TEXT('/'), Slash))
				{
					Name.RightChopInline(Slash + 1);
				}
				int32 Dot = INDEX_NONE;
				if (Name.FindChar(TEXT('.'), Dot))
				{
					Name.LeftInline(Dot);
				}
				return Name;
			}

			struct FVarsCtx
			{
				FString Path;
				FString Name;
				FString Dir;
				TSharedPtr<FJsonObject> Vars;
			};

			/** 字符串里的占位符；整个字符串就是 {vars.键} 时返回那个值本身 */
			TSharedPtr<FJsonValue> SubstituteString(const FString& S, const FVarsCtx& Ctx)
			{
				if (!S.Contains(TEXT("{")))
				{
					return MakeShared<FJsonValueString>(S);
				}
				if (S.StartsWith(TEXT("{vars.")) && S.EndsWith(TEXT("}")) && Ctx.Vars.IsValid())
				{
					const FString Key = S.Mid(6, S.Len() - 7);
					if (!Key.Contains(TEXT("}")))
					{
						if (const TSharedPtr<FJsonValue> V = Ctx.Vars->TryGetField(Key))
						{
							return V;
						}
					}
				}
				FString Out = S.Replace(TEXT("{name}"), *Ctx.Name).Replace(TEXT("{path}"), *Ctx.Path).Replace(TEXT("{dir}"), *Ctx.Dir);
				if (Ctx.Vars.IsValid())
				{
					for (const auto& Pair : Ctx.Vars->Values)
					{
						const FString Token = FString::Printf(TEXT("{vars.%s}"), *UELINK_JSON_KEY(Pair.Key));
						if (!Out.Contains(Token) || !Pair.Value.IsValid())
						{
							continue;
						}
						FString Text;
						if (!Pair.Value->TryGetString(Text))
						{
							double Num = 0;
							bool B = false;
							Text = Pair.Value->TryGetNumber(Num) ? FString::SanitizeFloat(Num) : Pair.Value->TryGetBool(B) ? (B ? TEXT("true") : TEXT("false")) : FString();
						}
						Out = Out.Replace(*Token, *Text);
					}
				}
				return MakeShared<FJsonValueString>(Out);
			}

			/** 深拷贝一个值，顺带替换字符串里的占位符（每个资源一份参数，不能共用同一个对象） */
			TSharedPtr<FJsonValue> Substitute(const TSharedPtr<FJsonValue>& V, const FVarsCtx& Ctx)
			{
				if (!V.IsValid())
				{
					return MakeShared<FJsonValueNull>();
				}
				switch (V->Type)
				{
				case EJson::String:
					return SubstituteString(V->AsString(), Ctx);
				case EJson::Array:
				{
					TArray<TSharedPtr<FJsonValue>> Arr;
					for (const TSharedPtr<FJsonValue>& E : V->AsArray())
					{
						Arr.Add(Substitute(E, Ctx));
					}
					return MakeShared<FJsonValueArray>(Arr);
				}
				case EJson::Object:
				{
					const TSharedPtr<FJsonObject> Src = V->AsObject();
					const TSharedPtr<FJsonObject> Dst = MakeShared<FJsonObject>();
					if (Src.IsValid())
					{
						for (const auto& Pair : Src->Values)
						{
							Dst->SetField(UELINK_JSON_KEY(Pair.Key), Substitute(Pair.Value, Ctx));
						}
					}
					return MakeShared<FJsonValueObject>(Dst);
				}
				default:
					return V;
				}
			}

			/** 批量自己的参数，不传给每一步 */
			bool IsBatchKey(const FString& Key)
			{
				return Key == TEXT("paths") || Key == TEXT("items") || Key == TEXT("onError") || Key == TEXT("title") || Key == TEXT("op") || Key == TEXT("dryRun") || Key == TEXT("dryRunFirst");
			}

			struct FItem
			{
				FString Path;
				TSharedPtr<FJsonObject> Own;
			};

			bool ParseItems(const TSharedPtr<FJsonObject>& A, bool bRepeatPaths, TArray<FItem>& Items, FString& Error)
			{
				const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
				const bool bPaths = A->TryGetArrayField(TEXT("paths"), Arr) && Arr;
				if (!bPaths && !(A->TryGetArrayField(TEXT("items"), Arr) && Arr))
				{
					Error = TEXT("批量要给 paths（路径数组）或 items（[{path, ...这一项的参数}]）");
					return false;
				}
				if (Arr->Num() == 0 || Arr->Num() > MaxBatchItems)
				{
					Error = FString::Printf(TEXT("一次批量 1 到 %d 个资源，给了 %d 个：分几批调"), MaxBatchItems, Arr->Num());
					return false;
				}
				TSet<FString> Seen;
				for (int32 i = 0; i < Arr->Num(); ++i)
				{
					const TSharedPtr<FJsonValue>& V = (*Arr)[i];
					FItem It;
					const TSharedPtr<FJsonObject>* Obj = nullptr;
					if (bPaths)
					{
						if (!V.IsValid() || !V->TryGetString(It.Path))
						{
							Error = FString::Printf(TEXT("paths 第 %d 项不是字符串"), i + 1);
							return false;
						}
					}
					else if (V.IsValid() && V->TryGetObject(Obj) && Obj && Obj->IsValid())
					{
						It.Own = *Obj;
						It.Path = Str(It.Own, TEXT("path"));
					}
					It.Path.TrimStartAndEndInline();
					if (It.Path.IsEmpty())
					{
						Error = FString::Printf(TEXT("第 %d 项没有 path"), i + 1);
						return false;
					}
					// 同一个资源出现两次：第二次改的是第一次的结果，回滚顺序也会乱，直接拒绝
					if (!bRepeatPaths && Seen.Contains(It.Path))
					{
						Error = FString::Printf(TEXT("%s 出现了两次：同一个资源在一批里只能出现一次"), *It.Path);
						return false;
					}
					Seen.Add(It.Path);
					Items.Add(It);
				}
				return true;
			}

			/** 一个资源的参数：公共参数 + 这一项自己的参数（同名的以这一项为准），再替换占位符 */
			TSharedPtr<FJsonObject> ItemArgs(const TSharedPtr<FJsonObject>& Base, const FItem& It)
			{
				FVarsCtx Ctx;
				Ctx.Path = It.Path;
				Ctx.Name = AssetName(It.Path);
				int32 Slash = INDEX_NONE;
				Ctx.Dir = It.Path.FindLastChar(TEXT('/'), Slash) ? It.Path.Left(Slash) : FString();
				const TSharedPtr<FJsonObject>* Vars = nullptr;
				if (It.Own.IsValid() && It.Own->TryGetObjectField(TEXT("vars"), Vars) && Vars)
				{
					Ctx.Vars = *Vars;
				}
				const TSharedPtr<FJsonObject> Merged = MakeShared<FJsonObject>();
				for (const auto& Pair : Base->Values)
				{
					Merged->SetField(UELINK_JSON_KEY(Pair.Key), Pair.Value);
				}
				if (It.Own.IsValid())
				{
					for (const auto& Pair : It.Own->Values)
					{
						if (UELINK_JSON_KEY(Pair.Key) != TEXT("vars"))
						{
							Merged->SetField(UELINK_JSON_KEY(Pair.Key), Pair.Value);
						}
					}
				}
				const TSharedPtr<FJsonValue> Out = Substitute(MakeShared<FJsonValueObject>(Merged), Ctx);
				TSharedPtr<FJsonObject> Obj = Out->AsObject();
				Obj->SetStringField(TEXT("path"), It.Path);
				return Obj;
			}

			TSharedPtr<FJsonObject> CopyWith(const TSharedPtr<FJsonObject>& Src, const TCHAR* Key, const TSharedPtr<FJsonValue>& Value)
			{
				const TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				for (const auto& Pair : Src->Values)
				{
					O->SetField(UELINK_JSON_KEY(Pair.Key), Pair.Value);
				}
				O->SetField(Key, Value);
				return O;
			}

			int32 AddStep(FJob& Job, const FString& Op, const TSharedPtr<FJsonObject>& Args, int32 Item, const FString& Phase)
			{
				FStep& St = Job.Steps.AddDefaulted_GetRef();
				St.Op = Op;
				St.Args = Args;
				St.Item = Item;
				St.Phase = Phase;
				return Job.Steps.Num() - 1;
			}

			/** 回滚一个资源的那一步；不能回滚（没有 tx / prev）返回 false */
			bool MakeUndo(const FBatchJob& B, const FStep& Applied, FString& Op, TSharedPtr<FJsonObject>& Args)
			{
				if (!Applied.Result.IsValid())
				{
					return false;
				}
				if (B.Info.Undo == TEXT("tx"))
				{
					const FString Tx = Str(Applied.Result, TEXT("tx"));
					if (Tx.IsEmpty())
					{
						return false;
					}
					Op = TEXT("asset.undo");
					Args = MakeShared<FJsonObject>();
					Args->SetStringField(TEXT("tx"), Tx);
					Args->SetStringField(TEXT("path"), Str(Applied.Args, TEXT("path")));
					return true;
				}
				if (B.Info.Undo == TEXT("prev"))
				{
					const TSharedPtr<FJsonValue> Prev = Applied.Result->TryGetField(TEXT("prev"));
					if (!Prev.IsValid())
					{
						return false;
					}
					Op = B.Op;
					Args = CopyWith(Applied.Args, TEXT("value"), Prev);
					return true;
				}
				return false;
			}

			/** 一个资源最后是什么状态，失败时带原因 */
			FString ItemState(const FJob& Job, int32 i, FString& Error)
			{
				const FBatchJob& B = *Job.Batch;
				const int32 Order[] = {B.DryStep[i], B.ApplyStep[i], B.CompileStep[i]};
				for (const int32 Idx : Order)
				{
					if (Job.Steps.IsValidIndex(Idx) && StepFailed(Job.Steps[Idx]))
					{
						Error = StepError(Job.Steps[Idx]);
						if (Job.Steps.IsValidIndex(B.UndoStep[i]) && Job.Steps[B.UndoStep[i]].bDone && Job.Steps[B.UndoStep[i]].bOk)
						{
							return TEXT("rolledBack");
						}
						return TEXT("failed");
					}
				}
				if (Job.Steps.IsValidIndex(B.UndoStep[i]))
				{
					const FStep& U = Job.Steps[B.UndoStep[i]];
					if (U.bDone && !U.bOk)
					{
						Error = FString::Printf(TEXT("回滚失败：%s（这个资源改动还在，用 asset.revert 放弃整包）"), *U.Error);
						return TEXT("failed");
					}
					return U.bDone ? TEXT("rolledBack") : TEXT("pending");
				}
				if (Job.Steps.IsValidIndex(B.ApplyStep[i]))
				{
					const FStep& Ap = Job.Steps[B.ApplyStep[i]];
					if (Ap.bDone)
					{
						if (B.bRolledBack && B.Info.bWrite)
						{
							Error = TEXT("这一步不能自动回滚（没有撤销信息），改动还在");
						}
						return TEXT("ok");
					}
					if (B.bAborted)
					{
						Error = TEXT("演练时别的资源失败了，整批没有改");
						return TEXT("skipped");
					}
					if (B.bRolledBack)
					{
						Error = TEXT("前面的资源失败了，后面的没有改");
						return TEXT("skipped");
					}
					return Job.IsFinished() ? TEXT("skipped") : TEXT("pending");
				}
				// 只演练
				if (Job.Steps.IsValidIndex(B.DryStep[i]) && Job.Steps[B.DryStep[i]].bDone)
				{
					return TEXT("dryRunOk");
				}
				return Job.IsFinished() ? TEXT("skipped") : TEXT("pending");
			}
		}

		void AfterBatchStep(FJob& Job, int32 Index)
		{
			FBatchJob& B = *Job.Batch;
			// 下面可能往 Steps 里追加，先把要用的拿出来，别拿着引用
			const bool bFailed = Batch::StepFailed(Job.Steps[Index]);
			const FString Phase = Job.Steps[Index].Phase;
			if (Phase == Batch::PhaseDry)
			{
				B.bDryFailed |= bFailed;
				if (Index == B.LastDry && B.bDryFailed)
				{
					B.bAborted = true;
					Job.Next = Job.Steps.Num();
				}
				return;
			}
			if (Phase != Batch::PhaseApply || !bFailed || !B.Info.bWrite || B.bRolledBack)
			{
				return;
			}
			if (!B.bRollback)
			{
				return;
			}
			// 回滚：后面的不做了，把已经改成功（包括改成功但编译出错）的按倒序撤回
			B.bRolledBack = true;
			Job.Next = Job.Steps.Num();
			for (int32 i = B.Paths.Num() - 1; i >= 0; --i)
			{
				const int32 Ai = B.ApplyStep[i];
				if (!Job.Steps.IsValidIndex(Ai) || !Job.Steps[Ai].bDone || !Job.Steps[Ai].bOk)
				{
					continue;
				}
				FString Op;
				TSharedPtr<FJsonObject> Args;
				if (Batch::MakeUndo(B, Job.Steps[Ai], Op, Args))
				{
					B.UndoStep[i] = Batch::AddStep(Job, Op, Args, i, Batch::PhaseUndo);
				}
			}
		}

		bool BatchHasFailure(const FJob& Job)
		{
			if (!Job.Batch.IsValid())
			{
				return false;
			}
			const FBatchJob& B = *Job.Batch;
			if (B.bAborted || B.bRolledBack)
			{
				return true;
			}
			for (const FStep& St : Job.Steps)
			{
				if (Batch::StepFailed(St))
				{
					return true;
				}
			}
			return false;
		}

		void DescribeBatch(const FJob& Job, const TSharedRef<FJsonObject>& O, bool bFull)
		{
			const FBatchJob& B = *Job.Batch;
			const TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
			S->SetStringField(TEXT("op"), B.Op);
			S->SetNumberField(TEXT("items"), B.Paths.Num());
			TMap<FString, int32> Counts;
			TArray<TSharedPtr<FJsonValue>> Bad;
			TArray<TSharedPtr<FJsonValue>> Good;
			for (int32 i = 0; i < B.Paths.Num(); ++i)
			{
				FString Error;
				const FString State = Batch::ItemState(Job, i, Error);
				Counts.FindOrAdd(State) += 1;
				const TSharedRef<FJsonObject> It = MakeShared<FJsonObject>();
				It->SetStringField(TEXT("path"), B.Paths[i]);
				It->SetNumberField(TEXT("item"), i);
				It->SetStringField(TEXT("state"), State);
				if (!Error.IsEmpty())
				{
					It->SetStringField(TEXT("error"), Error);
				}
				// 失败、回滚的排前面：回包放不下时先丢成功的
				(State == TEXT("ok") || State == TEXT("dryRunOk") || State == TEXT("pending") ? Good : Bad).Add(MakeShared<FJsonValueObject>(It));
			}
			for (const TPair<FString, int32>& C : Counts)
			{
				S->SetNumberField(C.Key, C.Value);
			}
			if (B.bAborted)
			{
				S->SetStringField(TEXT("stopped"), TEXT("dryRun"));
			}
			else if (B.bRolledBack)
			{
				S->SetStringField(TEXT("stopped"), TEXT("rolledBack"));
			}
			TArray<TSharedPtr<FJsonValue>> List = MoveTemp(Bad);
			List.Append(Good);
			if (!bFull)
			{
				int32 Used = 0;
				int32 Keep = 0;
				for (; Keep < List.Num(); ++Keep)
				{
					const TSharedPtr<FJsonObject>* It = nullptr;
					Used += List[Keep]->TryGetObject(It) && It ? ToText(It->ToSharedRef()).Len() : 0;
					// 至少留一项，客户端知道往哪看
					if (Used > ResultBudget / 2 && Keep > 0)
					{
						break;
					}
				}
				if (Keep < List.Num())
				{
					S->SetNumberField(TEXT("listed"), Keep);
					List.SetNum(Keep);
				}
			}
			S->SetArrayField(TEXT("list"), List);
			O->SetObjectField(TEXT("batch"), S);
		}
	}

	bool StartBatch(const FString& Op, const FAgentPanelBatchInfo& Info, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		using namespace JobOps;
		if (!A.IsValid() || !FAgentPanelBridge::Get().HasOp(Op))
		{
			Error = FString::Printf(TEXT("这个进程不支持 %s"), *Op);
			return false;
		}
		TArray<Batch::FItem> Items;
		if (!Batch::ParseItems(A, Info.bRepeatPaths, Items, Error))
		{
			return false;
		}
		const FString OnError = Str(A, TEXT("onError"), TEXT("rollback"));
		if (OnError != TEXT("rollback") && OnError != TEXT("keep"))
		{
			Error = TEXT("onError 只能是 rollback（失败时撤回这批已改的，默认）或 keep（保留改成功的）");
			return false;
		}
		const bool bDryOnly = Bool(A, TEXT("dryRun"), false);
		if (bDryOnly && !Info.bDryRun)
		{
			Error = FString::Printf(TEXT("%s 不支持演练（dryRun）"), *Op);
			return false;
		}
		const bool bTwoPhase = Info.bWrite && Info.bDryRun && (bDryOnly || Bool(A, TEXT("dryRunFirst"), true));
		FString CompileMode;
		const bool bCompileAtEnd = Info.bCompile && A->TryGetStringField(TEXT("compile"), CompileMode) && CompileMode == TEXT("end");

		// 公共参数：去掉批量自己的；compile=end 时每一步都不编，最后统一编
		const TSharedPtr<FJsonObject> Base = MakeShared<FJsonObject>();
		for (const auto& Pair : A->Values)
		{
			const FString Key = UELINK_JSON_KEY(Pair.Key);
			if (!Batch::IsBatchKey(Key) && Key != TEXT("path"))
			{
				Base->SetField(Key, Pair.Value);
			}
		}
		if (bCompileAtEnd)
		{
			Base->SetBoolField(TEXT("compile"), false);
		}

		const TSharedRef<FJob> Job = MakeShared<FJob>();
		Job->bStopOnError = false;
		const TSharedRef<FBatchJob> B = MakeShared<FBatchJob>();
		B->Op = Op;
		B->Info = Info;
		B->bRollback = OnError == TEXT("rollback");
		const int32 N = Items.Num();
		B->DryStep.Init(INDEX_NONE, N);
		B->ApplyStep.Init(INDEX_NONE, N);
		B->CompileStep.Init(INDEX_NONE, N);
		B->UndoStep.Init(INDEX_NONE, N);
		TArray<TSharedPtr<FJsonObject>> Args;
		for (const Batch::FItem& It : Items)
		{
			B->Paths.Add(It.Path);
			Args.Add(Batch::ItemArgs(Base, It));
		}
		if (bTwoPhase)
		{
			for (int32 i = 0; i < N; ++i)
			{
				B->DryStep[i] = Batch::AddStep(*Job, Op, Batch::CopyWith(Args[i], TEXT("dryRun"), MakeShared<FJsonValueBoolean>(true)), i, Batch::PhaseDry);
			}
			B->LastDry = N - 1;
		}
		if (!bDryOnly)
		{
			for (int32 i = 0; i < N; ++i)
			{
				// 读操作没有「改」，阶段叫 run
				B->ApplyStep[i] = Batch::AddStep(*Job, Op, Args[i], i, Info.bWrite ? Batch::PhaseApply : Batch::PhaseRun);
			}
			if (bCompileAtEnd)
			{
				for (int32 i = 0; i < N; ++i)
				{
					const TSharedPtr<FJsonObject> C = MakeShared<FJsonObject>();
					C->SetStringField(TEXT("path"), Items[i].Path);
					B->CompileStep[i] = Batch::AddStep(*Job, TEXT("bp.compile"), C, i, Batch::PhaseCompile);
				}
			}
		}
		Job->Batch = B;
		Job->Title = Str(A, TEXT("title"), FString::Printf(TEXT("批量 %s · %d 个%s"), *Op, N, bDryOnly ? TEXT("（演练）") : TEXT("")));
		Out = Enqueue(Job);
		Out->SetBoolField(TEXT("batch"), true);
		Out->SetNumberField(TEXT("items"), N);
		return true;
	}

	void RegisterBatchOps(FAgentPanelBridge& Bridge)
	{
		// 运行时模块里能批量的：读属性、改属性（资源上的修改没有事务，回滚靠 prev 把值设回去）
		FAgentPanelBatchInfo Read;
		Bridge.AddBatchOp(TEXT("get"), Read);
		Bridge.AddBatchOp(TEXT("props"), Read);
		FAgentPanelBatchInfo Write;
		Write.bWrite = true;
		Write.Undo = TEXT("prev");
		Bridge.AddBatchOp(TEXT("set"), Write);

		Bridge.AddOp(TEXT("job.batch"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString Op = Str(A, TEXT("op"));
			const FAgentPanelBatchInfo* Info = FAgentPanelBridge::Get().FindBatchOp(Op);
			if (!Info)
			{
				Error = FString::Printf(TEXT("%s 不支持批量。能批量的操作见 /info 的 batchOps"), *Op);
				return false;
			}
			return StartBatch(Op, *Info, A, Out, Error);
		});
	}
}
