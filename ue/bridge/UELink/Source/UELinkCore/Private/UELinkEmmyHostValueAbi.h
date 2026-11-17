// EmmyLua 调试器的「宿主值提供者」C 接口 v2 的本地副本。
// 权威定义在 fixcode-h/IntelliJ-EmmyLua 的 docs/design/variable-view.md 13.6；两边改动要同步。
// UELink 不链接 emmy：只在进程里已经有 emmy runtime（PC 附加注入、或项目自己加载）时，按导出名找到注册函数再注册，
// 所以这里只放纯 C 的结构和函数指针类型，不依赖 emmy 的任何头文件。
#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define UELINK_EMMY_CALL __cdecl
#else
#define UELINK_EMMY_CALL
#endif

struct lua_State;

#define UELINK_EMMY_HOST_VALUE_ABI_VERSION 2u

/** 注册函数的导出名：runtime 没有这个导出（旧版）时 UELink 什么也不做 */
#define UELINK_EMMY_REGISTER_EXPORT "Emmy_RegisterHostValueProviderV2"
#define UELINK_EMMY_UNREGISTER_EXPORT "Emmy_UnregisterHostValueProviderV2"
/** 可选导出（新版 runtime 才有）：id 是否还注册着。没有这个导出时只按模块句柄判断 */
#define UELINK_EMMY_HAS_EXPORT "Emmy_HasHostValueProviderV2"

/** 回调的返回值（和 v1 的 EmmyHostValueStatus 数值一致） */
enum EUELinkEmmyStatus
{
	UELINK_EMMY_OK = 0,              // 认领并写了结果
	UELINK_EMMY_UNAVAILABLE = 1,     // 不认领：runtime 交给 Lua helper 或默认显示
	UELINK_EMMY_NEEDS_GAME_THREAD = 2,
	UELINK_EMMY_OBJECT_INVALID = 3,  // 认领了，但对象已失效（结果里 valid=false）
	UELINK_EMMY_FIELD_DENIED = 4,
	UELINK_EMMY_TIMEOUT = 5,
};

/** 宿主把 UTF-8 JSON 写进 runtime 提供的缓冲；可以分多次写，runtime 拼接 */
typedef void(UELINK_EMMY_CALL* FUELinkEmmyWriteFn)(void* Sink, const char* Utf8, size_t Length);

typedef struct FUELinkEmmyHostValueQuery
{
	uint32_t size;
	uint32_t version;
	uint64_t vmId;
	/** 暂停号：同一暂停内发出的 childRef 有效，暂停结束 runtime 调 releasePause */
	uint64_t pauseId;
	/** 暂停所在的 lua_State，只在本次调用内有效；hostRef 非空时可能为 NULL */
	struct lua_State* L;
	/** 被查询的值（userdata 或 table）在 L 栈上的绝对索引 */
	int32_t index;
	/** 宿主之前在 children[].childRef 里给出的句柄；NULL 表示查询栈上的值 */
	const char* hostRef;
	/** listChildren 的分页（describe 忽略） */
	uint32_t start;
	uint32_t count;
	/** 每个 value 摘要的最大字节数 */
	uint32_t maxValueLength;
	uint64_t deadlineUnixMillis;
	void* sink;
	FUELinkEmmyWriteFn write;
} FUELinkEmmyHostValueQuery;

/**
 * describe 写：{ "valid", "typeName", "summary", "hint"?, "kind", "expandable" }
 * listChildren 写：{ "total", "children": [ { "name", "type", "value", "typeName"?, "kind"?, "attrs"?, "hint"?,
 *                    "length"?, "expandable"?, "childRef"? } ] }
 * 子项里 kind = "group" 的是分组节点（按声明类分组、组件、方法），runtime 原样当成可展开节点。
 */
typedef int(UELINK_EMMY_CALL* FUELinkEmmyQueryFn)(void* UserData, const FUELinkEmmyHostValueQuery* Query);
typedef void(UELINK_EMMY_CALL* FUELinkEmmyReleaseFn)(void* UserData, uint64_t VmId, uint64_t PauseId);

typedef struct FUELinkEmmyHostValueProviderV2
{
	uint32_t size;
	uint32_t version;
	void* userData;
	/** 显示在 runtime 日志里的提供者名字 */
	const char* name;
	FUELinkEmmyQueryFn describe;
	FUELinkEmmyQueryFn listChildren;
	FUELinkEmmyReleaseFn releasePause;
} FUELinkEmmyHostValueProviderV2;

typedef uint64_t(UELINK_EMMY_CALL* FUELinkEmmyRegisterFn)(const FUELinkEmmyHostValueProviderV2* Provider);
typedef int(UELINK_EMMY_CALL* FUELinkEmmyUnregisterFn)(uint64_t ProviderId);
typedef int(UELINK_EMMY_CALL* FUELinkEmmyHasFn)(uint64_t ProviderId);
