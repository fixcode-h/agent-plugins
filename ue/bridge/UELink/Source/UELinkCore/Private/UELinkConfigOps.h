// 项目配置和 GameplayTag 的只读浏览（2.4.0 起，设计稿「UE 插件优化与扩展」二 P2）：config.files、config.get、tags.list、tags.refs
#pragma once

#include "CoreMinimal.h"

class FAgentPanelBridge;

namespace AgentPanel
{
	void RegisterConfigOps(FAgentPanelBridge& Bridge);
}
