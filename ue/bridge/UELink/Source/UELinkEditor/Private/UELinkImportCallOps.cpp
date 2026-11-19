// 导入外部文件、调编辑器函数库（2.16.0 起）：补上 Agent 以前只能写 Python 才做得到的两类编辑器能力。
//   asset.import {files | file, dest, name?, replace?, dryRun?}   把磁盘上的 FBX、贴图、音频等导入成资源（AssetTools.ImportAssetTasks）
//   asset.reimport {path}                                        按资源记下的源文件重新导入（FReimportManager），能批量
//   editor.functions {class? , query?, limit?}                   列函数库（UBlueprintFunctionLibrary 子类）里蓝图能调的静态函数
//   editor.call {class, function, args?, path?}                  调一个静态函数（EditorStaticMeshLibrary.SetLodCount 之类），包进编辑器事务，能批量
// 只在编辑器进程里有。导入、重新导入不进撤销栈（引擎的导入不是事务性的），新资源没保存前用「放弃改动」丢掉。
// 权限确认、P4 签出由面板服务端做。
#include "UELinkCompat.h"
#include "AgentPanelEditorShared.h"

#include "AssetImportTask.h"
#include "AssetToolsModule.h"
#include "EditorReimportHandler.h"
#include "HAL/FileManager.h"
#include "IAssetTools.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "ObjectTools.h"
#include "UObject/Package.h"
#include "UObject/UObjectIterator.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

// 不用匿名命名空间：单体编译时和别的文件的同名小函数会撞
namespace UELinkImportCall
{
	/** 字符串或字符串数组都认，空项去掉 */
	TArray<FString> Strings(const TSharedPtr<FJsonObject>& A, const TCHAR* ArrayKey, const TCHAR* OneKey)
	{
		TArray<FString> Out;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (A->TryGetArrayField(ArrayKey, Arr) && Arr)
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				FString S;
				if (V.IsValid() && V->TryGetString(S) && !S.TrimStartAndEnd().IsEmpty())
				{
					Out.Add(S.TrimStartAndEnd());
				}
			}
		}
		const FString One = Str(A, OneKey).TrimStartAndEnd();
		if (!One.IsEmpty())
		{
			Out.Add(One);
		}
		return Out;
	}

	/** 磁盘文件：相对路径按项目目录算 */
	FString FullFile(const FString& File)
	{
		const FString F = FPaths::IsRelative(File) ? FPaths::Combine(FPaths::ProjectDir(), File) : File;
		return FPaths::ConvertRelativePathToFull(F);
	}

	/** 目标目录：/Game/... 这样的挂载点目录，去掉结尾的 / */
	bool DestFolder(const FString& In, FString& Path, FString& Error)
	{
		Path = In;
		while (Path.Len() > 1 && Path.EndsWith(TEXT("/")))
		{
			Path.LeftChopInline(1);
		}
		int32 Dot = INDEX_NONE;
		if (!Path.StartsWith(TEXT("/")) || Path == TEXT("/") || Path.FindChar(TEXT('.'), Dot) || !FPackageName::IsValidPath(Path))
		{
			Error = FString::Printf(TEXT("dest 要写成挂载点下的目录，如 /Game/Meshes，收到「%s」"), *In);
			return false;
		}
		return true;
	}

	bool PackageThere(const FString& Package)
	{
		return FindPackage(nullptr, *Package) != nullptr || FPackageName::DoesPackageExist(Package);
	}

	/** 函数库里能调的：静态，并且是蓝图开放的（BlueprintCallable / Pure）或标了 AgentPanel */
	bool Callable(const UFunction* F)
	{
		if (!F || !F->HasAnyFunctionFlags(FUNC_Static) || F->HasAnyFunctionFlags(FUNC_Delegate))
		{
			return false;
		}
		bool bOk = F->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_BlueprintPure);
#if WITH_EDITORONLY_DATA
		bOk = bOk || F->HasMetaData(TEXT("AgentPanel"));
