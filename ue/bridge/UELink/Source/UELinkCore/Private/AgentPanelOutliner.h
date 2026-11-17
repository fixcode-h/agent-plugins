// 世界大纲（Actor 树）和 UObject 树：只列名字、类、层级，属性等网页点了某一项再用 props 读。从 RuntimeOps 拆出来
#pragma once

#include "CoreMinimal.h"

class FAgentPanelBridge;

namespace AgentPanel
{
	/** 登记 outliner（一个世界的全部 Actor）、objects.children（某个对象下一层的非 Actor 对象） */
	void RegisterOutlinerOps(FAgentPanelBridge& Bridge);
}
