// 编辑器小工具（2.4.0 起，设计稿「UE 插件优化与扩展」二 P1 资源整理、二 P2 放删 Actor）：
//   asset.redirectors {path, fix?}                  列出文件夹下的重定向器；fix=true 时修复引用并删掉修好的重定向器
//   editor.spawn {class, location?, rotation?, ...}  在编辑器关卡里放一个 Actor（进撤销栈，回 tx）
//   editor.destroy {actors}                         删掉编辑器关卡里的 Actor（进撤销栈，回 tx）
// 只在编辑器进程里有（后台编辑器能列和修重定向器，放删 Actor 要开着的编辑器）。权限确认、P4 签出由面板服务端做。
#include "UELinkCompat.h"
#include "AgentPanelEditorShared.h"

#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "AssetToolsModule.h"
#include "Editor.h"
#include "Engine/Level.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "HAL/FileManager.h"
#include "IAssetTools.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Subsystems/EditorActorSubsystem.h"
#include "UObject/ObjectRedirector.h"
#include "UObject/Package.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

// 不用匿名命名空间：单体编译时和 AgentPanelAssetOps.cpp 的同名小函数（Registry 等）会撞
namespace UELinkEditorTools
{
	IAssetRegistry& ToolsRegistry()
	{
		return FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
	}

	/** 包在磁盘上的文件（没加载也能算）：先问 DoesPackageExist，地图包后缀是 .umap */
	FString FileOfPackage(const FString& Package)
	{
		FString File;
		if (FPackageName::DoesPackageExist(Package, &File))
		{
			return FPaths::ConvertRelativePathToFull(File);
		}
		return FPaths::ConvertRelativePathToFull(FPackageName::LongPackageNameToFilename(Package, FPackageName::GetAssetPackageExtension()));
	}

	/** 文件夹路径：去掉结尾的 /，必须是挂载点下的目录 */
	bool FolderArg(const TSharedPtr<FJsonObject>& A, FString& Path, FString& Error)
	{
		Path = Str(A, TEXT("path"));
		while (Path.Len() > 1 && Path.EndsWith(TEXT("/")))
		{
			Path.LeftChopInline(1);
		}
		int32 Dot = INDEX_NONE;
		if (!Path.StartsWith(TEXT("/")) || Path == TEXT("/") || Path.FindChar(TEXT('.'), Dot) || !FPackageName::IsValidPath(Path))
		{
			Error = FString::Printf(TEXT("文件夹路径不对：%s。要写成挂载点下的目录，如 /Game/Characters"), *Path);
			return false;
		}
		return true;
	}

	/** 一个重定向器：包名、文件、指向谁、谁还在引用它（这些包修复时会被改写、保存） */
	struct FRedirectorRow
	{
		FString Package;
		FString Path;
		FString File;
		FString Target;
		TArray<FName> Referencers;
	};

	TArray<FRedirectorRow> FindRedirectors(const FString& Folder, int32 Limit, int32& Total)
	{
		FARFilter Filter;
		Filter.PackagePaths.Add(FName(*Folder));
		Filter.bRecursivePaths = true;
		Filter.ClassPaths.Add(UObjectRedirector::StaticClass()->GetClassPathName());
		TArray<FAssetData> Found;
		ToolsRegistry().GetAssets(Filter, Found);
		Found.Sort([](const FAssetData& L, const FAssetData& R) { return L.PackageName.LexicalLess(R.PackageName); });
		Total = Found.Num();
		TArray<FRedirectorRow> Rows;
		for (const FAssetData& D : Found)
		{
			if (Rows.Num() >= Limit)
			{
				break;
			}
			FRedirectorRow Row;
			Row.Package = D.PackageName.ToString();
			Row.Path = D.GetObjectPathString();
			Row.File = FileOfPackage(Row.Package);
			// 指向谁：加载重定向器本身很便宜（只有一个指针），修复时反正也要加载
			if (UObjectRedirector* R = Cast<UObjectRedirector>(D.GetAsset()))
			{
				Row.Target = R->DestinationObject ? R->DestinationObject->GetPathName() : FString();
			}
			ToolsRegistry().GetReferencers(D.PackageName, Row.Referencers, UE::AssetRegistry::EDependencyCategory::Package);
			Rows.Add(MoveTemp(Row));
		}
		return Rows;
	}

