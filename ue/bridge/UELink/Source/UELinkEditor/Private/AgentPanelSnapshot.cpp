// 资源的结构化快照（asset.snapshot，2.14）：面板资源页「版本差异」用。和 asset.textify 一样把一版文件挂到临时挂载点加载，
// 但导出成 JSON（属性每项的形状和 props 操作一样，带分类、显示名），面板按组件、属性路径、节点 GUID 逐项比，而不是按行比文本。
// 不传 file 时读编辑器里已经加载的那份（含还没保存的改动），给「本地改动」用。
// 快照可能上 MB（大蓝图几百个节点），按 ADR 0067 写进面板给的 out 文件，只回路径和大小。
#include "UELinkCompat.h"
#include "AgentPanelEditorShared.h"

#include "Components/ActorComponent.h"
#include "Components/SceneComponent.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraph/EdGraphPin.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Engine/CurveTable.h"
#include "Engine/DataTable.h"
#include "Engine/InheritableComponentHandler.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/Package.h"
#include "UObject/UObjectHash.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

namespace
{
	/** 单个属性值不截断：快照写文件，截成摘要的话两版不同的值会被比成一样 */
	constexpr int32 SnapshotMaxChars = 0;

	TSharedPtr<FJsonObject> ObjectSnap(UObject* Obj)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("name"), Obj->GetName());
		O->SetStringField(TEXT("class"), Obj->GetClass()->GetName());
		O->SetArrayField(TEXT("props"), ListSavedProps(Obj, SnapshotMaxChars));
		return O;
	}

	/** 引脚的默认值：对象引用给路径，文本给原文，其他按 UE 的文本格式 */
	FString PinDefault(const UEdGraphPin* Pin)
	{
		if (Pin->DefaultObject)
		{
			return Pin->DefaultObject->GetPathName();
		}
		if (!Pin->DefaultTextValue.IsEmpty())
		{
			return Pin->DefaultTextValue.ToString();
		}
		return Pin->GetDefaultAsString();
	}

	/** 一个节点：id（GUID 前 8 位，和 bp.graph 一致）、完整 guid（配对用）、标题、类、没连线的输入引脚默认值、输出连线 */
	TSharedPtr<FJsonObject> NodeSnap(const UEdGraphNode* Node)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("id"), NodeId(Node));
		O->SetStringField(TEXT("guid"), Node->NodeGuid.ToString(EGuidFormats::Digits).ToLower());
		O->SetStringField(TEXT("title"), NodeTitle(Node));
		O->SetStringField(TEXT("class"), Node->GetClass()->GetName());
		if (!Node->NodeComment.IsEmpty())
		{
			O->SetStringField(TEXT("comment"), Node->NodeComment);
		}
		TSharedPtr<FJsonObject> Pins = MakeShared<FJsonObject>();
		TArray<TSharedPtr<FJsonValue>> Links;
		for (const UEdGraphPin* Pin : Node->Pins)
		{
			if (!Pin || Pin->bHidden)
			{
				continue;
			}
			if (Pin->Direction == EGPD_Input)
			{
				// 连了线的输入取的是上游的值，默认值没用；执行引脚没有值
				if (Pin->LinkedTo.Num() == 0 && !IsExec(Pin))
				{
					Pins->SetStringField(Pin->PinName.ToString(), PinDefault(Pin));
				}
				continue;
			}
			for (const UEdGraphPin* To : Pin->LinkedTo)
			{
				const UEdGraphNode* ToNode = To ? To->GetOwningNodeUnchecked() : nullptr;
				if (!ToNode)
				{
					continue;
				}
				Links.Add(JStr(FString::Printf(TEXT("%s->%s.%s"), *Pin->PinName.ToString(), *NodeId(ToNode), *To->PinName.ToString())));
			}
		}
		O->SetObjectField(TEXT("pins"), Pins);
		O->SetArrayField(TEXT("links"), Links);
		return O;
	}

	TSharedPtr<FJsonObject> GraphSnap(UBlueprint* BP, UEdGraph* Graph)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("name"), Graph->GetName());
		O->SetStringField(TEXT("kind"), GraphKind(BP, Graph));
		TArray<TSharedPtr<FJsonValue>> Nodes;
		for (const UEdGraphNode* Node : Graph->Nodes)
		{
			if (Node)
			{
				Nodes.Add(JObj(NodeSnap(Node)));
			}
		}
		O->SetArrayField(TEXT("nodes"), Nodes);
		bool bMore = false;
		O->SetStringField(TEXT("pseudo"), GraphPseudo(BP, Graph, 100000, bMore));
		return O;
	}

	/** 组件：名字、类、挂在谁下面、来源（native = C++ 父类里的，scs = 这个蓝图加的，inherited = 父蓝图的组件在这里改过）、模板的属性 */
	TSharedPtr<FJsonObject> ComponentSnap(UObject* Template, const FString& Name, const FString& Parent, const TCHAR* Source)
	{
		TSharedPtr<FJsonObject> O = ObjectSnap(Template);
		O->SetStringField(TEXT("name"), Name);
		O->SetStringField(TEXT("parent"), Parent);
		O->SetStringField(TEXT("source"), Source);
		return O;
	}

	void AddScs(TArray<TSharedPtr<FJsonValue>>& Out, const USCS_Node* Node, const FString& Parent)
	{
		const FString Name = Node->GetVariableName().ToString();
		if (Node->ComponentTemplate)
		{
			Out.Add(JObj(ComponentSnap(Node->ComponentTemplate, Name, Parent, TEXT("scs"))));
		}
		for (const USCS_Node* Child : Node->GetChildNodes())
		{
			if (Child)
			{
				AddScs(Out, Child, Name);
			}
		}
	}

	TSharedPtr<FJsonObject> BlueprintSnap(UBlueprint* BP, TArray<TSharedPtr<FJsonValue>>& Props)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("parent"), BP->ParentClass ? BP->ParentClass->GetPathName() : FString());
		TArray<TSharedPtr<FJsonValue>> Interfaces;
		for (const FBPInterfaceDescription& I : BP->ImplementedInterfaces)
		{
			if (I.Interface)
			{
				Interfaces.Add(JStr(I.Interface->GetPathName()));
			}
		}
		O->SetArrayField(TEXT("interfaces"), Interfaces);

		TArray<TSharedPtr<FJsonValue>> Vars;
		for (const FBPVariableDescription& V : BP->NewVariables)
		{
			TSharedPtr<FJsonObject> VO = MakeShared<FJsonObject>();
			VO->SetStringField(TEXT("name"), V.VarName.ToString());
			VO->SetStringField(TEXT("type"), PinTypeText(V.VarType));
			VO->SetStringField(TEXT("category"), V.Category.ToString());
			TArray<TSharedPtr<FJsonValue>> Flags;
			if (V.PropertyFlags & CPF_Net)
			{
				Flags.Add(JStr((V.PropertyFlags & CPF_RepNotify) ? TEXT("repNotify") : TEXT("replicated")));
			}
			if (!(V.PropertyFlags & CPF_DisableEditOnInstance))
			{
				Flags.Add(JStr(TEXT("instanceEditable")));
			}
			if (V.PropertyFlags & CPF_ExposeOnSpawn)
			{
				Flags.Add(JStr(TEXT("exposeOnSpawn")));
			}
			if (V.PropertyFlags & CPF_BlueprintReadOnly)
			{
				Flags.Add(JStr(TEXT("readOnly")));
			}
			VO->SetArrayField(TEXT("flags"), Flags);
			Vars.Add(JObj(VO));
		}
		O->SetArrayField(TEXT("variables"), Vars);

		TArray<TSharedPtr<FJsonValue>> Comps;
		UObject* CDO = BP->GeneratedClass ? BP->GeneratedClass->GetDefaultObject() : nullptr;
		if (CDO)
		{
			Props = ListSavedProps(CDO, SnapshotMaxChars);
			// C++ 父类里的组件：类默认对象的默认子对象
			TArray<UObject*> Subs;
			CDO->GetDefaultSubobjects(Subs);
			Subs.Sort([](const UObject& A, const UObject& B) { return A.GetName() < B.GetName(); });
			for (UObject* S : Subs)
			{
				if (!Cast<UActorComponent>(S))
				{
					continue;
				}
				const USceneComponent* Scene = Cast<USceneComponent>(S);
				const USceneComponent* AttachTo = Scene ? Scene->GetAttachParent() : nullptr;
				Comps.Add(JObj(ComponentSnap(S, S->GetName(), AttachTo ? AttachTo->GetName() : FString(), TEXT("native"))));
			}
		}
		if (BP->SimpleConstructionScript)
		{
			for (const USCS_Node* Root : BP->SimpleConstructionScript->GetRootNodes())
			{
				if (Root)
				{
					// 根节点挂在父类组件上时记那个组件名，否则空（就是根）
					AddScs(Comps, Root, Root->ParentComponentOrVariableName.IsNone() ? FString() : Root->ParentComponentOrVariableName.ToString());
				}
			}
		}
		// 父蓝图的组件在子蓝图里改过的模板：名字去掉引擎加的 _GEN_VARIABLE 后缀，和父蓝图里的变量名对上
		if (UInheritableComponentHandler* Ich = BP->GetInheritableComponentHandler(false))
		{
			TArray<UActorComponent*> Templates;
			Ich->GetAllTemplates(Templates);
			Templates.Sort([](const UActorComponent& A, const UActorComponent& B) { return A.GetName() < B.GetName(); });
			for (UActorComponent* T : Templates)
			{
				if (T)
				{
					FString Name = T->GetName();
					Name.RemoveFromEnd(TEXT("_GEN_VARIABLE"));
					Comps.Add(JObj(ComponentSnap(T, Name, FString(), TEXT("inherited"))));
				}
			}
		}
		O->SetArrayField(TEXT("components"), Comps);

		TArray<TSharedPtr<FJsonValue>> Graphs;
		for (UEdGraph* G : AllGraphs(BP))
		{
			if (G)
			{
				Graphs.Add(JObj(GraphSnap(BP, G)));
			}
		}
		O->SetArrayField(TEXT("graphs"), Graphs);
		return O;
	}

	/** 整个快照：资源类、属性（蓝图是类默认值）、蓝图结构或内嵌子对象、数据表的行 */
	TSharedPtr<FJsonObject> AssetSnap(UObject* Asset)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("class"), Asset->GetClass()->GetName());
		TArray<TSharedPtr<FJsonValue>> Props;
		if (UBlueprint* BP = Cast<UBlueprint>(Asset))
		{
			O->SetObjectField(TEXT("blueprint"), BlueprintSnap(BP, Props));
			if (!BP->GeneratedClass)
			{
				O->SetStringField(TEXT("note"), TEXT("这一版的蓝图没有生成类（可能编译失败），读不到类默认值和组件模板"));
			}
		}
		else
		{
			Props = ListSavedProps(Asset, SnapshotMaxChars);
			TArray<UObject*> Subs;
			GetObjectsWithOuter(Asset, Subs, UELINK_OUTER_NESTED(true));
			Subs.RemoveAll([](const UObject* S) { return !S || S->HasAnyFlags(RF_Transient); });
			Subs.Sort([](const UObject& A, const UObject& B) { return A.GetPathName() < B.GetPathName(); });
			TArray<TSharedPtr<FJsonValue>> SubOut;
			for (UObject* S : Subs)
			{
				TSharedPtr<FJsonObject> SO = ObjectSnap(S);
				// 子对象按相对资源的路径配对：两版资源包名不同，绝对路径对不上
				SO->SetStringField(TEXT("name"), S->GetPathName(Asset));
				SubOut.Add(JObj(SO));
			}
			O->SetArrayField(TEXT("subobjects"), SubOut);
			if (UDataTable* DT = Cast<UDataTable>(Asset))
			{
				O->SetStringField(TEXT("rowStruct"), DT->GetRowStruct() ? DT->GetRowStruct()->GetPathName() : FString());
				O->SetStringField(TEXT("rows"), DT->GetTableAsJSON());
			}
			else if (UCurveTable* CT = Cast<UCurveTable>(Asset))
			{
				O->SetStringField(TEXT("rows"), CT->GetTableAsJSON());
			}
		}
		O->SetArrayField(TEXT("props"), Props);
		return O;
	}

	FString Condensed(const TSharedPtr<FJsonObject>& O)
	{
		FString Text;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text);
		FJsonSerializer::Serialize(O.ToSharedRef(), Writer);
		return Text;
	}

	/** 写快照文件并回 {out, bytes, class} */
	bool WriteSnap(const FString& OutFile, const FString& Text, const FString& ClassName, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(OutFile), true);
		if (!FFileHelper::SaveStringToFile(Text, *OutFile, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
		{
			Error = FString::Printf(TEXT("写不了快照文件：%s（看看磁盘空间和目录权限）"), *OutFile);
			return false;
		}
		Out->SetStringField(TEXT("out"), OutFile);
		Out->SetNumberField(TEXT("bytes"), static_cast<double>(IFileManager::Get().FileSize(*OutFile)));
		Out->SetStringField(TEXT("class"), ClassName);
		return true;
	}
}

