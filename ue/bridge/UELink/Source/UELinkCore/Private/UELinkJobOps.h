// 长操作变作业（2.13.0）：job.start 马上回作业号，之后每帧做一步（一步就是一个已登记的同步操作），
// 进度推 uelink.job 事件；job.get 查、job.stop 取消、job.wait 等到做完或超时再回（异步操作，不让客户端轮询）
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Misc/DateTime.h"

#include "AgentPanelBridge.h"

namespace AgentPanel
{
	void RegisterJobOps(FAgentPanelBridge& Bridge);
	/** 模块关闭前调：停掉每帧的推进，丢掉没做完的作业和等待者（HTTP 服务也要停了，不再回复） */
	void ShutdownJobOps();

	namespace JobOps
	{
		struct FBatchJob;

		struct FStep
		{
			FString Op;
			TSharedPtr<FJsonObject> Args;
			bool bDone = false;
			bool bOk = false;
			FString Error;
			TSharedPtr<FJsonObject> Result;
			double Ms = 0;
			/** 批量作业（2.14）：这一步属于第几个资源；普通作业是 INDEX_NONE */
			int32 Item = INDEX_NONE;
			/** 批量作业的阶段：dryRun / apply / compile / undo，普通作业为空 */
			FString Phase;
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
			/** 批量作业（UELinkBatch.cpp）：每步做完后由它决定跳过、回滚，回包按资源汇总 */
			TSharedPtr<FBatchJob> Batch;

			bool IsFinished() const { return Status == TEXT("done") || Status == TEXT("failed") || Status == TEXT("cancelled"); }
		};

		/** 把作业排进队列并开始推进，回 job.start 的摘要（含 job 作业号） */
		TSharedRef<FJsonObject> Enqueue(const TSharedRef<FJob>& Job);
		/** 一步里的同步操作最多几步：普通作业的 steps 上限 */
		constexpr int32 MaxSteps = 2000;
		/** 回包里各步结果合计最多多少字（读结构的上限），超出的只在结果文件里 */
		constexpr int32 ResultBudget = 12000;
		FString ToText(const TSharedRef<FJsonObject>& O);
	}
}
