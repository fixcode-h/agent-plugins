// 编辑器里打开 / 切换地图（2.22.0）：
//   editor.map {"action": "status"}                                   当前编辑器地图、没保存的关卡改动、正在打开 / 上一次打开的结果
//   editor.map {"action": "open", "map", "unsaved"?: "error"|"discard"} 下一帧在编辑器里打开地图，马上回 started
// 为什么不用控制台 open：编辑器世界里的 open 立刻回「成功」，真正换没换图、有没有弹保存对话框都不知道，
// Agent 只能 sleep 再反复查状态、日志、截图（2026-11-25 碰杯玩法实测，最后是用户自己换的图）。
// 这里调关卡编辑器「打开关卡」同一个入口（FEditorFileUtils::LoadMap）：有没保存的关卡改动先拒绝或按要求丢弃，
// 加载时压住模态对话框。pie 操作的 map 参数（只在 PIE 里玩那张图、不换编辑器的图）也用这里的找地图。加载会卡住编辑器主线程，所以放到下一帧做；客户端随后调 status 等结果
// （加载期间的 HTTP 请求要等加载完才回，回来时 last 里就是结果）。PIE 运行中拒绝，客户端先停 PIE。
#include "UELinkCompat.h"
#include "AgentPanelEditorShared.h"

#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Containers/Ticker.h"
#include "CoreGlobals.h"
#include "Editor.h"
#include "Editor/EditorEngine.h"
#include "Engine/World.h"
#include "FileHelpers.h"
#include "HAL/PlatformTime.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "Templates/UnrealTemplate.h"
#include "UObject/Package.h"
#include "UObject/UObjectIterator.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

// 不用匿名命名空间：单体编译时和别的文件的同名小函数会撞
namespace UELinkMapOps
{
	/** 正在打开 / 上一次打开地图的结果（只在编辑器主线程读写） */
	struct FMapLoad
	{
		FString Package;
		FString Previous;
		bool bPending = false;
		bool bDone = false;
		bool bOk = false;
		FString Error;
		double StartedAt = 0;
		double Ms = 0;
	};

	FMapLoad& LastLoad()
	{
		static FMapLoad State;
		return State;
	}

	FString CurrentMapPackage()
	{
		UWorld* World = GEditor ? GEditor->GetEditorWorldContext().World() : nullptr;
		return World ? World->GetOutermost()->GetName() : FString();
	}

	bool PieRunning()
	{
		return GEditor && (GEditor->PlayWorld != nullptr || GEditor->IsPlaySessionRequestQueued());
	}

	/** 关卡相关的包：放着关卡的包（含子关卡）和 World Partition 的外部 Actor / 外部对象包 */
	bool IsLevelPackage(UPackage* Pkg)
	{
		const FString Name = Pkg->GetName();
		if (Name.Contains(TEXT("/__ExternalActors__/")) || Name.Contains(TEXT("/__ExternalObjects__/")))
		{
			return true;
		}
		return UWorld::FindWorldInPackage(Pkg) != nullptr;
	}

	/** 改了没保存的关卡包：临时包（/Temp、PIE 复制出来的世界）不算 */
	TArray<UPackage*> DirtyLevelPackages()
	{
		TArray<UPackage*> Out;
		for (TObjectIterator<UPackage> It; It; ++It)
		{
			UPackage* Pkg = *It;
			if (!Pkg || !Pkg->IsDirty() || Pkg == GetTransientPackage())
			{
				continue;
			}
			const FString Name = Pkg->GetName();
			if (Name.StartsWith(TEXT("/Temp/")) || Name.StartsWith(TEXT("/Engine/Transient")) || Name.Contains(TEXT("UEDPIE_")))
			{
				continue;
			}
			if (IsLevelPackage(Pkg))
			{
				Out.Add(Pkg);
			}
		}
		return Out;
	}

