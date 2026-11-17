// Lua 调试钩子的几方（快照点、采样 AgentPanelLuaDebugOps.cpp；trace AgentPanelLuaTrace.cpp）之间的内部接口，不对外。
// 一个 lua_State 只能挂一个钩子函数：钩子统一由 AgentPanelLuaDebugOps.cpp 的 HookFn 挂和分发，trace 只告诉它要不要调用 / 返回事件。
#pragma once

#include "CoreMinimal.h"

#if AGENT_PANEL_WITH_LUA

#include "lua.hpp"

namespace AgentPanelLuaDebug
{
	/** 按快照点、采样、trace 现在要什么把钩子挂上、改掩码或放回原来的（见 AgentPanelLuaDebugOps.cpp） */
	void UpdateHook(lua_State* L);
	/** 钩子被别人（IDE 的 Lua 调试器）在我们之后换掉了：这期间收不到事件，照现在的做法不抢回来 */
	bool HookTaken(lua_State* L);
}

namespace AgentPanelLuaTrace
{
	/** trace 现在要不要调用 / 返回事件（录制中、lua 通道开着、钩子挂在这个 lua_State 上） */
	bool WantsCallHook();
	/** HookFn 收到调用、尾调用、返回事件时转过来 */
	void OnHook(lua_State* L, lua_Debug* Ar);
	/** 项目侧报错钩子（FAgentPanelLua::CaptureError）里调：把这次从 C++ 调进来、报错跳出去的帧收尾 */
	void OnLuaError(lua_State* L);

	/** 认标准库 C 函数（string.format 等）要先在主 lua_State 上建一张表：采样、trace 开始时各调一次 */
	void PrepareNames(lua_State* Main);
	/**
	 * 函数的显示名（设计稿 4.3）：Ar 已经 getinfo 过 "Sn"，FnIdx 是这个函数在栈上的位置。
	 * 有调用方名字用「模块:函数」；没有时在 package.loaded[模块] 里找同一个函数的字段名；再没有用「模块:行号」；
	 * C 函数是 lua.<库.名>（标准库）或 UE.<名>。lua.profile 和 trace 共用，第一次见到某个函数时调一次，结果由调用方缓存。
	 */
	FString FunctionName(lua_State* L, lua_Debug* Ar, int FnIdx);
}

#endif
