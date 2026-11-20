// 2.17：umg.render，离屏渲染控件蓝图的一帧预览（设计稿「资源查看页：按 UE 编辑器布局」4、5 节）。
// 做法照 UE 控件蓝图设计器和缩略图：在编辑器世界里 NewObject 一个实例、打上设计器标志（不跑 Construct，
// 所以不用开 PIE、也不需要 PlayerController），TakeWidget 后用 UMG 的 FWidgetRenderer 画进 RenderTarget，读回像素存 PNG。
// 一次在百毫秒级，同步做；图写进 Saved/UELink/preview/，回包只给路径和每个控件的矩形。
#include "UELinkUmgView.h"
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "Blueprint/UserWidget.h"
#include "Blueprint/WidgetTree.h"
#include "Components/PanelSlot.h"
#include "Components/Widget.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformTime.h"
#include "ImageUtils.h"
#include "Misc/App.h"
#include "Misc/Crc.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "RenderingThread.h"
#include "Slate/WidgetRenderer.h"
#include "TextureResource.h"
#include "UObject/Package.h"
#include "UObject/UnrealType.h"
#include "WidgetBlueprint.h"

namespace UELinkUmgRenderImpl
{
	/** 回包里最多列这么多个控件的矩形（网页画选框用；再多的界面也够了） */
	constexpr int32 MaxRects = 2000;

	double Num(const TSharedPtr<FJsonObject>& A, const TCHAR* Key, double Default)
	{
		double V = 0;
		if (A.IsValid() && A->TryGetNumberField(Key, V))
		{
			return V;
		}
		return Default;
	}

	/**
	 * 把动画在 Seconds 时刻的值写进实例的控件。这时还没建 Slate 控件，直接写属性就行：
	 * 建控件时 SynchronizeProperties 会把透明度、渲染变换、插槽 Padding 带过去。返回套上了几条通道
	 */
	int32 ApplyAnim(UUserWidget* Instance, const UELinkUmgView::FUmgAnimView& View, double Seconds, TArray<FString>& Notes)
	{
		UWidgetTree* Tree = Instance ? Instance->WidgetTree.Get() : nullptr;
		if (!Tree)
		{
			return 0;
		}
		int32 Applied = 0;
		for (const UELinkUmgView::FUmgChannelView& C : View.Channels)
		{
			double Value = 0;
			if (!C.Eval || !C.Eval(Seconds, Value))
			{
				continue;
			}
			UWidget* W = Tree->FindWidget(C.WidgetName);
			UObject* Owner = W;
			if (W && C.bOnSlot)
			{
				Owner = W->Slot;
			}
			if (!Owner)
			{
				Notes.Add(FString::Printf(TEXT("%s %s：实例里找不到这个控件或它的插槽，没套用"), *C.Target, *C.Channel));
				continue;
			}
			AgentPanel::FResolved R;
			FString Why;
			if (!AgentPanel::ResolvePath(Owner->GetClass(), Owner, Owner, C.PropertyPath, R, Why))
			{
				Notes.Add(FString::Printf(TEXT("%s %s：%s"), *C.Target, *C.Channel, *Why));
				continue;
			}
			FNumericProperty* NumProp = CastField<FNumericProperty>(R.Prop);
			if (!NumProp || !NumProp->IsFloatingPoint() || !R.Value)
			{
				Notes.Add(FString::Printf(TEXT("%s %s：属性不是浮点数，没套用"), *C.Target, *C.Channel));
				continue;
			}
			NumProp->SetFloatingPointPropertyValue(R.Value, Value);
			++Applied;
		}
		return Applied;
	}

