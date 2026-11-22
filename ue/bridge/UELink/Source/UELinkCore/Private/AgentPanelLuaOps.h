// Lua 相关操作的登记入口（AgentPanelLua.cpp）。没编进 Lua 支持时两个函数都什么也不做
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class FAgentPanelBridge;

/** 登记 lua.status、lua.objects、lua.get、lua.set、lua.exec；末尾顺带调下面各组的登记 */
void AgentPanelRegisterLuaOps(FAgentPanelBridge& Bridge);

/** 2.19：绑定对象列表 lua.objects（带状态、类链、归属）、lua.gc（AgentPanelLuaObjects.cpp） */
void AgentPanelRegisterLuaObjectOps(FAgentPanelBridge& Bridge);

/** 2.20：纯 Lua 实例 lua.instances、Lua 设置 lua.config（AgentPanelLuaInstances.cpp） */
void AgentPanelRegisterLuaInstanceOps(FAgentPanelBridge& Bridge);

/** 2.4：lua.check、lua.reload、lua.modules、lua.errors、lua.inspect、lua.call（AgentPanelLuaDevOps.cpp） */
void AgentPanelRegisterLuaDevOps(FAgentPanelBridge& Bridge);

/** 2.4：快照点 lua.snap、性能采样 lua.profile、持有的已销毁 UObject lua.leaks（AgentPanelLuaDebugOps.cpp） */
void AgentPanelRegisterLuaDebugOps(FAgentPanelBridge& Bridge);

/**
 * 2.4：给 EmmyLua 调试器提供 UE 对象属性（UELinkEmmyValues.cpp）：每 2 秒看进程里有没有 emmy runtime，有就注册。
 * 由 AgentPanelRegisterLuaOps 启动，模块关闭时注销。没编进 Lua 支持时什么也不做
 */
void AgentPanelRegisterEmmyValues();
void AgentPanelUnregisterEmmyValues();

/**
 * 2.9.0：Lua 函数进 Unreal Insights trace（AgentPanelLuaTrace.cpp）。只挂开始 / 停止录制的委托，
 * 录制开始后才每帧看 lua 通道开没开、开了才挂钩子。没编进 Lua 支持或引擎没编进 trace 时什么也不做
 */
void AgentPanelRegisterLuaTrace();
void AgentPanelUnregisterLuaTrace();

/** /info 里的 lua 字段：{available, error?, version}，面板按它决定显示不显示 Lua 的入口 */
void AgentPanelLuaInfo(const TSharedPtr<FJsonObject>& Info);
