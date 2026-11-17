// 资源文件夹树（照 Content Browser：点开一个文件夹才读下一层），只读资源注册表、不加载资源。从 RuntimeOps 拆出来
#pragma once

#include "CoreMinimal.h"

class FAgentPanelBridge;
class UClass;

namespace AgentPanel
{
	/** 登记 assets.children：`/` 给挂载根，其他路径给这一层的子文件夹和资源 */
	void RegisterAssetTreeOps(FAgentPanelBridge& Bridge);

	/** 按名字或 /Script 路径找类（定义在 AgentPanelRuntimeOps.cpp，assets 和 assets.children 共用） */
	UClass* FindClassByName(const FString& Name);
}