	/** 每个控件在渲染图里的矩形（像素）：取上一次绘制的几何，没画出来的（折叠、隐藏、零尺寸）不列 */
	TArray<TSharedPtr<FJsonValue>> WidgetRects(UUserWidget* Instance)
	{
		TArray<TSharedPtr<FJsonValue>> Rects;
		UWidgetTree* Tree = Instance ? Instance->WidgetTree.Get() : nullptr;
		if (!Tree)
		{
			return Rects;
		}
		Tree->ForEachWidget([&Rects](UWidget* W)
		{
			if (!W || Rects.Num() >= MaxRects || !W->GetCachedWidget().IsValid())
			{
				return;
			}
			const ESlateVisibility Vis = W->GetVisibility();
			if (Vis == ESlateVisibility::Collapsed || Vis == ESlateVisibility::Hidden)
			{
				return;
			}
			const FGeometry& Geo = UELINK_WIDGET_PAINT_GEOMETRY(W);
			const auto Pos = Geo.GetAbsolutePosition();
			const auto Size = Geo.GetAbsoluteSize();
			if (Size.X <= 0 || Size.Y <= 0)
			{
				return;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), W->GetName());
			O->SetNumberField(TEXT("x"), FMath::RoundToDouble(static_cast<double>(Pos.X)));
			O->SetNumberField(TEXT("y"), FMath::RoundToDouble(static_cast<double>(Pos.Y)));
			O->SetNumberField(TEXT("w"), FMath::RoundToDouble(static_cast<double>(Size.X)));
			O->SetNumberField(TEXT("h"), FMath::RoundToDouble(static_cast<double>(Size.Y)));
			Rects.Add(MakeShared<FJsonValueObject>(O));
		});
		return Rects;
	}

	/** 定格动画：anim 找不到、有不支持的轨道时只写 note，照常画静态帧 */
	void FreezeAnim(UWidgetBlueprint* BP, UUserWidget* Instance, const FString& AnimName, double Seconds, TArray<FString>& Notes)
	{
		TArray<UELinkUmgView::FUmgAnimView> Anims = UELinkUmgView::ReadAnimations(BP);
		for (const UELinkUmgView::FUmgAnimView& View : Anims)
		{
			// 生成类里复制出来的动画对象名带 _INST，两种写法都认
			if (View.Name != AnimName && View.Name != AnimName + TEXT("_INST"))
			{
				continue;
			}
			ApplyAnim(Instance, View, Seconds, Notes);
			if (View.Skipped.Num() > 0)
			{
				Notes.Add(FString::Printf(TEXT("动画 %s 有 %d 条轨道不支持，没有套用（见 umg.anims 的 skipped）"), *AnimName, View.Skipped.Num()));
			}
			return;
		}
		Notes.Add(FString::Printf(TEXT("没有叫 %s 的动画，画的是静态帧（动画名见 umg.anims）"), *AnimName));
	}

	bool Render(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const double Start = FPlatformTime::Seconds();
		if (IsRunningCommandlet() || !FApp::CanEverRender() || !FSlateApplication::IsInitialized() || !GEditor)
		{
			Error = TEXT("这个进程画不了控件预览（后台编辑器、不渲染的进程里没有 Slate 渲染器）：在打开的编辑器里再试");
			return false;
		}
		UWidgetBlueprint* BP = UELinkUmgView::LoadWidgetBlueprint(AgentPanel::Str(A, TEXT("path")), Error);
		if (!BP)
		{
			return false;
		}
		UClass* WidgetClass = BP->GeneratedClass;
		if (!WidgetClass || !WidgetClass->IsChildOf(UUserWidget::StaticClass()))
		{
			Error = FString::Printf(TEXT("%s 还没有生成类：先在编辑器里编译这个控件蓝图"), *BP->GetName());
			return false;
		}
		if (WidgetClass->HasAnyClassFlags(CLASS_Abstract | CLASS_Deprecated | CLASS_NewerVersionExists))
		{
			Error = FString::Printf(TEXT("%s 是抽象类或旧版本的类，不能建实例：去掉 Abstract 或重新编译后再试"), *BP->GetName());
			return false;
		}
		if (BP->Status == BS_Error)
		{
			Error = FString::Printf(TEXT("%s 编译出错，先修好再预览（bp.compile 能看到错误）"), *BP->GetName());
			return false;
		}
		UWorld* World = GEditor->GetEditorWorldContext().World();
		if (!World)
		{
			Error = TEXT("编辑器世界还没准备好，稍后再试");
			return false;
		}
		const int32 Width = FMath::Clamp(AgentPanel::Int(A, TEXT("width"), 1920), 16, 7680);
		const int32 Height = FMath::Clamp(AgentPanel::Int(A, TEXT("height"), 1080), 16, 4320);
		const float Dpi = static_cast<float>(FMath::Clamp(Num(A, TEXT("dpi"), 1.0), 0.25, 4.0));
		TArray<FString> Notes;
		if (BP->Status == BS_Dirty)
		{
			Notes.Add(TEXT("蓝图有没编译的改动，预览是上次编译的结果"));
		}

		// 实例：Outer 是编辑器世界（有的控件要 GetWorld），标 Transient 免得跟着关卡存盘；设计器标志在 Initialize 前后各打一次，
		// 保证新复制出来的子控件也是设计时状态
		UUserWidget* Instance = NewObject<UUserWidget>(World, WidgetClass, NAME_None, RF_Transient);
		if (!Instance)
		{
			Error = TEXT("建不出控件实例");
			return false;
		}
		Instance->SetDesignerFlags(UELINK_UMG_DESIGN_FLAGS);
		Instance->Initialize();
		if (UWidgetTree* Tree = Instance->WidgetTree)
		{
			Tree->ForEachWidget([](UWidget* W)
			{
				if (W)
				{
					W->SetDesignerFlags(UELINK_UMG_DESIGN_FLAGS);
				}
			});
		}
		const FString AnimName = AgentPanel::Str(A, TEXT("anim"));
		if (!AnimName.IsEmpty())
		{
			FreezeAnim(BP, Instance, AnimName, FMath::Max(0.0, Num(A, TEXT("time"), 0.0)), Notes);
		}

		TSharedRef<SWidget> SlateWidget = Instance->TakeWidget();
		UTextureRenderTarget2D* Target = NewObject<UTextureRenderTarget2D>(GetTransientPackage(), NAME_None, RF_Transient);
		Target->ClearColor = FLinearColor::Transparent;
		// 8 位 BGRA、线性：渲染器做了 gamma 校正，读回来的就是屏幕上看到的颜色
		Target->InitCustomFormat(Width, Height, PF_B8G8R8A8, true);
		// InitCustomFormat 里已经建过资源；这里不用 UpdateResourceImmediately（用户的 5.4 引擎上 UTextureRenderTarget2D 没有这个成员，编不过），
		// 改用所有版本都有的 UTexture::UpdateResource，再等渲染线程把资源建好，下面 DrawWidget 才有目标可画
		Target->UpdateResource();
		FlushRenderingCommands();
		TArray<FColor> Pixels;
		{
			FWidgetRenderer Renderer(true, true);
			const FVector2D DrawSize(Width, Height);
			// 画两遍：第一遍让字体、图片和布局缓存就位，第二遍才是要的那一帧
			UELINK_DRAW_WIDGET(&Renderer, Target, SlateWidget, Dpi, DrawSize);
			UELINK_DRAW_WIDGET(&Renderer, Target, SlateWidget, Dpi, DrawSize);
			// 渲染线程画完再读，也保证 Renderer 析构时渲染线程不再用它
			FlushRenderingCommands();
			if (FTextureRenderTargetResource* Res = Target->GameThread_GetRenderTargetResource())
			{
				Res->ReadPixels(Pixels);
			}
		}
		TArray<TSharedPtr<FJsonValue>> Rects = WidgetRects(Instance);
		Instance->ReleaseSlateResources(true);
		if (Pixels.Num() != Width * Height)
		{
			Error = TEXT("读不回渲染结果（渲染目标没建出来），稍后再试");
			return false;
		}

		// 文件名、目录和 asset.preview 共用（AgentPanelEditorShared.h 的 SavePreviewPng）
		FString File;
		if (!AgentPanelEd::SavePreviewPng(BP, Width, Height, Pixels, File, Error))
		{
			return false;
		}
		Out->SetStringField(TEXT("file"), File);
		Out->SetNumberField(TEXT("width"), Width);
		Out->SetNumberField(TEXT("height"), Height);
		if (Rects.Num() == 0)
		{
			Notes.Add(TEXT("取不到控件的几何，widgets 为空"));
		}
		Out->SetArrayField(TEXT("widgets"), Rects);
		Out->SetNumberField(TEXT("ms"), FMath::RoundToDouble((FPlatformTime::Seconds() - Start) * 1000.0));
		if (Notes.Num() > 0)
		{
			Out->SetStringField(TEXT("note"), FString::Join(Notes, TEXT("；")).Left(1000));
		}
		return true;
	}
}

namespace UELinkUmgView
{
	void RegisterRenderOp()
	{
		FAgentPanelBridge::Get().AddOp(TEXT("umg.render"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			return UELinkUmgRenderImpl::Render(A, Out, Error);
		});
	}
}
