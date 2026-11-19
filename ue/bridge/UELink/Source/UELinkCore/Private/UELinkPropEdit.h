// set 操作的容器按钮和新建内嵌子对象（2.13.0 从 AgentPanelRuntimeOps.cpp 拆出来并补全）：
// 数组 add / insert / duplicate / remove / clear，集合和映射按键 add / remove / clear，实例化（Instanced）属性新建子对象
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "UObject/UnrealType.h"

class UObject;

namespace AgentPanel
{
	/**
	 * 细节面板容器那几个按钮：直接改容器，不走 JSON 整体替换（整体替换会丢掉实例化子对象里的数据，元素也构造不出默认值）。
	 * Args 里读 array（动作）、index（数组下标）、key（集合元素 / 映射的键）、value（新元素的值）、class（新元素是实例化对象时建哪个类）。
	 * Change 给 PostEditChangeProperty 用；新建了子对象时 Out 写 created（它的路径）
	 */
	bool EditContainer(FProperty* Prop, void* Value, UObject* Owner, const TSharedPtr<FJsonObject>& Args, EPropertyChangeType::Type& Change, TSharedPtr<FJsonObject>& Out, FString& Error);

	/**
	 * 给一个对象属性新建内嵌子对象（细节面板里实例化属性的「选类」下拉）：Outer 是 Owner，标志随 Owner 传下去（类默认值里的是原型）。
	 * 属性不是 Instanced、类也不是 EditInlineNew、类是抽象的或不是属性要的类时返回 nullptr 并写 Error
	 */
	UObject* NewInstance(FObjectPropertyBase* Prop, UObject* Owner, const FString& ClassName, FString& Error);
}