	TArray<TSharedPtr<FJsonValue>> PackageNames(const TArray<UPackage*>& Pkgs, int32 Max)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (UPackage* Pkg : Pkgs)
		{
			if (Out.Num() >= Max)
			{
				break;
			}
			Out.Add(MakeShared<FJsonValueString>(Pkg->GetName()));
		}
		return Out;
	}

	/** 包名对应的地图文件；不存在或不是地图时返回 false 写 Error */
	bool MapFileOf(const FString& Package, FString& OutFile, FString& Error)
	{
		if (!FPackageName::IsValidLongPackageName(Package) || !FPackageName::DoesPackageExist(Package, &OutFile))
		{
			Error = FString::Printf(TEXT("找不到地图 %s：包名要写成 /Game/... 的形式，或者只写地图名让 UELink 去找"), *Package);
			return false;
		}
		if (!OutFile.EndsWith(FPackageName::GetMapPackageExtension()))
		{
			Error = FString::Printf(TEXT("%s 不是地图（%s），要打开的是 .umap"), *Package, *FPaths::GetCleanFilename(OutFile));
			return false;
		}
		OutFile = FPaths::ConvertRelativePathToFull(OutFile);
		return true;
	}

	/**
	 * map 参数换成地图包名：包名、对象路径（/Game/A/B.B）、.umap 文件路径直接用；
	 * 只写地图名或路径的结尾（QuestMain/QuestMain_P_Free）时在资源注册表里找 World，同名的有几张就报出候选让客户端写全
	 */
	bool ResolveMap(const FString& In, FString& OutPackage, FString& OutFile, FString& Error)
	{
		FString Map = In.TrimStartAndEnd();
		Map.ReplaceInline(TEXT("\\"), TEXT("/"));
		if (Map.IsEmpty())
		{
			Error = TEXT("没写 map：写地图名（QuestMain_P_Free）、包名（/Game/Maps/.../QuestMain_P_Free）或 .umap 文件路径");
			return false;
		}
		if (Map.EndsWith(FPackageName::GetMapPackageExtension()))
		{
			FString Long;
			Map = FPackageName::TryConvertFilenameToLongPackageName(Map, Long) ? Long : FPaths::GetBaseFilename(Map);
		}
		if (Map.StartsWith(TEXT("/")))
		{
			int32 Dot = INDEX_NONE;
			if (Map.FindChar(TEXT('.'), Dot))
			{
				Map.LeftInline(Dot);
			}
			OutPackage = Map;
			return MapFileOf(Map, OutFile, Error);
		}
		IAssetRegistry& Registry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
		TArray<FAssetData> Worlds;
		Registry.GetAssetsByClass(UWorld::StaticClass()->GetClassPathName(), Worlds, false);
		const FString Tail = TEXT("/") + Map;
		TArray<FString> Hits;
		for (const FAssetData& Data : Worlds)
		{
			const FString Pkg = Data.PackageName.ToString();
			if (Pkg.EndsWith(Tail, ESearchCase::IgnoreCase))
			{
				Hits.AddUnique(Pkg);
			}
		}
		if (Hits.Num() == 0)
		{
			Error = Registry.IsLoadingAssets()
				? FString::Printf(TEXT("资源注册表还在扫描，暂时没找到地图 %s：等编辑器就绪后再试，或写全包名 /Game/..."), *Map)
				: FString::Printf(TEXT("项目里没有叫 %s 的地图：用 ue_asset 按 class=World 搜一下，写全包名 /Game/..."), *Map);
			return false;
		}
		if (Hits.Num() > 1)
		{
			Hits.Sort();
			TArray<FString> Shown;
			for (int32 i = 0; i < Hits.Num() && i < 10; ++i)
			{
				Shown.Add(Hits[i]);
			}
			Error = FString::Printf(TEXT("有 %d 张地图叫 %s，写全包名再开：%s"), Hits.Num(), *Map, *FString::Join(Shown, TEXT("、")));
			return false;
		}
		OutPackage = Hits[0];
		return MapFileOf(OutPackage, OutFile, Error);
	}

	/** 下一帧真正打开：LoadMap 会卡住主线程直到加载完 */
	void DoLoad(const FString& File)
	{
		FMapLoad& L = LastLoad();
		{
			// 压住加载中的模态对话框（保存提示、缺资源提示）：和 Python LevelEditorSubsystem.load_level 同一做法，
			// 弹出来没人点，编辑器就一直卡着
			TGuardValue<bool> Unattended(GIsRunningUnattendedScript, true);
			FEditorFileUtils::LoadMap(File, false, true);
		}
		L.bPending = false;
		L.bDone = true;
		L.Ms = (FPlatformTime::Seconds() - L.StartedAt) * 1000.0;
		const FString Now = CurrentMapPackage();
		L.bOk = Now == L.Package;
		if (!L.bOk)
		{
			L.Error = FString::Printf(TEXT("没打开 %s，编辑器现在是 %s：看一下输出日志里 LogFileHelpers / LogEditorFileUtils 的报错"),
				*L.Package, Now.IsEmpty() ? TEXT("（没有地图）") : *Now);
		}
	}

	void WriteStatus(TSharedPtr<FJsonObject>& Out)
	{
		const FString Current = CurrentMapPackage();
		Out->SetStringField(TEXT("package"), Current);
		Out->SetStringField(TEXT("map"), FPackageName::GetShortName(Current));
		Out->SetBoolField(TEXT("pie"), PieRunning());
		const TArray<UPackage*> Dirty = DirtyLevelPackages();
		if (Dirty.Num() > 0)
		{
			Out->SetArrayField(TEXT("dirty"), PackageNames(Dirty, 50));
			Out->SetNumberField(TEXT("dirtyCount"), Dirty.Num());
		}
		const FMapLoad& L = LastLoad();
		if (L.bPending)
		{
			Out->SetBoolField(TEXT("loading"), true);
		}
		if (L.bPending || L.bDone)
		{
			TSharedPtr<FJsonObject> Last = MakeShared<FJsonObject>();
			Last->SetStringField(TEXT("package"), L.Package);
			Last->SetStringField(TEXT("previous"), L.Previous);
			if (L.bDone)
			{
				Last->SetBoolField(TEXT("ok"), L.bOk);
				Last->SetNumberField(TEXT("ms"), FMath::RoundToInt(L.Ms));
				if (!L.Error.IsEmpty())
				{
					Last->SetStringField(TEXT("error"), L.Error);
				}
			}
			Out->SetObjectField(TEXT("last"), Last);
		}
	}

	bool Open(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FMapLoad& L = LastLoad();
		if (L.bPending)
		{
			Error = FString::Printf(TEXT("正在打开 %s：等它打开完（editor.map status）再开别的"), *L.Package);
			return false;
		}
		if (PieRunning())
		{
			Error = TEXT("PIE 正在运行：先停掉 PIE 再打开地图");
			return false;
		}
		FString Package;
		FString File;
		if (!ResolveMap(Str(A, TEXT("map")), Package, File, Error))
		{
			return false;
		}
		const FString Current = CurrentMapPackage();
		Out->SetStringField(TEXT("package"), Package);
		Out->SetStringField(TEXT("previous"), Current);
		if (Current == Package && !Bool(A, TEXT("reload"), false))
		{
			Out->SetBoolField(TEXT("already"), true);
			Out->SetBoolField(TEXT("started"), false);
			return true;
		}
		const TArray<UPackage*> Dirty = DirtyLevelPackages();
		if (Dirty.Num() > 0)
		{
			if (Str(A, TEXT("unsaved"), TEXT("error")) != TEXT("discard"))
			{
				TArray<FString> Names;
				for (int32 i = 0; i < Dirty.Num() && i < 10; ++i)
				{
					Names.Add(Dirty[i]->GetName());
				}
				Error = FString::Printf(TEXT("当前关卡有 %d 个包改了没保存（%s）：要留着就先保存，不要了用 unsaved=discard 丢掉再打开"),
					Dirty.Num(), *FString::Join(Names, TEXT("、")));
				return false;
			}
			// 丢掉改动：清掉脏标记，LoadMap 卸载旧世界时就不会再问要不要保存
			for (UPackage* Pkg : Dirty)
			{
				Pkg->SetDirtyFlag(false);
			}
			Out->SetArrayField(TEXT("discarded"), PackageNames(Dirty, 50));
		}
		L = FMapLoad();
		L.Package = Package;
		L.Previous = Current;
		L.bPending = true;
		L.StartedAt = FPlatformTime::Seconds();
		const FString FileCopy = File;
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([FileCopy](float) -> bool
		{
			DoLoad(FileCopy);
			return false;
		}));
		Out->SetBoolField(TEXT("started"), true);
		return true;
	}
}

bool AgentPanelEd::MapLoading()
{
	return UELinkMapOps::LastLoad().bPending;
}

bool AgentPanelEd::ResolveMapPackage(const FString& In, FString& OutPackage, FString& Error)
{
	FString File;
	return UELinkMapOps::ResolveMap(In, OutPackage, File, Error);
}

void AgentPanelEd::RegisterMapOps()
{
	FAgentPanelBridge& B = FAgentPanelBridge::Get();
	B.AddOp(TEXT("editor.map"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		if (!GEditor || IsRunningCommandlet())
		{
			Error = TEXT("这个进程不是编辑器：在 UE 编辑器里才能打开地图（后台编辑器没有关卡编辑器）");
			return false;
		}
		const FString Action = Str(A, TEXT("action"), TEXT("status"));
		if (Action == TEXT("status"))
		{
			UELinkMapOps::WriteStatus(Out);
			return true;
		}
		if (Action == TEXT("open"))
		{
			return UELinkMapOps::Open(A, Out, Error);
		}
		Error = TEXT("action 只能是 status 或 open");
		return false;
	});
}
