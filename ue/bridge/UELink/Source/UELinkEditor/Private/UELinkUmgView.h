// 2.17：按 UE 控件蓝图编辑器的样子在网页上看 UMG（设计稿「资源查看页：按 UE 编辑器布局」第 4、5 节）。
// - umg.design：控件蓝图设计时的控件树（UWidgetBlueprint::WidgetTree，不是运行中的实例，所以不用开 PIE）
// - umg.anims：控件蓝图的动画，形状和 AssetForge 配置的 animations 一致（只读，UELink 不依赖 AssetForge）
// - umg.render：离屏渲染一帧预览图（UELinkUmgRender.cpp），可以按某个动画的某个时刻定格
// 两个 .cpp 共用的读法放在这里：找控件蓝图、控件路径、动画轨道的通道。
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonValue.h"

class UWidget;
class UWidgetAnimation;
class UWidgetBlueprint;
class UWidgetTree;

namespace UELinkUmgView
{
	/** 控件蓝图：资源路径（/Game/A/WBP_X、.WBP_X）、生成类（_C）、类默认对象、蓝图里某个控件模板的路径都认 */
	UWidgetBlueprint* LoadWidgetBlueprint(const FString& Path, FString& Error);

	/** 控件树里每个控件的路径（Root/Child/...，和 AssetForge 配置的 target 一致）；子控件按面板和命名插槽走 */
	TMap<const UWidget*, FString> WidgetPaths(UWidgetTree* Tree);

	/** 一个关键帧：秒、值、插值（cubic / linear / constant） */
	struct FUmgKeyView
	{
		double Time = 0.0;
		double Value = 0.0;
		const TCHAR* Interp = TEXT("cubic");
	};

	/** 一条能读能求值的通道（float / double 曲线都包成这样，调用方不用管是哪一种） */
	struct FUmgChannelView
	{
		/** 控件路径（Root/Child/...） */
		FString Target;
		/** 通道名，和 AssetForge UmgAnimationCodec 的白名单一致：RenderOpacity、RenderTransform.Translation.X、slot.Padding.Left …… */
		FString Channel;
		/** 绑定的控件名：渲染时在新建的实例里按名字找回同一个控件 */
		FName WidgetName;
		/** 通道在控件的插槽上（slot.Padding.*）还是控件自己身上 */
		bool bOnSlot = false;
		/** 相对被绑定对象的属性路径（RenderOpacity、RenderTransform.Angle、Padding.Left），渲染定格时按它写值 */
		FString PropertyPath;
		TArray<FUmgKeyView> Keys;
		/** 按秒求值（曲线首尾之外按首尾值）；没有关键帧时返回 false */
		TFunction<bool(double Seconds, double& OutValue)> Eval;
	};

	/** 一个动画：名字、长度（秒，播放范围）、读得懂的通道、读不懂的轨道 */
	struct FUmgAnimView
	{
		FString Name;
		double Length = 0.0;
		TArray<FUmgChannelView> Channels;
		/** 不支持的轨道：{target, channel?, reason} */
		TArray<TSharedPtr<FJsonValue>> Skipped;
	};

	/** 读控件蓝图里的全部动画（只读，不改资源） */
	TArray<FUmgAnimView> ReadAnimations(UWidgetBlueprint* BP);

	/** 登记 umg.design、umg.anims（UELinkUmgView.cpp）和 umg.render（UELinkUmgRender.cpp） */
	void RegisterRenderOp();
}
