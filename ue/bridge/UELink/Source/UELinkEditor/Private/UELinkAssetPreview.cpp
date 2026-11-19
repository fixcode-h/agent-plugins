// 2.18：asset.preview，把静态网格、骨骼网格、材质、贴图、Actor 蓝图离屏渲染成 PNG（面板资源查看页的预览）。
// 先用编辑器自己的缩略图渲染（ThumbnailTools::RenderThumbnail，内容浏览器的缩略图就是它画的）实现，回包标 mode: thumbnail：
// 每类资源用 UE 现成的缩略图场景（材质画在资源缩略图设置的图元上，默认球；蓝图在缩略图场景里放组件），
// 不用自己搭预览场景、拼视图族，跨引擎版本最稳。代价是没有每个组件在图里的位置（components 不给）。
// 视角（view）临时改资源的缩略图设置（USceneThumbnailInfo 的 Orbit*），画完马上改回去，不标脏、不进事务。
// 图和 umg.render 一样写进 Saved/UELink/preview/，回包只给路径。
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture.h"
#include "GameFramework/Actor.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformTime.h"
#include "ImageUtils.h"
#include "Materials/MaterialInterface.h"
#include "Misc/App.h"
#include "Misc/Crc.h"
#include "Misc/FileHelper.h"
#include "Misc/ObjectThumbnail.h"
#include "Misc/Paths.h"
#include "ObjectTools.h"
#include "RHI.h"
#include "ThumbnailRendering/SceneThumbnailInfo.h"
#include "ThumbnailRendering/SceneThumbnailInfoWithPrimitive.h"
#include "ThumbnailRendering/ThumbnailManager.h"
#include "ThumbnailRendering/ThumbnailRenderer.h"
#include "UObject/UnrealType.h"
#include "WidgetBlueprint.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

namespace UELinkAssetPreviewImpl
{
	double Num(const TSharedPtr<FJsonObject>& A, const TCHAR* Key, double Default)
	{
		double V = 0;
		if (A.IsValid() && A->TryGetNumberField(Key, V))
		{
			return V;
		}
		return Default;
	}

	/** 给的是蓝图生成类（_C）或它的类默认对象时，换回蓝图资源；其他原样返回 */
	UObject* ToAsset(UObject* Obj)
	{
		UClass* Class = Cast<UClass>(Obj);
		if (!Class && Obj && Obj->HasAnyFlags(RF_ClassDefaultObject))
		{
			Class = Obj->GetClass();
		}
		if (Class)
		{
			if (UBlueprint* BP = UBlueprint::GetBlueprintFromClass(Class))
			{
				return BP;
			}
		}
		return Obj;
	}

	/** 支持的类型：返回种类名（回包的 kind）；不支持时返回空并写原因 */
	FString KindOf(UObject* Obj, FString& Error)
	{
		if (Obj->IsA<UStaticMesh>())
		{
			return TEXT("staticMesh");
		}
		if (Obj->IsA<USkeletalMesh>())
		{
			return TEXT("skeletalMesh");
		}
		if (Obj->IsA<UMaterialInterface>())
		{
			return TEXT("material");
		}
		if (Obj->IsA<UTexture>())
		{
			return TEXT("texture");
		}
		if (UBlueprint* BP = Cast<UBlueprint>(Obj))
		{
			if (BP->IsA<UWidgetBlueprint>())
			{
				Error = FString::Printf(TEXT("%s 是控件蓝图：用 umg.render 画控件预览"), *BP->GetName());
				return FString();
			}
			if (!BP->ParentClass || !BP->ParentClass->IsChildOf(AActor::StaticClass()))
			{
				Error = FString::Printf(TEXT("%s 不是 Actor 蓝图（父类 %s），没有能画的组件：只支持 Actor 蓝图"), *BP->GetName(), BP->ParentClass ? *BP->ParentClass->GetName() : TEXT("无"));
				return FString();
			}
			if (!BP->GeneratedClass)
			{
				Error = FString::Printf(TEXT("%s 还没有生成类：先在编辑器里编译这个蓝图"), *BP->GetName());
				return FString();
			}
			return TEXT("blueprint");
		}
		Error = FString::Printf(TEXT("%s 是 %s，不支持预览：只支持静态网格、骨骼网格、材质、贴图和 Actor 蓝图"), *Obj->GetName(), *Obj->GetClass()->GetName());
		return FString();
	}

	/** 网格、贴图还在异步编译时画出来是空的或半成品，直接让对方稍后再试 */
	bool IsCompiling(UObject* Obj)
	{
		if (const UStaticMesh* SM = Cast<UStaticMesh>(Obj))
		{
			return SM->IsCompiling();
		}
		if (const USkeletalMesh* SK = Cast<USkeletalMesh>(Obj))
		{
			return SK->IsCompiling();
		}
		if (const UTexture* Tex = Cast<UTexture>(Obj))
		{
			return Tex->IsCompiling();
		}
		return false;
	}

