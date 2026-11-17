// 项目配置和 GameplayTag 的只读浏览（2.4.0 起）：
//   config.files {}                                    进程里加载了哪些配置（Engine、Game、Input……）和合并后的文件
//   config.get {file, section?, key?, filter?, limit?}  不给 section 列 section 名；给了列这个 section 合并后的键值（GConfig 里的最终值）
//   tags.list {filter?, limit?}                        进程里登记的全部 GameplayTag（含 C++ 原生的、DataTable 里的、隐式父级）
//   tags.refs {tag, limit?}                            哪些资源引用了这个 Tag（资源注册表的可搜索名引用，和引用查看器一样）
// 每一层 ini（Base、Default、平台、Saved）各写了什么由面板读文件给出，这里只给进程里最终生效的值。全部只读。
#include "UELinkConfigOps.h"
#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"

#include "AssetRegistry/AssetIdentifier.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "GameplayTagContainer.h"
#include "GameplayTagsManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/Paths.h"

namespace AgentPanel
{
	// 不用匿名命名空间：单体编译时和别的文件的同名小函数会撞
	namespace ConfigOps
	{
		TSharedPtr<FJsonValue> JObj(const TSharedPtr<FJsonObject>& O) { return MakeShared<FJsonValueObject>(O); }

		/** 配置名（Engine）或完整路径 → GConfig 里的文件名；找不到时 Error 列出有哪些 */
		bool ResolveConfig(const FString& Name, FString& Out, FString& Error)
		{
			if (!GConfig)
			{
				Error = TEXT("配置系统还没初始化");
				return false;
			}
			TArray<FString> Names;
			for (const FString& F : GConfig->GetFilenames())
			{
				if (F.Equals(Name, ESearchCase::IgnoreCase) || FPaths::GetBaseFilename(F).Equals(Name, ESearchCase::IgnoreCase))
				{
					Out = F;
					return true;
				}
				Names.AddUnique(FPaths::GetBaseFilename(F));
			}
			Names.Sort();
			Error = FString::Printf(TEXT("进程里没有加载配置 %s（有：%s）"), *Name, *FString::Join(Names, TEXT("、")));
			return false;
		}

		bool Matches(const FString& S, const FString& Filter)
		{
			return Filter.IsEmpty() || S.Contains(Filter, ESearchCase::IgnoreCase);
		}
	}

	void RegisterConfigOps(FAgentPanelBridge& Bridge)
	{
		using namespace ConfigOps;
		Bridge.AddOp(TEXT("config.files"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			if (!GConfig)
			{
				Error = TEXT("配置系统还没初始化");
				return false;
			}
			TArray<FString> Files = GConfig->GetFilenames();
			Files.Sort([](const FString& L, const FString& R) { return FPaths::GetBaseFilename(L) < FPaths::GetBaseFilename(R); });
			TArray<TSharedPtr<FJsonValue>> Items;
			for (const FString& F : Files)
			{
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("name"), FPaths::GetBaseFilename(F));
				O->SetStringField(TEXT("file"), F);
				Items.Add(JObj(O));
			}
			Out->SetArrayField(TEXT("items"), Items);
			return true;
		});

