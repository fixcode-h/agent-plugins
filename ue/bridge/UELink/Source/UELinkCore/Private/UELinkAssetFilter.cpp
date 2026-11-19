#include "UELinkAssetFilter.h"
#include "UELinkCompat.h"

#include "AssetRegistry/ARFilter.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Engine/Blueprint.h"

namespace AgentPanel
{
	namespace AssetFilter
	{
		/** 注册表里记父类的标签（FBlueprintTags 在编辑器模块里，这里直接写名字，运行时模块不依赖编辑器） */
		const FName ParentTag(TEXT("ParentClass"));
		const FName NativeParentTag(TEXT("NativeParentClass"));
		/** 父类链最多往上找几层：防止注册表里的数据成环时死循环 */
		constexpr int32 MaxDepth = 32;

		/** 标签值是 /Script/Engine.BlueprintGeneratedClass'/Game/A/BP_X.BP_X_C' 这样的导出文本，取最后的类名并去掉 _C */
		FString ClassName(const FString& TagValue)
		{
			FString S = TagValue;
			S.TrimStartAndEndInline();
			S.RemoveFromEnd(TEXT("'"));
			S.RemoveFromEnd(TEXT("\""));
			int32 Cut = INDEX_NONE;
			if (S.FindLastChar(TEXT('.'), Cut))
			{
				S.RightChopInline(Cut + 1);
			}
			if (S.FindLastChar(TEXT('/'), Cut))
			{
				S.RightChopInline(Cut + 1);
			}
			S.RemoveFromEnd(TEXT("_C"));
			return S;
		}

		FString Normalize(const FString& Name)
		{
			FString S = ClassName(Name);
			return S.ToLower();
		}
	}

	void FilterAssetsByParent(IAssetRegistry& AR, const FString& Parent, TArray<FAssetData>& Assets)
	{
		using namespace AssetFilter;
		const FString Want = Normalize(Parent);
		// 所有蓝图的「类名 → 父类名」：间接父类要沿着这张表往上找
		FARFilter All;
		All.ClassPaths.Add(UBlueprint::StaticClass()->GetClassPathName());
		All.bRecursiveClasses = true;
		TArray<FAssetData> Blueprints;
		AR.GetAssets(All, Blueprints);
		TMap<FString, FString> ParentOf;
		for (const FAssetData& D : Blueprints)
		{
			FString Value;
			if (D.GetTagValue(ParentTag, Value))
			{
				ParentOf.Add(D.AssetName.ToString().ToLower(), Normalize(Value));
			}
		}
		Assets.RemoveAll([&](const FAssetData& D)
		{
			FString Native;
			if (D.GetTagValue(NativeParentTag, Native) && Normalize(Native) == Want)
			{
				return false;
			}
			FString Cur = D.AssetName.ToString().ToLower();
			for (int32 Depth = 0; Depth < MaxDepth; ++Depth)
			{
				const FString* Up = ParentOf.Find(Cur);
				if (!Up)
				{
					return true;
				}
				if (*Up == Want)
				{
					return false;
				}
				Cur = *Up;
			}
			return true;
		});
	}

	void FilterAssetsByTags(const TSharedPtr<FJsonObject>& Tags, TArray<FAssetData>& Assets)
	{
		if (!Tags.IsValid())
		{
			return;
		}
		Assets.RemoveAll([&Tags](const FAssetData& D)
		{
			for (const auto& Pair : Tags->Values)
			{
				FString Want;
				if (!Pair.Value.IsValid() || !Pair.Value->TryGetString(Want))
				{
					continue;
				}
				FString Value;
				if (!D.GetTagValue(FName(*UELINK_JSON_KEY(Pair.Key)), Value))
				{
					return true;
				}
				if (Want != TEXT("*") && !Value.Equals(Want, ESearchCase::IgnoreCase))
				{
					return true;
				}
			}
			return false;
		});
	}
}