#endif
		return bOk;
	}

	TSharedPtr<FJsonObject> FunctionJson(const UClass* Class, const UFunction* F)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("class"), Class->GetName());
		O->SetStringField(TEXT("name"), F->GetName());
		TArray<TSharedPtr<FJsonValue>> Params;
		FProperty* Ret = nullptr;
		for (TFieldIterator<FProperty> It(F); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
		{
			if (It->HasAnyPropertyFlags(CPF_ReturnParm))
			{
				Ret = *It;
				continue;
			}
			TSharedPtr<FJsonObject> P = MakeShared<FJsonObject>();
			P->SetStringField(TEXT("name"), It->GetName());
			P->SetStringField(TEXT("type"), It->GetCPPType());
			if (It->HasAnyPropertyFlags(CPF_OutParm) && !It->HasAnyPropertyFlags(CPF_ReferenceParm))
			{
				P->SetBoolField(TEXT("out"), true);
			}
			Params.Add(JObj(P));
		}
		O->SetArrayField(TEXT("params"), Params);
		if (Ret)
		{
			O->SetStringField(TEXT("ret"), Ret->GetCPPType());
		}
#if WITH_EDITORONLY_DATA
		const FString Tip = F->GetMetaData(TEXT("ToolTip")).Left(200);
		if (!Tip.IsEmpty())
		{
			O->SetStringField(TEXT("tooltip"), Tip);
		}
#endif
		return O;
	}
}

