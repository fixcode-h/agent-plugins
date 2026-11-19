// 批量（2.14.0）：登记了的操作给 paths / items 时展开成一个作业，同一组参数逐个作用到每个资源。
// 写操作先整批演练、全部通过才真改，真改中途失败默认把已改的撤回；回包按资源汇总。协议见 docs/protocol.md「批量」
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

#include "AgentPanelBridge.h"

namespace AgentPanel
{
	/** 一次最多多少个资源 */
	constexpr int32 MaxBatchItems = 2000;

	/** 展开成作业并排队，Out 是作业摘要（job 作业号、batch: true、items 资源数） */
	bool StartBatch(const FString& Op, const FAgentPanelBatchInfo& Info, const TSharedPtr<FJsonObject>& Args, TSharedPtr<FJsonObject>& Out, FString& Error);
	/** job.batch {op, paths | items, ...参数}：和直接给操作传 paths 一样，给想显式调批量的客户端；get / props / set 的批量登记也在这里 */
	void RegisterBatchOps(FAgentPanelBridge& Bridge);

	namespace JobOps
	{
		struct FJob;

		/** 批量作业的一步做完后调：演练失败就不真改，真改失败按 onError 回滚（改 Next、往后追加撤回步骤） */
		void AfterBatchStep(FJob& Job, int32 Index);
		/** 往回包里写 batch 汇总（每个资源的状态）；bFull 为 true 时写全部（结果文件），否则按预算截断 */
		void DescribeBatch(const FJob& Job, const TSharedRef<FJsonObject>& O, bool bFull);
		/** 有资源失败（包括编译出错、演练没通过） */
		bool BatchHasFailure(const FJob& Job);
	}
}
