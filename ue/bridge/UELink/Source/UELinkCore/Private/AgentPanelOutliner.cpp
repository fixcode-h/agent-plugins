#include "AgentPanelOutliner.h"
#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Components/ActorComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/Level.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "GameFramework/Pawn.h"
#include "UObject/Class.h"
#include "UObject/Package.h"
#include "UObject/UObjectHash.h"

namespace AgentPanel
{
	namespace
	{
		/**
		 * UObject 树里列不列它：Actor、组件、关卡归世界大纲（用户 2026-11-15：Actor 和 UObject 分开）；
		 * 类、函数、属性这些反射信息，类默认对象、蓝图模板、包都是噪音，不列
		 */
		bool ShowInObjectTree(const UObject* O)
		{
			if (!IsValid(O) || O->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
			{
				return false;
			}
			return !(O->IsA<AActor>() || O->IsA<UActorComponent>() || O->IsA<ULevel>() || O->IsA<UField>() || O->IsA<UPackage>());
		}

		bool HasShownChild(const UObject* O)
		{
			bool bAny = false;
			ForEachObjectWithOuterBreakable(O, [&bAny](UObject* Inner)
			{
				bAny = ShowInObjectTree(Inner);
				return !bAny;
			}, UELINK_OUTER_NESTED(false));
			return bAny;
		}

		TSharedPtr<FJsonValue> ObjectNode(const UObject* O)
		{
			TSharedPtr<FJsonObject> N = Brief(O);
			N->SetBoolField(TEXT("more"), HasShownChild(O));
			return MakeShared<FJsonValueObject>(N);
		}
	}

	void RegisterOutlinerOps(FAgentPanelBridge& Bridge)
	{
		// 世界大纲：一个世界里所有 Actor 的名字、类、文件夹、挂接的父 Actor，不读属性（几千个也就几毫秒）
		Bridge.AddOp(TEXT("outliner"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			UWorld* World = FAgentPanelBridge::ResolveWorld(Str(A, TEXT("world")), Error);
			if (!World)
			{
				return false;
			}
			const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 20000), 1, 100000);
			TArray<TSharedPtr<FJsonValue>> Items;
			int32 Total = 0;
			for (TActorIterator<AActor> It(World); It; ++It)
			{
				AActor* Act = *It;
				if (!IsValid(Act))
				{
					continue;
				}
				++Total;
				if (Items.Num() >= Limit)
				{
					continue;
				}
				TSharedPtr<FJsonObject> O = Brief(Act);
#if WITH_EDITOR
				O->SetStringField(TEXT("label"), Act->GetActorLabel(false));
				const FName Folder = Act->GetFolderPath();
				if (!Folder.IsNone())
				{
					O->SetStringField(TEXT("folder"), Folder.ToString());
				}
#endif
				if (const AActor* Parent = Act->GetAttachParentActor())
				{
					O->SetStringField(TEXT("parent"), Parent->GetPathName());
				}
				const APawn* Pawn = Cast<APawn>(Act);
				if (Pawn && Pawn->IsPlayerControlled())
				{
					O->SetBoolField(TEXT("player"), true);
				}
				Items.Add(MakeShared<FJsonValueObject>(O));
			}
			Out->SetArrayField(TEXT("items"), Items);
			Out->SetNumberField(TEXT("total"), Total);
			Out->SetStringField(TEXT("world"), FAgentPanelBridge::WorldId(World));
			return true;
		});

		// UObject 树：path 为空时给根（GameInstance、世界、引擎），否则给这个对象下一层的非 Actor 对象；展开一层读一层
		Bridge.AddOp(TEXT("objects.children"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString Path = Str(A, TEXT("path"));
			const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 500), 1, 5000);
			TArray<TSharedPtr<FJsonValue>> Items;
			if (Path.IsEmpty())
			{
				UWorld* World = FAgentPanelBridge::ResolveWorld(Str(A, TEXT("world")), Error);
				if (!World)
				{
					return false;
				}
				if (UGameInstance* GI = World->GetGameInstance())
				{
					Items.Add(ObjectNode(GI));
				}
				Items.Add(ObjectNode(World));
				if (GEngine)
				{
					Items.Add(ObjectNode(GEngine));
				}
				Out->SetStringField(TEXT("world"), FAgentPanelBridge::WorldId(World));
				Out->SetArrayField(TEXT("items"), Items);
				return true;
			}
			UObject* Parent = FindObjectByPath(Path, false, Error);
			if (!Parent)
			{
				return false;
			}
			TArray<UObject*> Inner;
			GetObjectsWithOuter(Parent, Inner, UELINK_OUTER_NESTED(false));
			Inner.RemoveAll([](const UObject* O) { return !ShowInObjectTree(O); });
			Inner.Sort([](const UObject& L, const UObject& R)
			{
				const int32 C = L.GetClass()->GetName().Compare(R.GetClass()->GetName());
				return C != 0 ? C < 0 : L.GetName() < R.GetName();
			});
			for (int32 i = 0; i < Inner.Num() && i < Limit; ++i)
			{
				Items.Add(ObjectNode(Inner[i]));
			}
			Out->SetArrayField(TEXT("items"), Items);
			Out->SetNumberField(TEXT("total"), Inner.Num());
			return true;
		});
	}
}
