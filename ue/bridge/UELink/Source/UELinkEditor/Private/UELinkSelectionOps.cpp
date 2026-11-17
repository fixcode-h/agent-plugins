// 2.4：编辑器选中同步（设计稿「UE 插件优化与扩展」二 P0）。用户说「看看我选中的这个」时，面板和 Agent 能知道是哪个：
// - editor.selection：关卡里选中的 Actor、内容浏览器选中的资源和文件夹、最近激活的蓝图编辑器里选中的节点
// - editor.select：反方向，在编辑器里选中并对焦 Actor、在内容浏览器里定位资源
// - 关卡选中、内容浏览器选中变化时推 uelink.selection（最多每 0.3 秒一次），网页跟随不用轮询
// 只读编辑器公开的选中集合（USelection、IContentBrowserSingleton、FBlueprintEditor::GetSelectedNodes），不加载资源。
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "BlueprintEditor.h"
#include "Containers/Ticker.h"
#include "ContentBrowserModule.h"
#include "Editor.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "Engine/Blueprint.h"
#include "Engine/Selection.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "IContentBrowserSingleton.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "Subsystems/AssetEditorSubsystem.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

namespace UELinkSelection
{
	constexpr int32 MaxItems = 50;

	IContentBrowserSingleton* ContentBrowser()
	{
		if (!FModuleManager::Get().IsModuleLoaded(TEXT("ContentBrowser")))
		{
			return nullptr;
		}
		return &FModuleManager::GetModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser")).Get();
	}

