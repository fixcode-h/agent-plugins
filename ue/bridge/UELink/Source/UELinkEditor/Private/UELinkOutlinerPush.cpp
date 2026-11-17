// 世界大纲的变化推送：Actor 增删、挂接、换文件夹、关卡加载卸载时记下是哪个世界变了，最多每 0.5 秒推一次
// uelink.outliner 事件 {worlds: [...]}。事件不带数据，网页收到后重读 outliner（只有名字和层级，很便宜），
// 这样不用轮询，PIE 里大量生成子弹之类也只是每 0.5 秒一次。没人订阅时 PublishEvent 什么都不做
#include "AgentPanelBridge.h"
#include "AgentPanelEditorShared.h"

#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

// 用具名命名空间、调用处写全名：单体构建（unity）会把同模块的 .cpp 拼在一起，匿名命名空间里的 Tick、Flush
// 和 UELinkSelectionOps.cpp 的 UELinkSelection::Tick、Flush 撞名（5.4 上实际报过 C2872「不明确的符号」）
namespace UELinkOutlinerPush
{
	TSet<FString> DirtyWorlds;
	bool bAllDirty = false;
	FTSTicker::FDelegateHandle Tick;
	TArray<FDelegateHandle> Hooks;

	void Mark(const AActor* Actor)
	{
		const UWorld* World = Actor ? Actor->GetWorld() : nullptr;
		if (World)
		{
			DirtyWorlds.Add(FAgentPanelBridge::WorldId(World));
		}
	}

	bool Flush(float)
	{
		if (!bAllDirty && DirtyWorlds.Num() == 0)
		{
			return true;
		}
		TSharedRef<FJsonObject> E = MakeShared<FJsonObject>();
		TArray<TSharedPtr<FJsonValue>> Worlds;
		for (const FString& W : DirtyWorlds)
		{
			Worlds.Add(MakeShared<FJsonValueString>(W));
		}
		E->SetArrayField(TEXT("worlds"), Worlds);
		// 关卡列表变了（加载卸载子关卡、开始结束 PIE）分不清是哪个世界，all 让网页都重读
		E->SetBoolField(TEXT("all"), bAllDirty);
		DirtyWorlds.Reset();
		bAllDirty = false;
		FAgentPanelBridge::Get().PublishEvent(TEXT("uelink.outliner"), E);
		return true;
	}
}

void AgentPanelEd::StartOutlinerPush()
{
	if (!GEngine || !GIsEditor || IsRunningCommandlet() || UELinkOutlinerPush::Tick.IsValid())
	{
		return;
	}
	UELinkOutlinerPush::Hooks.Add(GEngine->OnLevelActorAdded().AddLambda([](AActor* A) { UELinkOutlinerPush::Mark(A); }));
	UELinkOutlinerPush::Hooks.Add(GEngine->OnLevelActorDeleted().AddLambda([](AActor* A) { UELinkOutlinerPush::Mark(A); }));
	UELinkOutlinerPush::Hooks.Add(GEngine->OnLevelActorAttached().AddLambda([](AActor* A, const AActor*) { UELinkOutlinerPush::Mark(A); }));
	UELinkOutlinerPush::Hooks.Add(GEngine->OnLevelActorDetached().AddLambda([](AActor* A, const AActor*) { UELinkOutlinerPush::Mark(A); }));
	UELinkOutlinerPush::Hooks.Add(GEngine->OnLevelActorFolderChanged().AddLambda([](const AActor* A, FName) { UELinkOutlinerPush::Mark(A); }));
	UELinkOutlinerPush::Hooks.Add(GEngine->OnLevelActorListChanged().AddLambda([]() { UELinkOutlinerPush::bAllDirty = true; }));
	UELinkOutlinerPush::Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&UELinkOutlinerPush::Flush), 0.5f);
}

void AgentPanelEd::StopOutlinerPush()
{
	if (UELinkOutlinerPush::Tick.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(UELinkOutlinerPush::Tick);
		UELinkOutlinerPush::Tick.Reset();
	}
	if (GEngine)
	{
		GEngine->OnLevelActorAdded().Remove(UELinkOutlinerPush::Hooks.IsValidIndex(0) ? UELinkOutlinerPush::Hooks[0] : FDelegateHandle());
		GEngine->OnLevelActorDeleted().Remove(UELinkOutlinerPush::Hooks.IsValidIndex(1) ? UELinkOutlinerPush::Hooks[1] : FDelegateHandle());
		GEngine->OnLevelActorAttached().Remove(UELinkOutlinerPush::Hooks.IsValidIndex(2) ? UELinkOutlinerPush::Hooks[2] : FDelegateHandle());
		GEngine->OnLevelActorDetached().Remove(UELinkOutlinerPush::Hooks.IsValidIndex(3) ? UELinkOutlinerPush::Hooks[3] : FDelegateHandle());
		GEngine->OnLevelActorFolderChanged().Remove(UELinkOutlinerPush::Hooks.IsValidIndex(4) ? UELinkOutlinerPush::Hooks[4] : FDelegateHandle());
		GEngine->OnLevelActorListChanged().Remove(UELinkOutlinerPush::Hooks.IsValidIndex(5) ? UELinkOutlinerPush::Hooks[5] : FDelegateHandle());
	}
	UELinkOutlinerPush::Hooks.Reset();
}
