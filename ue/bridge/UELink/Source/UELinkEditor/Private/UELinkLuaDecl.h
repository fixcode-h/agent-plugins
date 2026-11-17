// 后台增量生成 UE 反射的 Lua 声明（EmmyLua 注解）：给 IDE（IntelliJ-EmmyLua / emmylua_ls）做跳转、补全、悬停用。
// 输出到 <项目>/Intermediate/UELink/LuaDecl/，一个类型一个文件，带清单记每个文件的内容哈希，内容没变就不写盘，
// IDE 的语言服务器靠文件监听增量更新索引。格式和 UnLua 的 Generate IntelliSense 一致（类型名、UE 表），旧注解照样能用。
// 操作和输出格式见 docs/protocol.md「Lua 声明」一节。
#pragma once

#include "CoreMinimal.h"

class UField;
class UStruct;
class UClass;
class UEnum;

namespace UELinkLuaDecl
{
	/** 类型在 Lua 注解里的名字：原生类带前缀（AActor），蓝图类是生成类名（BP_Hero_C），结构体 FVector，枚举原名 */
	FString TypeName(const UField* Field);

	/** 一个类型的声明文件内容（类、结构体、枚举）；不该生成的类型返回空 */
	FString Generate(const UField* Field);

	/** 没加载的蓝图先写占位：只有继承关系，Parent 为空时不写父类 */
	FString GenerateStub(const FString& TypeName, const FString& Parent, const FString& AssetPath);

	/** UE.lua：全局 UE 表写成 ---@class UE 加每个原生类型一个字段（UE.AActor、UE.FVector），再补 UnLua 全局 */
	FString GenerateUETable(const TArray<FString>& NativeTypeNames);

	/** 拷 UnLua 自带的静态声明时修正写法：参数后面的 @[opt] 改成 emmylua 认的「参数名?」 */
	FString FixUnLuaStatic(const FString& Content);

	/** 是不是要跳过的临时类型（SKEL_、REINST_、TRASHCLASS_……） */
	bool IsTransientType(const UField* Field);

	/** 编辑器模块启动 / 关闭时调；不是编辑器、commandlet、没开时什么都不做 */
	void Start();
	void Stop();

	/** 操作：luadecl.status、luadecl.run */
	void RegisterOps();
}