	/** 关卡、内容浏览器的选中（推送事件和 editor.selection 共用；蓝图节点另算，见 BlueprintSelection） */
	TSharedRef<FJsonObject> Selection()
	{
		TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
		TArray<TSharedPtr<FJsonValue>> Actors;
		int32 ActorCount = 0;
		if (GEditor)
		{
			if (USelection* Sel = GEditor->GetSelectedActors())
			{
				for (FSelectionIterator It(*Sel); It; ++It)
				{
					AActor* Actor = Cast<AActor>(*It);
					if (!IsValid(Actor))
					{
						continue;
					}
					++ActorCount;
					if (Actors.Num() >= MaxItems)
					{
						continue;
					}
					TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
					O->SetStringField(TEXT("path"), Actor->GetPathName());
					O->SetStringField(TEXT("name"), Actor->GetName());
					O->SetStringField(TEXT("label"), Actor->GetActorLabel());
					O->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
					O->SetStringField(TEXT("world"), FAgentPanelBridge::WorldId(Actor->GetWorld()));
					Actors.Add(JObj(O));
				}
			}
		}
		Out->SetArrayField(TEXT("actors"), Actors);
		Out->SetNumberField(TEXT("actorCount"), ActorCount);
		TArray<TSharedPtr<FJsonValue>> Assets;
		TArray<TSharedPtr<FJsonValue>> Folders;
		if (IContentBrowserSingleton* CB = ContentBrowser())
		{
			TArray<FAssetData> Selected;
			CB->GetSelectedAssets(Selected);
			for (const FAssetData& D : Selected)
			{
				if (Assets.Num() >= MaxItems)
				{
					break;
				}
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("path"), D.GetObjectPathString());
				O->SetStringField(TEXT("name"), D.AssetName.ToString());
				O->SetStringField(TEXT("class"), D.AssetClassPath.GetAssetName().ToString());
				Assets.Add(JObj(O));
			}
			TArray<FString> SelFolders;
			CB->GetSelectedFolders(SelFolders);
			for (const FString& F : SelFolders)
			{
				if (Folders.Num() >= MaxItems)
				{
					break;
				}
				// 内容浏览器给的是虚拟路径（/All/Game/...），去掉 /All 和 /Game 对齐
				FString Path = F;
				Path.RemoveFromStart(TEXT("/All"));
				Folders.Add(JStr(Path));
			}
		}
		Out->SetArrayField(TEXT("assets"), Assets);
		Out->SetArrayField(TEXT("folders"), Folders);
		return Out;
	}

	/** 最近激活的蓝图编辑器（含控件、动画蓝图编辑器）：打开的蓝图、当前图表、选中的节点 */
	TSharedPtr<FJsonObject> BlueprintSelection()
	{
		UAssetEditorSubsystem* Editors = GEditor ? GEditor->GetEditorSubsystem<UAssetEditorSubsystem>() : nullptr;
		if (!Editors)
		{
			return nullptr;
		}
		FBlueprintEditor* Best = nullptr;
		UBlueprint* BestBP = nullptr;
		double BestTime = -1;
		for (UObject* Asset : Editors->GetAllEditedAssets())
		{
			UBlueprint* BP = Cast<UBlueprint>(Asset);
			IAssetEditorInstance* Inst = BP ? Editors->FindEditorForAsset(BP, false) : nullptr;
			// 只认蓝图编辑器一族（BlueprintEditor、WidgetBlueprintEditor、AnimationBlueprintEditor……都派生自 FBlueprintEditor）
			if (!Inst || !Inst->GetEditorName().ToString().Contains(TEXT("BlueprintEditor")))
			{
				continue;
			}
			if (Inst->GetLastActivationTime() > BestTime)
			{
				BestTime = Inst->GetLastActivationTime();
				Best = static_cast<FBlueprintEditor*>(Inst);
				BestBP = BP;
			}
		}
		if (!Best || !BestBP)
		{
			return nullptr;
		}
		TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
		Out->SetStringField(TEXT("path"), BestBP->GetPathName());
		if (UEdGraph* Graph = Best->GetFocusedGraph())
		{
			Out->SetStringField(TEXT("graph"), Graph->GetName());
		}
		TArray<TSharedPtr<FJsonValue>> Nodes;
		for (UObject* N : Best->GetSelectedNodes())
		{
			const UEdGraphNode* Node = Cast<UEdGraphNode>(N);
			if (!Node || Nodes.Num() >= MaxItems)
			{
				continue;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("id"), NodeId(Node));
			O->SetStringField(TEXT("title"), NodeTitle(Node));
			Nodes.Add(JObj(O));
		}
		Out->SetArrayField(TEXT("nodes"), Nodes);
		return Out;
	}

	// ---------- 推送 ----------

	bool bDirty = false;
	FTSTicker::FDelegateHandle Tick;
	FDelegateHandle SelChanged;
	FDelegateHandle SelObject;
	FDelegateHandle CbChanged;
	FDelegateHandle CbPath;

	void MarkDirty()
	{
		bDirty = true;
	}

	bool Flush(float)
	{
		if (bDirty)
		{
			bDirty = false;
			FAgentPanelBridge::Get().PublishEvent(TEXT("uelink.selection"), Selection());
		}
		return true;
	}
}

