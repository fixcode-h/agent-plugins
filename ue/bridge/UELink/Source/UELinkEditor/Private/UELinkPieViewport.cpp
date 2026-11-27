// PIE 开进选中的视口（2.24.0）：pie {"action": "start", "window"?: "viewport"|"new"} 默认 viewport。
// 为什么默认不开新窗口：Agent 跑测试时每次弹一个浮动窗口会抢焦点、盖住编辑器，用户平时也是在关卡视口里玩
// （工具栏 Play 菜单勾「选中的视口」）。引擎的「在视口中运行」也是这样把活动关卡视口塞进 DestinationSlateViewport。
#include "AgentPanelEditorShared.h"

#include "Framework/Application/SlateApplication.h"
#include "IAssetViewport.h"
#include "LevelEditor.h"
#include "Modules/ModuleManager.h"
#include "PlayInEditorDataTypes.h"

bool AgentPanelEd::PieIntoSelectedViewport(FRequestPlaySessionParams& Params)
{
	if (!FSlateApplication::IsInitialized())
	{
		return false;
	}
	FLevelEditorModule* LevelEditor = FModuleManager::GetModulePtr<FLevelEditorModule>(TEXT("LevelEditor"));
	if (LevelEditor == nullptr)
	{
		return false;
	}
	const TSharedPtr<IAssetViewport> Viewport = LevelEditor->GetFirstActiveViewport();
	if (!Viewport.IsValid())
	{
		return false;
	}
	// 视口控件不在任何窗口里（页签藏起来了）时引擎没地方画，交给调用方退回新窗口
	if (!FSlateApplication::Get().FindWidgetWindow(Viewport->AsWidget()).IsValid())
	{
		return false;
	}
	Params.DestinationSlateViewport = TWeakPtr<IAssetViewport>(Viewport);
	return true;
}
