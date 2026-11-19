// 资源搜索的筛选（2.14）：按蓝图父类、资源注册表标签筛，只读注册表、不加载资源。批量操作（select）选目标用
#pragma once

#include "CoreMinimal.h"
#include "AssetRegistry/AssetData.h"
#include "Dom/JsonObject.h"

class IAssetRegistry;

namespace AgentPanel
{
	/** 只留父类链（直接或间接）里有 Parent 的蓝图；Parent 是类名（BP_EnemyBase、Character，带不带 _C 都行）；2.15 起 C++ 父类认整条继承链 */
	void FilterAssetsByParent(IAssetRegistry& AR, const FString& Parent, TArray<FAssetData>& Assets);
	/** 按名字通配符筛（2.15）：Include 有一个对上才留（空 = 不限），Exclude 对上任一个就去掉；带 / 的模式比对包路径 */
	void FilterAssetsByName(const TArray<FString>& Include, const TArray<FString>& Exclude, TArray<FAssetData>& Assets);
	/** 只留注册表标签对得上的：{"键": "值"}，值写 "*" 表示有这个标签就行 */
	void FilterAssetsByTags(const TSharedPtr<FJsonObject>& Tags, TArray<FAssetData>& Assets);
}
