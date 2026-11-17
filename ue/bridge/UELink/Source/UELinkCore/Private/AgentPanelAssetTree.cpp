#include "AgentPanelAssetTree.h"
#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"

#include "Algo/Sort.h"
#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "UObject/Class.h"

namespace AgentPanel
{
	namespace
	{
		struct FFolderRow
		{
			FString Name;
			FString Path;
		};

		TSharedPtr<FJsonValue> FolderJson(const FFolderRow& F)
		{
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), F.Name);
			O->SetStringField(TEXT("path"), F.Path);
			return MakeShared<FJsonValueObject>(O);
		}

		/**
		 * 挂载根：/Game（显示为 Content）、内容目录在项目里的挂载点（项目插件）、/Engine。
		 * 引擎插件的挂载点（/Niagara 这类）几十个，网页树里是噪音，和 Content Browser 默认一样不列
		 */
		TArray<FFolderRow> MountRoots()
		{
			TArray<FString> Roots;
			FPackageName::QueryRootContentPaths(Roots, false, true, true);
			const FString ProjectDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir());
			TArray<FFolderRow> Plugins;
			bool bGame = false;
			bool bEngine = false;
			for (const FString& Root : Roots)
			{
				if (Root == TEXT("Game"))
				{
					bGame = true;
					continue;
				}
				if (Root == TEXT("Engine"))
				{
					bEngine = true;
					continue;
				}
				// 只读根（/Script、/Temp、/Memory 等）QueryRootContentPaths 已经去掉，这里再按内容目录在不在项目里筛项目插件
				FString Dir;
				if (!FPackageName::TryConvertLongPackageNameToFilename(TEXT("/") + Root + TEXT("/"), Dir))
				{
					continue;
				}
				Dir = FPaths::ConvertRelativePathToFull(Dir);
				if (FPaths::IsUnderDirectory(Dir, ProjectDir))
				{
					Plugins.Add({Root, TEXT("/") + Root});
				}
			}
			Algo::Sort(Plugins, [](const FFolderRow& L, const FFolderRow& R) { return L.Name.Compare(R.Name, ESearchCase::IgnoreCase) < 0; });
			TArray<FFolderRow> Out;
			if (bGame)
			{
				Out.Add({TEXT("Content"), TEXT("/Game")});
			}
			Out.Append(Plugins);
			if (bEngine)
			{
				Out.Add({TEXT("Engine"), TEXT("/Engine")});
			}
			return Out;
		}

		/** 世界分区的外部 Actor / 对象包放在 __ExternalActors__ 这类目录里，Content Browser 不显示，这里也不列 */
		bool HiddenFolder(const FString& Name)
		{
			return Name.StartsWith(TEXT("__External"));
		}
	}

	void RegisterAssetTreeOps(FAgentPanelBridge& Bridge)
	{
		// 资源文件夹树：一次只读一层，只查资源注册表（不加载资源），文件夹在前、按名字排
		Bridge.AddOp(TEXT("assets.children"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			FString Path = Str(A, TEXT("path"), TEXT("/"));
			const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 500), 1, 2000);
			while (Path.Len() > 1 && Path.EndsWith(TEXT("/")))
			{
				Path.LeftChopInline(1);
			}
			if (Path.IsEmpty())
			{
				Path = TEXT("/");
			}

			TArray<TSharedPtr<FJsonValue>> Folders;
			TArray<TSharedPtr<FJsonValue>> Items;
			if (Path == TEXT("/"))
			{
				for (const FFolderRow& F : MountRoots())
				{
					Folders.Add(FolderJson(F));
				}
				Out->SetStringField(TEXT("path"), Path);
				Out->SetArrayField(TEXT("folders"), Folders);
				Out->SetArrayField(TEXT("items"), Items);
				return true;
			}

			int32 Dot = INDEX_NONE;
			if (!Path.StartsWith(TEXT("/")) || Path.FindChar(TEXT('.'), Dot) || !FPackageName::IsValidPath(Path))
			{
				Error = FString::Printf(TEXT("文件夹路径不对：%s。要写成挂载点下的目录，如 /Game/Characters；不知道有哪些挂载点时先传 path=\"/\""), *Path);
				return false;
			}

			UClass* Class = nullptr;
			const FString ClassName = Str(A, TEXT("class"));
			if (!ClassName.IsEmpty())
			{
				Class = FindClassByName(ClassName);
				if (!Class)
				{
					Error = FString::Printf(TEXT("找不到类 %s。写类名（如 StaticMesh、Blueprint）或 /Script/模块.类名，蓝图类要先加载过"), *ClassName);
					return false;
				}
			}

			IAssetRegistry& AR = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();

			// 子文件夹：只要下一层；按类筛时文件夹照样全列（和 Content Browser 的筛选一样），不为数个数扫全树
			TArray<FName> SubPaths;
			AR.GetSubPaths(FName(*Path), SubPaths, false);
			TArray<FFolderRow> FolderRows;
			for (const FName Sub : SubPaths)
			{
				const FString SubPath = Sub.ToString();
				const FString Name = FPaths::GetCleanFilename(SubPath);
				if (!HiddenFolder(Name))
				{
					FolderRows.Add({Name, SubPath});
				}
			}
			Algo::Sort(FolderRows, [](const FFolderRow& L, const FFolderRow& R) { return L.Name.Compare(R.Name, ESearchCase::IgnoreCase) < 0; });

			// 这一层的资源
			FARFilter Filter;
			Filter.PackagePaths.Add(FName(*Path));
			Filter.bRecursivePaths = false;
			if (Class)
			{
				Filter.ClassPaths.Add(Class->GetClassPathName());
				Filter.bRecursiveClasses = true;
			}
			TArray<FAssetData> Found;
			AR.GetAssets(Filter, Found);
			// 重定向器是改名 / 移动留下的，Content Browser 默认不显示
			const FTopLevelAssetPath Redirector(TEXT("/Script/CoreUObject"), TEXT("ObjectRedirector"));
			Found.RemoveAll([&Redirector](const FAssetData& D) { return D.AssetClassPath == Redirector; });
			Algo::Sort(Found, [](const FAssetData& L, const FAssetData& R)
			{
				return L.AssetName.ToString().Compare(R.AssetName.ToString(), ESearchCase::IgnoreCase) < 0;
			});

			// 一层里文件夹加资源最多 Limit 个，多出来的截掉并标 more
			for (const FFolderRow& F : FolderRows)
			{
				if (Folders.Num() >= Limit)
				{
					break;
				}
				Folders.Add(FolderJson(F));
			}
			for (const FAssetData& D : Found)
			{
				if (Folders.Num() + Items.Num() >= Limit)
				{
					break;
				}
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("name"), D.AssetName.ToString());
				O->SetStringField(TEXT("path"), D.GetObjectPathString());
				O->SetStringField(TEXT("class"), D.AssetClassPath.GetAssetName().ToString());
				Items.Add(MakeShared<FJsonValueObject>(O));
			}

			Out->SetStringField(TEXT("path"), Path);
			Out->SetArrayField(TEXT("folders"), Folders);
			Out->SetArrayField(TEXT("items"), Items);
			if (FolderRows.Num() + Found.Num() > Folders.Num() + Items.Num())
			{
				Out->SetBoolField(TEXT("more"), true);
			}
			// 编辑器刚启动时注册表还在扫盘，这时列出来的可能不全，客户端可以稍后重读
			if (AR.IsLoadingAssets())
			{
				Out->SetBoolField(TEXT("loading"), true);
			}
			return true;
		});
	}
}