	/**
	 * 临时改资源的缩略图视角，析构时改回去。资源上没有缩略图设置时临时挂一个（Outer 是临时包，标 Transient），析构时摘掉；
	 * 只直接写属性，不调 Modify，不标脏、不进撤销。缩略图设置按反射找名叫 ThumbnailInfo 的对象属性：
	 * 网格、材质、蓝图都有（骨骼网格的是私有成员，反射照样读得到），贴图没有（贴图的视角本来也没意义）
	 */
	struct FViewOverride
	{
		UObject* Asset = nullptr;
		FObjectPropertyBase* Prop = nullptr;
		USceneThumbnailInfo* Info = nullptr;
		bool bTemp = false;
		float Yaw = 0.f;
		float Pitch = 0.f;
		float Zoom = 0.f;

		~FViewOverride()
		{
			if (!Info || !Prop || !IsValid(Asset))
			{
				return;
			}
			if (bTemp)
			{
				Prop->SetObjectPropertyValue_InContainer(Asset, nullptr);
				return;
			}
			Info->OrbitYaw = Yaw;
			Info->OrbitPitch = Pitch;
			Info->OrbitZoom = Zoom;
		}

		/** 套上视角；资源没有缩略图设置属性时返回 false（调用方写 note） */
		bool Apply(UObject* InAsset, const TSharedPtr<FJsonObject>& View)
		{
			Prop = FindFProperty<FObjectPropertyBase>(InAsset->GetClass(), TEXT("ThumbnailInfo"));
			if (!Prop)
			{
				return false;
			}
			Asset = InAsset;
			UObject* Current = Prop->GetObjectPropertyValue_InContainer(InAsset);
			Info = Cast<USceneThumbnailInfo>(Current);
			if (!Info)
			{
				if (Current)
				{
					// 有设置但不是场景缩略图设置（别的渲染器自定义的），不动它
					Prop = nullptr;
					return false;
				}
				// 材质的渲染器只认带图元的那种设置，其他认基类
				UClass* InfoClass = InAsset->IsA<UMaterialInterface>() ? USceneThumbnailInfoWithPrimitive::StaticClass() : USceneThumbnailInfo::StaticClass();
				if (!Prop->PropertyClass || !InfoClass->IsChildOf(Prop->PropertyClass))
				{
					Prop = nullptr;
					return false;
				}
				Info = NewObject<USceneThumbnailInfo>(GetTransientPackage(), InfoClass, NAME_None, RF_Transient);
				if (!Info)
				{
					Prop = nullptr;
					return false;
				}
				bTemp = true;
				Prop->SetObjectPropertyValue_InContainer(InAsset, Info);
			}
			else
			{
				Yaw = Info->OrbitYaw;
				Pitch = Info->OrbitPitch;
				Zoom = Info->OrbitZoom;
			}
			// 没给的分量沿用资源自己的设置（或 UE 的默认值）
			Info->OrbitYaw = static_cast<float>(FMath::Clamp(Num(View, TEXT("yaw"), Info->OrbitYaw), -360.0, 360.0));
			Info->OrbitPitch = static_cast<float>(FMath::Clamp(Num(View, TEXT("pitch"), Info->OrbitPitch), -90.0, 90.0));
			Info->OrbitZoom = static_cast<float>(FMath::Clamp(Num(View, TEXT("distance"), Info->OrbitZoom), -100000.0, 100000.0));
			return true;
		}
	};