void AgentPanelEd::RegisterImportCallOps()
{
	// 只在函数里打开：写在文件顶层会在单体编译时漏给后面的文件
	using namespace UELinkImportCall;
	FAgentPanelBridge& B = FAgentPanelBridge::Get();

	// ---------- 导入外部文件 ----------
	B.AddOp(TEXT("asset.import"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const TArray<FString> Files = Strings(A, TEXT("files"), TEXT("file"));
		if (Files.Num() == 0)
		{
			Error = TEXT("要给 files（磁盘文件路径数组）或 file；相对路径按项目目录算");
			return false;
		}
		FString Dest;
		if (!DestFolder(Str(A, TEXT("dest")), Dest, Error))
		{
			return false;
		}
		const FString Name = Str(A, TEXT("name"));
		if (!Name.IsEmpty() && Files.Num() > 1)
		{
			Error = TEXT("name 只能在导入一个文件时用：多个文件按各自的文件名命名");
			return false;
		}
		const bool bReplace = Bool(A, TEXT("replace"), false);
		// 先把计划列出来：每个文件导入成哪个资源、是不是已经有了；有问题整批不导入
		TArray<TSharedPtr<FJsonValue>> Plan;
		TArray<FString> Problems;
		TArray<FString> Full;
		for (const FString& File : Files)
		{
			const FString F = FullFile(File);
			Full.Add(F);
			const FString Asset = ObjectTools::SanitizeObjectName(Name.IsEmpty() ? FPaths::GetBaseFilename(F) : Name);
			const FString Package = Dest + TEXT("/") + Asset;
			const bool bExists = PackageThere(Package);
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("file"), F);
			O->SetStringField(TEXT("path"), Package + TEXT(".") + Asset);
			if (bExists)
			{
				O->SetBoolField(TEXT("exists"), true);
			}
			if (!IFileManager::Get().FileExists(*F))
			{
				Problems.Add(FString::Printf(TEXT("文件不存在：%s"), *F));
			}
			else if (bExists && !bReplace)
			{
				Problems.Add(FString::Printf(TEXT("%s 已经有了：要覆盖写 replace=true"), *Package));
			}
			Plan.Add(JObj(O));
		}
		Out->SetArrayField(TEXT("items"), Plan);
		if (Problems.Num())
		{
			Error = FString::Join(Problems, TEXT("\n"));
			return false;
		}
		if (Bool(A, TEXT("dryRun"), false))
		{
			Out->SetBoolField(TEXT("dryRun"), true);
			return true;
		}

		TArray<UAssetImportTask*> Tasks;
		for (const FString& F : Full)
		{
			UAssetImportTask* Task = NewObject<UAssetImportTask>();
			Task->Filename = F;
			Task->DestinationPath = Dest;
			Task->DestinationName = Name;
			Task->bReplaceExisting = bReplace;
			// 不弹导入选项对话框、不自己保存：保存走面板的 ue_save（确认、P4 签出）
			Task->bAutomated = true;
			Task->bSave = false;
			Tasks.Add(Task);
		}
		const TSet<UPackage*> Before = DirtyNow();
		IAssetTools& Tools = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools")).Get();
		Tools.ImportAssetTasks(Tasks);

		TArray<TSharedPtr<FJsonValue>> Results;
		int32 Failed = 0;
		for (int32 i = 0; i < Tasks.Num(); ++i)
		{
			UAssetImportTask* Task = Tasks[i];
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("file"), Full[i]);
			TArray<TSharedPtr<FJsonValue>> Objects;
			if (Task)
			{
				for (const FString& P : Task->ImportedObjectPaths)
				{
					Objects.Add(JStr(P));
					if (UObject* Obj = StaticFindObject(UObject::StaticClass(), nullptr, *P))
					{
						NoteDirty(Obj);
					}
				}
			}
			O->SetArrayField(TEXT("objects"), Objects);
			if (Objects.Num() == 0)
			{
				++Failed;
				O->SetStringField(TEXT("error"), TEXT("没有导入出资源：格式不支持、文件损坏或导入器报错，详细原因在 UE 的输出日志里"));
			}
			Results.Add(JObj(O));
		}
		TrackNewDirty(Before, Out);
		Out->SetArrayField(TEXT("items"), Results);
		Out->SetNumberField(TEXT("imported"), Tasks.Num() - Failed);
		if (Failed == Tasks.Num())
		{
			Error = TEXT("一个都没导入成功，详细原因在 UE 的输出日志里");
			return false;
		}
		return true;
	});

	// ---------- 按源文件重新导入 ----------
	B.AddOp(TEXT("asset.reimport"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UObject* Obj = LoadAsset(Str(A, TEXT("path")), Error);
		if (!Obj)
		{
			return false;
		}
		FReimportManager* Mgr = FReimportManager::Instance();
		if (!Mgr || !Mgr->CanReimport(Obj))
		{
			Error = FString::Printf(TEXT("%s 不能重新导入：不是从外部文件导入的资源，或者没有对应的导入器"), *Obj->GetPathName());
			return false;
		}
		if (Bool(A, TEXT("dryRun"), false))
		{
			Out->SetBoolField(TEXT("dryRun"), true);
			Out->SetStringField(TEXT("path"), Obj->GetPathName());
			return true;
		}
		const TSet<UPackage*> Before = DirtyNow();
		// 不问新文件、不弹通知、按自动化处理（不弹导入选项）
		if (!Mgr->Reimport(Obj, false, false, TEXT(""), nullptr, INDEX_NONE, false, true))
		{
			Error = FString::Printf(TEXT("%s 重新导入失败：源文件不在了或导入器报错，详细原因在 UE 的输出日志里"), *Obj->GetPathName());
			return false;
		}
		NoteDirty(Obj);
		TrackNewDirty(Before, Out);
		Out->SetStringField(TEXT("path"), Obj->GetPathName());
		Out->SetBoolField(TEXT("reimported"), true);
		return true;
	});

	// ---------- 函数库里的静态函数：列出 ----------
	B.AddOp(TEXT("editor.functions"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString ClassName = Str(A, TEXT("class"));
		const FString Query = Str(A, TEXT("query"));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 60), 1, 300);
		TArray<UClass*> Classes;
		if (!ClassName.IsEmpty())
		{
			UClass* C = FindClassByName(ClassName);
			if (!C)
			{
				Error = FString::Printf(TEXT("找不到类 %s（写函数库类名，如 EditorStaticMeshLibrary、EditorAssetLibrary）"), *ClassName);
				return false;
			}
			Classes.Add(C);
		}
		else if (Query.IsEmpty())
		{
			Error = TEXT("要给 class（函数库类名）或 query（按类名、函数名里的文字搜）");
			return false;
		}
		else
		{
			for (TObjectIterator<UClass> It; It; ++It)
			{
				if (It->IsChildOf(UBlueprintFunctionLibrary::StaticClass()) && !It->HasAnyClassFlags(CLASS_NewerVersionExists | CLASS_Deprecated))
				{
					Classes.Add(*It);
				}
			}
		}
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Total = 0;
		for (UClass* C : Classes)
		{
			const bool bClassHit = Query.IsEmpty() || C->GetName().Contains(Query, ESearchCase::IgnoreCase);
			for (TFieldIterator<UFunction> F(C, EFieldIteratorFlags::ExcludeSuper); F; ++F)
			{
				if (!Callable(*F) || !(bClassHit || F->GetName().Contains(Query, ESearchCase::IgnoreCase)))
				{
					continue;
				}
				++Total;
				if (Items.Num() < Limit)
				{
					Items.Add(JObj(FunctionJson(C, *F)));
				}
			}
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
		if (Total > Items.Num())
		{
			Out->SetBoolField(TEXT("more"), true);
		}
		return true;
	});

	// ---------- 函数库里的静态函数：调用 ----------
	B.AddOp(TEXT("editor.call"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString ClassName = Str(A, TEXT("class"));
		UClass* C = FindClassByName(ClassName);
		if (!C)
		{
			Error = FString::Printf(TEXT("找不到类 %s（写函数库类名，如 EditorStaticMeshLibrary）"), *ClassName);
			return false;
		}
		const FString Name = Str(A, TEXT("function"));
		UFunction* F = C->FindFunctionByName(FName(*Name));
		if (!F)
		{
			Error = FString::Printf(TEXT("%s 上没有函数 %s：先 editor.functions 看有哪些"), *C->GetName(), *Name);
			return false;
		}
		if (!Callable(F))
		{
			Error = FString::Printf(TEXT("%s.%s 不是蓝图能调的静态函数，不开放调用；对象上的函数用 call"), *C->GetName(), *Name);
			return false;
		}
		UObject* Cdo = C->GetDefaultObject();
		if (!Cdo)
		{
			Error = FString::Printf(TEXT("%s 没有类默认对象"), *C->GetName());
			return false;
		}
		// 包进编辑器事务：函数里 Modify 过的对象 Ctrl+Z 能撤，ue_undo 按 tx 撤同一步；没 Modify 的改动事务记不下
		const TSet<UPackage*> Before = DirtyNow();
		FTx Tx(FString::Printf(TEXT("%s.%s"), *C->GetName(), *Name));
		if (!CallFunction(Cdo, F, A->TryGetField(TEXT("args")), Out, Error))
		{
			FString TxError;
			Tx.Finish(false, TxError);
			return false;
		}
		TrackNewDirty(Before, Out);
		FString TxError;
		if (Tx.IsValid() && Tx.Finish(true, TxError))
		{
			Out->SetStringField(TEXT("tx"), Tx.Id);
		}
		return true;
	});

	// 批量：重新导入、调函数库都能一次传多个资源（paths / items，参数里 {path} {name} 按资源替换）。
	// 重新导入没有事务、回滚不了；调函数各自一个事务，失败时整批按 tx 撤回
	FAgentPanelBatchInfo Reimport;
	Reimport.bWrite = true;
	Reimport.bDryRun = true;
	B.AddBatchOp(TEXT("asset.reimport"), Reimport);
	FAgentPanelBatchInfo Call;
	Call.bWrite = true;
	Call.Undo = TEXT("tx");
	B.AddBatchOp(TEXT("editor.call"), Call);
}
