// 蓝图类默认值的组件树：CDO 上只有 C++ 组件，蓝图组件列表（SCS）里加的要从生成类上接过来。从 RuntimeOps 拆出来
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonValue.h"

class AActor;

namespace AgentPanel
{
	/**
	 * 给蓝图生成类的默认对象补上蓝图组件（自己和父蓝图的 SCS 节点），每项和 components 操作的格式一样，
	 * path 是组件模板（子蓝图覆盖过的取覆盖后的那份），用 props / set 读改它就是改蓝图里这个组件的默认值。
	 * 不是蓝图类时什么都不加
	 */
	void AddBlueprintComponents(AActor* CDO, TArray<TSharedPtr<FJsonValue>>& Items);
}
