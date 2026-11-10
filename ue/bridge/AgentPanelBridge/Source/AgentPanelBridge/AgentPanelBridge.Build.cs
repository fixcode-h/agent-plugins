// Agent 面板桥接插件的运行时模块：编辑器、PIE、-game / 专用服务器进程里都加载（Shipping 不加载，见 .uplugin）
using UnrealBuildTool;

public class AgentPanelBridge : ModuleRules
{
	public AgentPanelBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"HTTPServer", "Json", "JsonUtilities", "AssetRegistry", "ImageCore",
			// 改控件属性后要调 UWidget::SynchronizeProperties 刷新界面
			"UMG"
		});
		// Shipping 里一律不编进去：.uplugin 已经拦了加载，这里再保证代码不在
		if (Target.Configuration == UnrealTargetConfiguration.Shipping)
		{
			PublicDefinitions.Add("AGENT_PANEL_BRIDGE_ENABLED=0");
		}
		else
		{
			PublicDefinitions.Add("AGENT_PANEL_BRIDGE_ENABLED=1");
		}
	}
}
