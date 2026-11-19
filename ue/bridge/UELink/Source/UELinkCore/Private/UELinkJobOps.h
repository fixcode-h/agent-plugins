// 长操作变作业（2.13.0）：job.start 马上回作业号，之后每帧做一步（一步就是一个已登记的同步操作），
// 进度推 uelink.job 事件；job.get 查、job.stop 取消、job.wait 等到做完或超时再回（异步操作，不让客户端轮询）
#pragma once

#include "CoreMinimal.h"

class FAgentPanelBridge;

namespace AgentPanel
{
	void RegisterJobOps(FAgentPanelBridge& Bridge);
	/** 模块关闭前调：停掉每帧的推进，丢掉没做完的作业和等待者（HTTP 服务也要停了，不再回复） */
	void ShutdownJobOps();
}
