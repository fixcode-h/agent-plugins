#include "UELinkBpNames.h"
#include "AgentPanelBridgeUtil.h"
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "Engine/Blueprint.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "EdGraph/EdGraph.h"

namespace AgentPanel
{
	namespace BpNames
	{
		enum class EKind : uint8 { None, Variable, Function, Component, Node };

		EKind KindOf(const FString& What)
		{
			if (What == TEXT("set_variable") || What == TEXT("remove_variable"))
			{
				return EKind::Variable;
			}
			if (What == TEXT("remove_function"))
			{
				return EKind::Function;
			}
			if (What == TEXT("set_component") || What == TEXT("remove_component"))
			{
				return EKind::Component;
			}
			if (What == TEXT("remove_node"))
			{
				return EKind::Node;
			}
			return EKind::None;
		}

		bool IsPattern(const FString& S)
		{
			return S.Contains(TEXT("*")) || S.Contains(TEXT("?"));
		}

		/** 这个蓝图里这一类成员的全部名字；节点不列（节点 id 太多，只支持数组） */
		TArray<FString> Candidates(UBlueprint* BP, EKind Kind, UClass* ComponentClass)
		{
			TArray<FString> Names;
			if (Kind == EKind::Variable)
			{
				for (const FBPVariableDescription& V : BP->NewVariables)
				{
					Names.Add(V.VarName.ToString());
				}
			}
			else if (Kind == EKind::Function)
			{
				for (const UEdGraph* G : BP->FunctionGraphs)
				{
					if (G)
					{
						Names.Add(G->GetName());
					}
				}
			}
			else if (Kind == EKind::Component && BP->SimpleConstructionScript)
			{
				for (const USCS_Node* N : BP->SimpleConstructionScript->GetAllNodes())
				{
					if (N && (!ComponentClass || (N->ComponentClass && N->ComponentClass->IsChildOf(ComponentClass))))
					{
						Names.Add(N->GetVariableName().ToString());
					}
				}
			}
			return Names;
		}
	}