	TSharedPtr<FJsonObject> RowJson(const FRedirectorRow& Row)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("path"), Row.Path);
		O->SetStringField(TEXT("package"), Row.Package);
		O->SetStringField(TEXT("file"), Row.File);
		O->SetBoolField(TEXT("readOnly"), IFileManager::Get().IsReadOnly(*Row.File));
		if (!Row.Target.IsEmpty())
		{
			O->SetStringField(TEXT("target"), Row.Target);
		}
		else
		{
			// 目标没了的重定向器修不了（引擎会跳过），列出来让人自己看
			O->SetBoolField(TEXT("broken"), true);
		}
		TArray<TSharedPtr<FJsonValue>> Refs;
		for (const FName R : Row.Referencers)
		{
			TSharedPtr<FJsonObject> Ref = MakeShared<FJsonObject>();
			const FString Pkg = R.ToString();
			const FString File = FileOfPackage(Pkg);
			Ref->SetStringField(TEXT("package"), Pkg);
			Ref->SetStringField(TEXT("file"), File);
			Ref->SetBoolField(TEXT("readOnly"), IFileManager::Get().IsReadOnly(*File));
			Refs.Add(JObj(Ref));
		}
		O->SetArrayField(TEXT("referencers"), Refs);
		return O;
	}

	/** 编辑器世界：PIE 开着时拒绝（放删 Actor 改的是关卡本身，PIE 里的改动停了就没了，容易搞混） */
	UWorld* EditorWorld(FString& Error)
	{
		if (!GEditor || IsRunningCommandlet())
		{
			Error = TEXT("放、删 Actor 要在开着的编辑器里做（后台编辑器没有打开的关卡）");
			return nullptr;
		}
		if (GEditor->PlayWorld)
		{
			Error = TEXT("PIE 正在运行：先停 PIE 再改关卡（PIE 里的改动停了就没了）");
			return nullptr;
		}
		UWorld* World = GEditor->GetEditorWorldContext().World();
		if (!World)
		{
			Error = TEXT("编辑器里没有打开的关卡");
		}
		return World;
	}

	/** [x, y, z] → FVector；没给时用 Default */
	FVector VecArg(const TSharedPtr<FJsonObject>& A, const TCHAR* Key, const FVector& Default)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (!A->TryGetArrayField(Key, Arr) || Arr->Num() < 3)
		{
			return Default;
		}
		return FVector((*Arr)[0]->AsNumber(), (*Arr)[1]->AsNumber(), (*Arr)[2]->AsNumber());
	}

	/** 关卡：空为当前关卡；否则按关卡包名（/Game/Maps/Sub）或短名（Sub）在已加载的关卡里找 */
	ULevel* FindLevel(UWorld* World, const FString& Name, FString& Error)
	{
		if (Name.IsEmpty())
		{
			return World->GetCurrentLevel();
		}
		TArray<FString> Names;
		for (ULevel* L : World->GetLevels())
		{
			if (!L)
			{
				continue;
			}
			const FString Pkg = L->GetOutermost()->GetName();
			if (Pkg.Equals(Name, ESearchCase::IgnoreCase) || FPackageName::GetShortName(Pkg).Equals(Name, ESearchCase::IgnoreCase))
			{
				return L;
			}
			Names.Add(Pkg);
		}
		Error = FString::Printf(TEXT("编辑器里没有加载关卡 %s（已加载：%s）"), *Name, *FString::Join(Names, TEXT("、")));
		return nullptr;
	}

	TSharedPtr<FJsonObject> ActorJson(const AActor* Actor)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("path"), Actor->GetPathName());
		O->SetStringField(TEXT("name"), Actor->GetName());
		O->SetStringField(TEXT("label"), Actor->GetActorLabel());
		O->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
		O->SetStringField(TEXT("level"), Actor->GetLevel() ? Actor->GetLevel()->GetOutermost()->GetName() : FString());
		const FVector L = Actor->GetActorLocation();
		TArray<TSharedPtr<FJsonValue>> Loc;
		Loc.Add(MakeShared<FJsonValueNumber>(L.X));
		Loc.Add(MakeShared<FJsonValueNumber>(L.Y));
		Loc.Add(MakeShared<FJsonValueNumber>(L.Z));
		O->SetArrayField(TEXT("location"), Loc);
		return O;
	}
}

