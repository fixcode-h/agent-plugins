// Agent 面板桥接插件的编辑器模块：资源读写和保存、蓝图图表读写和编译、PIE、Live Coding、打开资源，以及后台编辑器（-run=AgentPanel）
using UnrealBuildTool;

public class AgentPanelBridgeEditor : ModuleRules
{
	public AgentPanelBridgeEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"AgentPanelBridge", "UnrealEd", "Json", "JsonUtilities", "AssetRegistry", "Slate", "SlateCore",
			// 资源新建 / 改名（AssetTools）、蓝图图表读写（BlueprintGraph：K2 节点和节点动作库）
			"AssetTools", "BlueprintGraph",
			// trace 分析（性能页二期）：Unreal Insights 读 trace 用的同一套模块
			"TraceAnalysis", "TraceServices"
		});
		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PrivateDependencyModuleNames.Add("LiveCoding");
			PrivateDefinitions.Add("AGENT_PANEL_LIVE_CODING=1");
		}
		else
		{
			PrivateDefinitions.Add("AGENT_PANEL_LIVE_CODING=0");
		}
	}
}