	bool ExpandBlueprintNames(UBlueprint* BP, const TSharedPtr<FJsonObject>& Op, TArray<TSharedPtr<FJsonObject>>& Out, FString& Error)
	{
		using namespace BpNames;
		const EKind Kind = KindOf(Str(Op, TEXT("op")));
		const TCHAR* Key = Kind == EKind::Node ? TEXT("node") : TEXT("name");
		const FString ClassName = Kind == EKind::Component ? Str(Op, TEXT("componentClass")) : FString();
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		const bool bArray = Kind != EKind::None && Op->TryGetArrayField(Key, Arr) && Arr;
		const FString Single = bArray ? FString() : Str(Op, Key);
		if (Kind == EKind::None || (!bArray && ClassName.IsEmpty() && !IsPattern(Single)))
		{
			Out.Add(Op);
			return true;
		}
		if (Kind == EKind::Node && !bArray)
		{
			Error = TEXT("remove_node 的 node 只能给 id 数组，不支持通配符");
			return false;
		}
		UClass* ComponentClass = nullptr;
		if (!ClassName.IsEmpty())
		{
			ComponentClass = FindClassByName(ClassName);
			if (!ComponentClass)
			{
				Error = FString::Printf(TEXT("找不到组件类 %s"), *ClassName);
				return false;
			}
		}
		// 要的名字：数组里的每一项（每项也可以是通配符），或单个通配符；name 不写、只给 componentClass 时是这个类的全部
		TArray<FString> Wanted;
		if (bArray)
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				FString S;
				if (V.IsValid() && V->TryGetString(S) && !S.IsEmpty())
				{
					Wanted.Add(S);
				}
			}
		}
		else
		{
			Wanted.Add(Single.IsEmpty() ? FString(TEXT("*")) : Single);
		}
		const TArray<FString> All = Kind == EKind::Node ? TArray<FString>() : Candidates(BP, Kind, ComponentClass);
		TArray<FString> Names;
		for (const FString& W : Wanted)
		{
			// 节点 id、普通名字直接用（不存在的由操作自己报错）；组件按类筛时普通名字也要在筛出来的里面
			if (!IsPattern(W) && (Kind == EKind::Node || !ComponentClass))
			{
				Names.AddUnique(W);
				continue;
			}
			bool bAny = false;
			for (const FString& C : All)
			{
				if (C.MatchesWildcard(W, ESearchCase::IgnoreCase))
				{
					Names.AddUnique(C);
					bAny = true;
				}
			}
			if (!bAny)
			{
				Error = FString::Printf(TEXT("%s 里没有和 %s 对得上的%s"), *BP->GetName(), *W, ComponentClass ? *FString::Printf(TEXT(" %s 组件"), *ClassName) : TEXT("成员"));
				return false;
			}
		}
		if (Kind == EKind::Variable && Names.Num() > 1 && Op->HasField(TEXT("rename")))
		{
			Error = TEXT("set_variable 一次改多个变量时不能带 rename");
			return false;
		}
		for (const FString& N : Names)
		{
			const TSharedPtr<FJsonObject> One = MakeShared<FJsonObject>();
			for (const auto& Pair : Op->Values)
			{
				One->SetField(UELINK_JSON_KEY(Pair.Key), Pair.Value);
			}
			One->RemoveField(TEXT("componentClass"));
			One->SetStringField(Key, N);
			Out.Add(One);
		}
		return true;
	}

	FString SubOpLabel(const TSharedPtr<FJsonObject>& Op)
	{
		FString Label = Str(Op, TEXT("node"), Str(Op, TEXT("name")));
		const FString Prop = Str(Op, TEXT("prop"));
		if (BpNames::KindOf(Str(Op, TEXT("op"))) == BpNames::EKind::Node || Prop.IsEmpty())
		{
			return Label;
		}
		return Label.IsEmpty() ? Prop : Label + TEXT(".") + Prop;
	}

	void ExpandBlueprintProps(const TSharedPtr<FJsonObject>& Op, TArray<TSharedPtr<FJsonObject>>& Out)
	{
		const FString What = Str(Op, TEXT("op"));
		const TSharedPtr<FJsonObject>* Props = nullptr;
		if ((What != TEXT("set_component") && What != TEXT("set_default")) || !Op->TryGetObjectField(TEXT("props"), Props) || !Props || !Props->IsValid())
		{
			Out.Add(Op);
			return;
		}
		const TSharedPtr<FJsonObject>* Where = nullptr;
		const bool bWhere = Op->TryGetObjectField(TEXT("where"), Where) && Where && Where->IsValid();
		for (const auto& Pair : (*Props)->Values)
		{
			const FString Prop = UELINK_JSON_KEY(Pair.Key);
			const TSharedPtr<FJsonObject> One = MakeShared<FJsonObject>();
			for (const auto& Field : Op->Values)
			{
				One->SetField(UELINK_JSON_KEY(Field.Key), Field.Value);
			}
			One->RemoveField(TEXT("props"));
			One->RemoveField(TEXT("where"));
			One->SetStringField(TEXT("prop"), Prop);
			One->SetField(TEXT("value"), Pair.Value);
			if (bWhere)
			{
				if (const TSharedPtr<FJsonValue> W = (*Where)->TryGetField(Prop))
				{
					One->SetField(TEXT("where"), W);
				}
			}
			Out.Add(One);
		}
	}

	bool ExpandBlueprintOp(UBlueprint* BP, const TSharedPtr<FJsonObject>& Op, TArray<TSharedPtr<FJsonObject>>& Out, FString& Error)
	{
		TArray<TSharedPtr<FJsonObject>> Named;
		if (!ExpandBlueprintNames(BP, Op, Named, Error))
		{
			return false;
		}
		for (const TSharedPtr<FJsonObject>& One : Named)
		{
			ExpandBlueprintProps(One, Out);
		}
		return true;
	}
}