		Bridge.AddOp(TEXT("config.get"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			FString File;
			if (!ResolveConfig(Str(A, TEXT("file"), TEXT("Engine")), File, Error))
			{
				return false;
			}
			const FString Section = Str(A, TEXT("section"));
			const FString Key = Str(A, TEXT("key"));
			const FString Filter = Str(A, TEXT("filter"));
			const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 500), 1, 5000);
			Out->SetStringField(TEXT("file"), FPaths::GetBaseFilename(File));
			Out->SetStringField(TEXT("path"), File);
			if (Section.IsEmpty())
			{
				TArray<FString> Names;
				GConfig->GetSectionNames(File, Names);
				Names.Sort();
				TArray<TSharedPtr<FJsonValue>> Items;
				int32 Total = 0;
				for (const FString& N : Names)
				{
					if (!Matches(N, Filter))
					{
						continue;
					}
					++Total;
					if (Items.Num() < Limit)
					{
						Items.Add(MakeShared<FJsonValueString>(N));
					}
				}
				Out->SetArrayField(TEXT("sections"), Items);
				Out->SetNumberField(TEXT("total"), Total);
				return true;
			}
			Out->SetStringField(TEXT("section"), Section);
			const FConfigSection* Sec = GConfig->GetSection(*Section, false, File);
			TArray<TSharedPtr<FJsonValue>> Values;
			int32 Total = 0;
			if (Sec)
			{
				// 同一个键可以有多个值（数组项 +Key=），按出现顺序一行一个
				for (const TPair<FName, FConfigValue>& Pair : *Sec)
				{
					const FString K = Pair.Key.ToString();
					if ((!Key.IsEmpty() && !K.Equals(Key, ESearchCase::IgnoreCase)) || !Matches(K, Filter))
					{
						continue;
					}
					++Total;
					if (Values.Num() < Limit)
					{
						TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
						O->SetStringField(TEXT("key"), K);
						O->SetStringField(TEXT("value"), Pair.Value.GetValue());
						Values.Add(JObj(O));
					}
				}
			}
			else
			{
				Out->SetBoolField(TEXT("missing"), true);
			}
			Out->SetArrayField(TEXT("values"), Values);
			Out->SetNumberField(TEXT("total"), Total);
			return true;
		});

		Bridge.AddOp(TEXT("tags.list"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString Filter = Str(A, TEXT("filter"));
			const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 20000), 1, 50000);
			UGameplayTagsManager& Manager = UGameplayTagsManager::Get();
			FGameplayTagContainer All;
			Manager.RequestAllGameplayTags(All, false);
			TArray<FGameplayTag> Tags;
			All.GetGameplayTagArray(Tags);
			Tags.Sort([](const FGameplayTag& L, const FGameplayTag& R) { return L.GetTagName().LexicalLess(R.GetTagName()); });
			TArray<TSharedPtr<FJsonValue>> Items;
			int32 Total = 0;
			for (const FGameplayTag& Tag : Tags)
			{
				const FString Name = Tag.ToString();
				if (!Matches(Name, Filter))
				{
					continue;
				}
				++Total;
				if (Items.Num() >= Limit)
				{
					continue;
				}
				TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("tag"), Name);
#if WITH_EDITORONLY_DATA
				// 来源：ini 文件名、DataTable 包名或 Native；隐式父级（只因为有子 Tag 才存在）没有来源
				if (TSharedPtr<FGameplayTagNode> Node = Manager.FindTagNode(Tag))
				{
					const FName Source = Node->GetFirstSourceName();
					if (!Source.IsNone())
					{
						O->SetStringField(TEXT("source"), Source.ToString());
					}
				}
#endif
				Items.Add(JObj(O));
			}
			Out->SetArrayField(TEXT("items"), Items);
			Out->SetNumberField(TEXT("total"), Total);
			return true;
		});

		Bridge.AddOp(TEXT("tags.refs"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString TagName = Str(A, TEXT("tag"));
			const FGameplayTag Tag = FGameplayTag::RequestGameplayTag(FName(*TagName), false);
			if (!Tag.IsValid())
			{
				Error = FString::Printf(TEXT("进程里没有登记 GameplayTag %s"), *TagName);
				return false;
			}
			const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 2000);
			IAssetRegistry& Registry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
			// Tag 引用记在资源注册表的「可搜索名」里（编辑器保存资源时写的），引用查看器查 Tag 也是这样查
			TArray<FAssetIdentifier> Refs;
			Registry.GetReferencers(FAssetIdentifier(FGameplayTag::StaticStruct(), Tag.GetTagName()), Refs, UE::AssetRegistry::EDependencyCategory::SearchableName);
			TArray<FString> Packages;
			for (const FAssetIdentifier& R : Refs)
			{
				if (!R.PackageName.IsNone())
				{
					Packages.AddUnique(R.PackageName.ToString());
				}
			}
			Packages.Sort();
			TArray<TSharedPtr<FJsonValue>> Items;
			for (const FString& P : Packages)
			{
				if (Items.Num() >= Limit)
				{
					break;
				}
				Items.Add(MakeShared<FJsonValueString>(P));
			}
			Out->SetStringField(TEXT("tag"), Tag.ToString());
			Out->SetArrayField(TEXT("items"), Items);
			Out->SetNumberField(TEXT("total"), Packages.Num());
			if (Registry.IsLoadingAssets())
			{
				Out->SetBoolField(TEXT("loading"), true);
			}
			return true;
		});
	}
}
