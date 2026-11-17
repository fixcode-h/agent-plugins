#include "AgentPanelBlueprintComps.h"
#include "AgentPanelBridgeUtil.h"

#include "Components/ActorComponent.h"
#include "Components/SceneComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "GameFramework/Actor.h"

namespace AgentPanel
{
	namespace
	{
		struct FCompWalk
		{
			UBlueprintGeneratedClass* Leaf = nullptr;
			TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
			/** 现在的根组件：先是 C++ 的根，没有时第一个蓝图场景组件当根 */
			FString RootPath;
			/** 组件名 → 模板路径：C++ 组件按对象名，蓝图组件按变量名；子蓝图写明的父组件从这里找 */
			TMap<FName, FString> ByName;
			bool bInherited = false;

			void Visit(const USCS_Node* Node, FString ParentPath)
			{
				UActorComponent* Tpl = Node->GetActualComponentTemplate(Leaf);
				if (!Tpl)
				{
					return;
				}
				const FString Path = Tpl->GetPathName();
				const bool bScene = Tpl->IsA<USceneComponent>();
				bool bRoot = false;
				if (bScene && ParentPath.IsEmpty())
				{
					// 和 USimpleConstructionScript::ExecuteScriptOnActor 一样：还没有根时这个场景组件当根
					if (RootPath.IsEmpty())
					{
						RootPath = Path;
						bRoot = true;
					}
					else
					{
						ParentPath = RootPath;
					}
				}
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("path"), Path);
				O->SetStringField(TEXT("name"), Node->GetVariableName().ToString());
				O->SetStringField(TEXT("class"), Tpl->GetClass()->GetName());
				O->SetStringField(TEXT("parent"), bScene ? ParentPath : FString());
				O->SetBoolField(TEXT("root"), bRoot);
				O->SetBoolField(TEXT("scene"), bScene);
				O->SetStringField(TEXT("created"), TEXT("blueprint"));
				if (bInherited)
				{
					O->SetBoolField(TEXT("inherited"), true);
				}
				Items->Add(MakeShared<FJsonValueObject>(O));
				ByName.Add(Node->GetVariableName(), Path);
				for (const USCS_Node* Child : Node->GetChildNodes())
				{
					if (Child)
					{
						Visit(Child, bScene ? Path : ParentPath);
					}
				}
			}
		};
	}

	void AddBlueprintComponents(AActor* CDO, TArray<TSharedPtr<FJsonValue>>& Items)
	{
		UBlueprintGeneratedClass* Leaf = CDO ? Cast<UBlueprintGeneratedClass>(CDO->GetClass()) : nullptr;
		if (!Leaf)
		{
			return;
		}
		FCompWalk W;
		W.Leaf = Leaf;
		W.Items = &Items;
		if (USceneComponent* Root = CDO->GetRootComponent())
		{
			W.RootPath = Root->GetPathName();
		}
		TArray<UActorComponent*> Natives;
		CDO->GetComponents(Natives);
		for (UActorComponent* C : Natives)
		{
			if (C)
			{
				W.ByName.Add(C->GetFName(), C->GetPathName());
			}
		}
		// 子类在前：倒过来从最上面的父蓝图开始接，父蓝图的组件先进 ByName，子蓝图写明的父组件才找得到
		TArray<const UBlueprintGeneratedClass*> Chain;
		UBlueprintGeneratedClass::GetGeneratedClassesHierarchy(Leaf, Chain);
		for (int32 i = Chain.Num() - 1; i >= 0; --i)
		{
			const USimpleConstructionScript* SCS = Chain[i] ? Chain[i]->SimpleConstructionScript.Get() : nullptr;
			if (!SCS)
			{
				continue;
			}
			W.bInherited = Chain[i] != Leaf;
			for (const USCS_Node* Node : SCS->GetRootNodes())
			{
				if (!Node)
				{
					continue;
				}
				// 默认场景根（DefaultSceneRoot）在已经有根组件时不会建出来，它下面的直接挂到现在的根上
				if (Node->GetVariableName() == USceneComponent::GetDefaultSceneRootVariableName() && !W.RootPath.IsEmpty())
				{
					for (const USCS_Node* Child : Node->GetChildNodes())
					{
						if (Child)
						{
							W.Visit(Child, W.RootPath);
						}
					}
					continue;
				}
				FString Parent;
				if (Node->ParentComponentOrVariableName != NAME_None)
				{
					if (const FString* P = W.ByName.Find(Node->ParentComponentOrVariableName))
					{
						Parent = *P;
					}
				}
				W.Visit(Node, Parent);
			}
		}
	}
}
