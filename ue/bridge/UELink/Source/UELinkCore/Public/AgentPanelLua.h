// 装了 UnLua 的项目：面板能搜到绑了 Lua 的对象、看和改 Lua 实例表的字段、按路径看 Lua 全局表、执行 Lua 代码。
// 桥接只用 Lua 的 C 接口（lua_next、lua_rawgetp…）读写，不依赖 UnLua 的内部结构，UnLua 各版本和改过的分支都能用；
// 唯一和 UnLua 版本有关的是「拿到 lua_State」这一步：Build.cs 按 UnLua 头文件里有哪些接口自动选，
// 改动太大、自动选不到时，项目在自己的模块里调 SetStateProvider 告诉桥接用哪个 lua_State。
#pragma once

#include "CoreMinimal.h"

struct lua_State;
class UObject;

class UELINKCORE_API FAgentPanelLua
{
public:
	/**
	 * 项目自己提供 lua_State（优先于自动选的）：Context 是要读的对象，或目标世界的 GameInstance，可能为空。
	 * 多个 Lua 环境（例如每个 GameInstance 一个）时按 Context 返回它所在的环境；返回空表示没有，桥接再试自动的方式。
	 * 例：FAgentPanelLua::SetStateProvider([](UObject* Ctx) { return MyLuaManager::Get().GetState(Ctx); });
	 */
	static void SetStateProvider(TFunction<lua_State*(UObject* Context)> Provider);

	/**
	 * 2.4：项目自己的热重载（lua.reload 优先用它）。UnLua 二次开发版的热重载入口各家不同，桥接不猜：
	 * 项目有热重载时在自己的模块里接上，返回 false 并写 Error 表示没重载成功（原样显示给用户和 Agent）。
	 * 没接时桥接用「清 package.loaded 再 require，把新函数拷回旧模块表」兜底。
	 * 例：FAgentPanelLua::SetReloader([](lua_State* L, const FString& Module, FString& Error) { return MyHotReload(L, Module, Error); });
	 */
	static void SetReloader(TFunction<bool(lua_State* L, const FString& Module, FString& Error)> Reloader);

	/**
	 * 2.4：把一次 Lua 报错交给面板（lua.errors 的 capture 来源）。在项目的 Lua 报错处理函数里调（这时出错的栈还在，
	 * 能记下出错那一帧的局部变量和完整调用栈）；不调时桥接从日志里认报错，只是没有局部变量。
	 * 官方 UnLua 可以在 FUnLuaDelegates::ReportLuaCallError 里调；二次开发版按自己的报错入口接，接完记得照常打日志。
	 */
	static void CaptureError(lua_State* L, const FString& Message);

	/**
	 * 2.8：读一个对象的 Lua 实例表上**自己的**字段（不走元表、不调函数，只用 lua_next 原样读），给 GameTest 挑列表条目的标识用。
	 * 返回 JSON 对象：标量照原样（数字、字符串、布尔），子表展开成对象（键是字符串或整数下标），最多 MaxDepth 层、
	 * 一共 MaxFields 个字段（超过的不读，返回里带 "__more": true）；函数、userdata、协程跳过。
	 * 对象没绑 Lua、Lua 环境没建好、桥接没编进 Lua 支持时返回空并写 Error（都是正常情况，调用方当作「没有 Lua 字段」）。
	 */
	static TSharedPtr<class FJsonObject> ReadFields(UObject* Obj, int32 MaxDepth, int32 MaxFields, FString& Error);
	/** 这个桥接编进了 Lua 支持（项目里有 UnLua） */
	static bool IsCompiledIn();
};