	bool Preview(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const double Start = FPlatformTime::Seconds();
		// RenderThumbnail 里有 check(GIsRHIInitialized)：没渲染器的进程必须在这里挡住，否则编辑器直接崩
		if (IsRunningCommandlet() || !FApp::CanEverRender() || !GIsRHIInitialized || !GEditor)
		{
			Error = TEXT("这个进程画不了资源预览（后台编辑器、不渲染的进程里没有渲染器）：在打开的编辑器里再试");
			return false;
		}
		const FString Path = Str(A, TEXT("path"));
		if (Path.IsEmpty())
		{
			Error = TEXT("要给 path（资源路径，如 /Game/Props/SM_Box）");
			return false;
		}
		UObject* Loaded = LoadAsset(Path, Error);
		if (!Loaded)
		{
			return false;
		}
		UObject* Asset = ToAsset(Loaded);
		const FString Kind = KindOf(Asset, Error);
		if (Kind.IsEmpty())
		{
			return false;
		}
		if (IsCompiling(Asset))
		{
			Error = FString::Printf(TEXT("%s 还在编译（网格或贴图的异步编译没做完），稍后再试"), *Asset->GetName());
			return false;
		}
		FThumbnailRenderingInfo* RenderInfo = UThumbnailManager::Get().GetRenderingInfo(Asset);
		if (!RenderInfo || !RenderInfo->Renderer)
		{
			Error = FString::Printf(TEXT("编辑器里没有能画 %s（%s）的缩略图渲染器"), *Asset->GetName(), *Asset->GetClass()->GetName());
			return false;
		}
		if (!RenderInfo->Renderer->CanVisualizeAsset(Asset))
		{
			Error = Kind == TEXT("blueprint")
				? FString::Printf(TEXT("%s 没有能画出来的组件（没有网格之类的可见组件，或蓝图编译出错）"), *Asset->GetName())
				: FString::Printf(TEXT("%s 现在画不出来（资源数据不完整？在编辑器里打开看看）"), *Asset->GetName());
			return false;
		}

		const int32 Width = FMath::Clamp(Int(A, TEXT("width"), 512), 16, 2048);
		const int32 Height = FMath::Clamp(Int(A, TEXT("height"), 512), 16, 2048);
		TArray<FString> Notes;
		if (UBlueprint* BP = Cast<UBlueprint>(Asset))
		{
			if (BP->Status == BS_Dirty)
			{
				Notes.Add(TEXT("蓝图有没编译的改动，预览是上次编译的结果"));
			}
		}
		if (A.IsValid() && A->HasField(TEXT("select")))
		{
			Notes.Add(TEXT("缩略图模式不支持高亮组件，select 没生效"));
		}

		TArray<FColor> Pixels;
		{
			FViewOverride ViewOverride;
			const TSharedPtr<FJsonObject>* View = nullptr;
			if (A.IsValid() && A->TryGetObjectField(TEXT("view"), View) && View && View->IsValid())
			{
				if (Kind == TEXT("texture"))
				{
					Notes.Add(TEXT("贴图没有视角，view 没生效"));
				}
				else if (!ViewOverride.Apply(Asset, *View))
				{
					Notes.Add(TEXT("这个资源的缩略图设置改不了视角，按默认视角画"));
				}
			}
			FObjectThumbnail Thumb;
			// RenderThumbnail 自己也会设尺寸；先设一次，免得它按 0×0 读回
			Thumb.SetImageSize(Width, Height);
			UELINK_RENDER_THUMBNAIL(Asset, Width, Height, &Thumb);
			const TArray<uint8>& Raw = UELINK_THUMB_PIXELS(Thumb);
			// 缩略图像素是 BGRA 字节，和 FColor 的内存布局一致
			if (Raw.Num() == Width * Height * 4)
			{
				Pixels.SetNumUninitialized(Width * Height);
				FMemory::Memcpy(Pixels.GetData(), Raw.GetData(), Raw.Num());
			}
		}
		if (Pixels.Num() != Width * Height)
		{
			Error = TEXT("读不回渲染结果（缩略图渲染没出图），稍后再试");
			return false;
		}
		// 场景渲染读回来的透明通道不可靠（常常是 0，整张图透明），缩略图本来就是不透明的底，统一当不透明
		for (FColor& C : Pixels)
		{
			C.A = 255;
		}
		FString File;
		if (!SavePreviewPng(Asset, Width, Height, Pixels, File, Error))
		{
			return false;
		}
		Out->SetStringField(TEXT("file"), File);
		Out->SetNumberField(TEXT("width"), Width);
		Out->SetNumberField(TEXT("height"), Height);
		Out->SetStringField(TEXT("kind"), Kind);
		Out->SetStringField(TEXT("mode"), TEXT("thumbnail"));
		Out->SetNumberField(TEXT("ms"), FMath::RoundToDouble((FPlatformTime::Seconds() - Start) * 1000.0));
		if (Notes.Num() > 0)
		{
			Out->SetStringField(TEXT("note"), FString::Join(Notes, TEXT("；")).Left(1000));
		}
		return true;
	}
}

namespace AgentPanelEd
{
	bool SavePreviewPng(const UObject* Asset, int32 Width, int32 Height, const TArray<FColor>& Pixels, FString& OutFile, FString& Error)
	{
		if (!Asset || Pixels.Num() != Width * Height)
		{
			Error = TEXT("预览图的像素数和尺寸对不上，没写文件");
			return false;
		}
		TArray64<uint8> Png;
		FImageUtils::PNGCompressImageArray(Width, Height, TArrayView64<const FColor>(Pixels.GetData(), Pixels.Num()), Png);
		const TArray<uint8> Bytes(Png.GetData(), static_cast<int32>(Png.Num()));
		// 文件名带资产名，同名资产（不同目录）按路径的 CRC 区分；同一个资产覆盖旧图
		const FString Dir = FPaths::Combine(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()), TEXT("UELink"), TEXT("preview"));
		IFileManager::Get().MakeDirectory(*Dir, true);
		OutFile = FPaths::Combine(Dir, FString::Printf(TEXT("%s-%08x.png"), *Asset->GetName(), FCrc::StrCrc32(*Asset->GetPathName())));
		if (Bytes.Num() == 0 || !FFileHelper::SaveArrayToFile(Bytes, *OutFile))
		{
			Error = FString::Printf(TEXT("预览图写不进 %s（磁盘满或文件被占用？）"), *OutFile);
			return false;
		}
		return true;
	}

	void RegisterAssetPreviewOps()
	{
		FAgentPanelBridge::Get().AddOp(TEXT("asset.preview"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			return UELinkAssetPreviewImpl::Preview(A, Out, Error);
		});
	}
}
