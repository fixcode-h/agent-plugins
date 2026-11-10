// Agent 面板桥接插件的编辑器模块：资源写入和保存、PIE、Live Coding、打开资源，以及后台编辑器（-run=AgentPanel）
using UnrealBuildTool;

public class AgentPanelBridgeEditor : ModuleRules
{
	public AgentPanelBridgeEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"AgentPanelBridge", "UnrealEd", "Json", "JsonUtilities", "AssetRegistry", "Slate", "SlateCore"
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