void AgentPanelEd::RegisterSelectionOps()
{
	FAgentPanelBridge& B = FAgentPanelBridge::Get();

	B.AddOp(TEXT("editor.selection"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		if (!GEditor)
		{
			Error = TEXT("这个进程不是编辑器，没有选中");
			return false;
		}
		const TSharedRef<FJsonObject> Sel = UELinkSelection::Selection();
		for (const auto& Pair : Sel->Values)
		{
			Out->SetField(UELINK_JSON_KEY(Pair.Key), Pair.Value);
		}
		if (const TSharedPtr<FJsonObject> BP = UELinkSelection::BlueprintSelection())
		{
			Out->SetObjectField(TEXT("blueprint"), BP);
		}
		return true;
	});

	B.AddOp(TEXT("editor.select"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		if (!GEditor)
		{
			Error = TEXT("这个进程不是编辑器，选不了");
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Missing;
		const TArray<TSharedPtr<FJsonValue>>* ActorPaths = nullptr;
		int32 ActorsDone = 0;
		if (A->TryGetArrayField(TEXT("actors"), ActorPaths) && ActorPaths->Num() > 0)
		{
			TArray<AActor*> Actors;
			for (const TSharedPtr<FJsonValue>& P : *ActorPaths)
			{
				FString Ignore;
				AActor* Actor = Cast<AActor>(FindObjectByPath(P->AsString(), false, Ignore));
				if (IsValid(Actor))
				{
					Actors.Add(Actor);
				}
				else
				{
					Missing.Add(JStr(P->AsString()));
				}
			}
			if (Actors.Num())
			{
				GEditor->SelectNone(false, true, false);
				for (AActor* Actor : Actors)
				{
					GEditor->SelectActor(Actor, true, false, true);
				}
				GEditor->NoteSelectionChange();
				if (Bool(A, TEXT("focus"), true))
				{
					GEditor->MoveViewportCamerasToActor(Actors, false);
				}
				ActorsDone = Actors.Num();
			}
		}
		const TArray<TSharedPtr<FJsonValue>>* AssetPaths = nullptr;
		int32 AssetsDone = 0;
		if (A->TryGetArrayField(TEXT("assets"), AssetPaths) && AssetPaths->Num() > 0)
		{
			TArray<FAssetData> Found;
			IAssetRegistry& Registry = IAssetRegistry::GetChecked();
			for (const TSharedPtr<FJsonValue>& P : *AssetPaths)
			{
				FString Path = P->AsString();
				// /Game/A/B 补成对象路径 /Game/A/B.B
				if (!Path.Contains(TEXT(".")))
				{
					Path += TEXT(".") + FPaths::GetBaseFilename(Path);
				}
				const FAssetData D = Registry.GetAssetByObjectPath(FSoftObjectPath(Path));
				if (D.IsValid())
				{
					Found.Add(D);
				}
				else
				{
					Missing.Add(JStr(P->AsString()));
				}
			}
			IContentBrowserSingleton* CB = UELinkSelection::ContentBrowser();
			if (Found.Num() && CB)
			{
				CB->SyncBrowserToAssets(Found);
				AssetsDone = Found.Num();
			}
		}
		if (ActorsDone == 0 && AssetsDone == 0 && Missing.Num() == 0)
		{
			Error = TEXT("要给 actors（Actor 路径）或 assets（资源路径）");
			return false;
		}
		Out->SetNumberField(TEXT("actors"), ActorsDone);
		Out->SetNumberField(TEXT("assets"), AssetsDone);
		Out->SetArrayField(TEXT("missing"), Missing);
		return true;
	});
}

void AgentPanelEd::StartSelectionPush()
{
	using namespace UELinkSelection;
	if (!GEditor || !GIsEditor || IsRunningCommandlet() || Tick.IsValid())
	{
		return;
	}
	SelChanged = USelection::SelectionChangedEvent.AddLambda([](UObject*) { MarkDirty(); });
	SelObject = USelection::SelectObjectEvent.AddLambda([](UObject*) { MarkDirty(); });
	FContentBrowserModule& CB = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));
	CbChanged = CB.GetOnAssetSelectionChanged().AddLambda([](const TArray<FAssetData>&, bool) { MarkDirty(); });
	CbPath = CB.GetOnAssetPathChanged().AddLambda([](const FString&) { MarkDirty(); });
	Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Flush), 0.3f);
}

void AgentPanelEd::StopSelectionPush()
{
	using namespace UELinkSelection;
	if (!Tick.IsValid())
	{
		return;
	}
	FTSTicker::GetCoreTicker().RemoveTicker(Tick);
	Tick.Reset();
	USelection::SelectionChangedEvent.Remove(SelChanged);
	USelection::SelectObjectEvent.Remove(SelObject);
	if (FContentBrowserModule* CB = FModuleManager::GetModulePtr<FContentBrowserModule>(TEXT("ContentBrowser")))
	{
		CB->GetOnAssetSelectionChanged().Remove(CbChanged);
		CB->GetOnAssetPathChanged().Remove(CbPath);
	}
}