void AgentPanelEd::RegisterSnapshotOps()
{
	FAgentPanelBridge& B = FAgentPanelBridge::Get();

	// args：out 快照写到哪（绝对路径，必填）；package 资源在项目里的包名（/Game/Dir/Name）；
	// file 一版资源的临时文件（绝对路径）——给了就读这一版，不给就读编辑器里的那份（含没保存的改动）
	B.AddOp(TEXT("asset.snapshot"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString OutFile = Str(A, TEXT("out"));
		const FString Package = Str(A, TEXT("package"));
		if (OutFile.IsEmpty() || Package.IsEmpty())
		{
			Error = TEXT("asset.snapshot 要 out（快照写到哪）和 package（资源包名，如 /Game/Dir/Name）");
			return false;
		}
		const FString FileArg = Str(A, TEXT("file"));
		if (FileArg.IsEmpty())
		{
			const FString Name = FPackageName::GetShortName(Package);
			UObject* Asset = LoadAsset(Package + TEXT(".") + Name, Error);
			if (!Asset)
			{
				return false;
			}
			const FString ClassName = Asset->GetClass()->GetName();
			return WriteSnap(OutFile, Condensed(AssetSnap(Asset)), ClassName, Out, Error);
		}

		const FString File = FPaths::ConvertRelativePathToFull(FileArg);
		FString Text;
		FString ClassName;
		const bool bOk = WithTempAsset(File, Package, [&Text, &ClassName, &Package](UObject* Asset, const FString& TempPkg, const FString& Root)
		{
			ClassName = Asset->GetClass()->GetName();
			Text = Condensed(AssetSnap(Asset));
			// 临时包名换回项目里的包名：同一内容两次快照一样，两版之间也不会因为包名不同处处有差异
			Text.ReplaceInline(*TempPkg, *Package, ESearchCase::CaseSensitive);
			Text.ReplaceInline(*Root, *(FPackageName::GetLongPackagePath(Package) + TEXT("/")), ESearchCase::CaseSensitive);
		}, Error);
		if (!bOk)
		{
			return false;
		}
		return WriteSnap(OutFile, Text, ClassName, Out, Error);
	});
}