void AgentPanelEd::RegisterEditorToolsOps()
{
	// 只在函数里打开：写在文件顶层会在单体编译时漏给后面的文件，和它们的同名函数冲突
	using namespace UELinkEditorTools;
	FAgentPanelBridge& B = FAgentPanelBridge::Get();

	// ---------- 重定向器：列出 / 修复（AssetTools.FixupReferencers，和内容浏览器右键「修复重定向器」同一个入口） ----------
	B.AddOp(TEXT("asset.redirectors"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FString Folder;
		if (!FolderArg(A, Folder, Error))
		{
			return false;
		}
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 1000);
		int32 Total = 0;
		const TArray<FRedirectorRow> Rows = FindRedirectors(Folder, Limit, Total);
		TArray<TSharedPtr<FJsonValue>> Items;
		for (const FRedirectorRow& Row : Rows)
		{
			Items.Add(JObj(RowJson(Row)));
		}
		Out->SetStringField(TEXT("path"), Folder);
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
		if (Total > Rows.Num())
		{
			Out->SetBoolField(TEXT("more"), true);
		}
		if (!Bool(A, TEXT("fix"), false) || Rows.Num() == 0)
		{
			return true;
		}
		if (Total > Rows.Num())
		{
			Error = FString::Printf(TEXT("%s 下有 %d 个重定向器，一次最多修 %d 个：选更小的文件夹分批修"), *Folder, Total, Limit);
			return false;
		}

		TArray<UObjectRedirector*> List;
		for (const FRedirectorRow& Row : Rows)
		{
			FString Ignored;
			if (UObjectRedirector* R = Cast<UObjectRedirector>(LoadAsset(Row.Path, Ignored)))
			{
				if (R->DestinationObject)
				{
					List.Add(R);
				}
			}
		}
		if (List.Num() == 0)
		{
			Error = TEXT("这些重定向器指向的资源都不在了，没法修复：在内容浏览器里看一下再手动删");
			return false;
		}
		const TSet<UPackage*> Before = DirtyNow();
		IAssetTools& Tools = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools")).Get();
		// 不弹签出对话框：P4 项目由面板先签出引用方（只读文件签出后可写），引擎这边直接改写保存
		Tools.FixupReferencers(List, false, ERedirectFixupMode::DeleteFixedUpRedirectors);
		TrackNewDirty(Before, Out);

		// 修完再看一遍：还在的就是没修掉的（引用方保存失败、被别的进程占着……原因在 UE 的输出日志里）
		TArray<TSharedPtr<FJsonValue>> Fixed;
		TArray<TSharedPtr<FJsonValue>> Left;
		for (const FRedirectorRow& Row : Rows)
		{
			const bool bGone = !FPackageName::DoesPackageExist(Row.Package) && !IFileManager::Get().FileExists(*Row.File);
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("package"), Row.Package);
			O->SetStringField(TEXT("file"), Row.File);
			(bGone ? Fixed : Left).Add(JObj(O));
		}
		Out->SetArrayField(TEXT("fixed"), Fixed);
		Out->SetArrayField(TEXT("left"), Left);
		if (Left.Num())
		{
			Out->SetStringField(TEXT("note"), TEXT("有重定向器没删掉：引用方没能保存（文件只读、被占用）或者目标已经不在，详细原因在 UE 的输出日志里"));
		}
		return true;
	});

	// ---------- 在编辑器关卡里放一个 Actor ----------
	B.AddOp(TEXT("editor.spawn"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UWorld* World = EditorWorld(Error);
		if (!World)
		{
			return false;
		}
		const FString ClassName = Str(A, TEXT("class"));
		UClass* Class = FindClassByName(ClassName);
		if (!Class || !Class->IsChildOf(AActor::StaticClass()))
		{
			Error = Class
				? FString::Printf(TEXT("%s 不是 Actor 类，放不进关卡"), *ClassName)
				: FString::Printf(TEXT("找不到类 %s：写原生类名（StaticMeshActor、PointLight）或蓝图路径（/Game/BP/BP_Enemy）"), *ClassName);
			return false;
		}
		if (Class->HasAnyClassFlags(CLASS_Abstract | CLASS_Deprecated | CLASS_NotPlaceable))
		{
			Error = FString::Printf(TEXT("%s 是抽象、已弃用或不能放进关卡的类"), *Class->GetName());
			return false;
		}
		ULevel* Level = FindLevel(World, Str(A, TEXT("level")), Error);
		if (!Level)
		{
			return false;
		}
		const FVector Location = VecArg(A, TEXT("location"), FVector::ZeroVector);
		const FVector Rot = VecArg(A, TEXT("rotation"), FVector::ZeroVector);
		const FVector Scale = VecArg(A, TEXT("scale"), FVector::OneVector);
		const FTransform Transform(FRotator(Rot.X, Rot.Y, Rot.Z), Location, Scale);

		const TSet<UPackage*> Before = DirtyNow();
		FTx Tx(FString::Printf(TEXT("放 %s"), *Class->GetName()));
		Level->Modify();
		// AddActor 和从内容浏览器拖进视口走同一套（放置后处理、选中新 Actor）
		AActor* Actor = GEditor->AddActor(Level, Class, Transform, true, RF_Transactional, Bool(A, TEXT("select"), true));
		if (!Actor)
		{
			FString TxError;
			Tx.Finish(false, TxError);
			Error = FString::Printf(TEXT("引擎没有放成功：%s（详细原因在 UE 的输出日志里）"), *Class->GetName());
			return false;
		}
		const FString Label = Str(A, TEXT("label"));
		if (!Label.IsEmpty())
		{
			Actor->SetActorLabel(Label);
		}
		const FString Folder = Str(A, TEXT("folder"));
		if (!Folder.IsEmpty())
		{
			Actor->SetFolderPath(FName(*Folder));
		}
		NoteDirty(Actor);
		TrackNewDirty(Before, Out);
		FString TxError;
		if (!Tx.Finish(true, TxError))
		{
			Error = TxError;
			return false;
		}
		Out->SetObjectField(TEXT("actor"), ActorJson(Actor));
		Out->SetStringField(TEXT("tx"), Tx.Id);
		return true;
	});

	// ---------- 删掉编辑器关卡里的 Actor ----------
	B.AddOp(TEXT("editor.destroy"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UWorld* World = EditorWorld(Error);
		if (!World)
		{
			return false;
		}
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (!A->TryGetArrayField(TEXT("actors"), Arr) || Arr->Num() == 0)
		{
			Error = TEXT("actors 要给 Actor 路径的数组（ue_find kind=actor 找到的 path）");
			return false;
		}
		if (Arr->Num() > 100)
		{
			Error = TEXT("一次最多删 100 个 Actor");
			return false;
		}
		TArray<AActor*> Actors;
		TArray<TSharedPtr<FJsonValue>> Missing;
		TArray<TSharedPtr<FJsonValue>> Gone;
		for (const TSharedPtr<FJsonValue>& V : *Arr)
		{
			const FString Path = V->AsString();
			AActor* Actor = FindObject<AActor>(nullptr, *Path);
			if (!Actor || Actor->GetWorld() != World || !IsValid(Actor))
			{
				Missing.Add(JStr(Path));
				continue;
			}
			Actors.Add(Actor);
			Gone.Add(JObj(ActorJson(Actor)));
		}
		if (Actors.Num() == 0)
		{
			Error = TEXT("编辑器关卡里一个都没找到（PIE 里的 Actor 不能用这个删）");
			return false;
		}
		UEditorActorSubsystem* Sub = GEditor->GetEditorSubsystem<UEditorActorSubsystem>();
		if (!Sub)
		{
			Error = TEXT("编辑器的 Actor 子系统没加载");
			return false;
		}
		FTx Tx(FString::Printf(TEXT("删 %d 个 Actor"), Actors.Num()));
		const TSet<UPackage*> Before = DirtyNow();
		for (AActor* Actor : Actors)
		{
			if (Actor->GetLevel())
			{
				Actor->GetLevel()->Modify();
			}
		}
		if (!Sub->DestroyActors(Actors))
		{
			FString TxError;
			Tx.Finish(false, TxError);
			Error = TEXT("引擎没有删成功（详细原因在 UE 的输出日志里）");
			return false;
		}
		for (ULevel* L : World->GetLevels())
		{
			if (L && L->GetOutermost()->IsDirty())
			{
				DirtyPackages().Add(L->GetOutermost()->GetName());
			}
		}
		TrackNewDirty(Before, Out);
		FString TxError;
		if (!Tx.Finish(true, TxError))
		{
			Error = TxError;
			return false;
		}
		Out->SetArrayField(TEXT("destroyed"), Gone);
		if (Missing.Num())
		{
			Out->SetArrayField(TEXT("missing"), Missing);
		}
		Out->SetStringField(TEXT("tx"), Tx.Id);
		return true;
	});
}
