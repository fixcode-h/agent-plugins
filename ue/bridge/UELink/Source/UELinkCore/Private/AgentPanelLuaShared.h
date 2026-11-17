// Lua 操作共用的内部工具（只给 UELinkCore 里的 Lua 操作文件用，不对外）：拿 lua_State、对象表、沿路径取值、
// 把 Lua 值描述成 JSON、受保护的读写和调用。定义在 AgentPanelLua.cpp；2.4 起 Lua 的新操作各放自己的 *Ops.cpp，
// include 这个头复用，不往 AgentPanelLua.cpp 里堆。没编进 Lua 支持时这个头是空的。
#pragma once

#include "CoreMinimal.h"

#if AGENT_PANEL_WITH_LUA

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "lua.hpp"

class UObject;

namespace AgentPanelLuaImpl
{
	/** 一层表最多列多少项（再多的分页取）；扫描超过这么多项只排前面这些 */
	constexpr int32 MaxScan = 5000;
	/** 字符串值最多回多少字符 */
	constexpr int32 MaxStr = 2000;

	FString FromUtf8(const char* S, size_t N);
	void PushStr(lua_State* L, const FString& S);

	/** 退出作用域时把 Lua 栈恢复原样：中途出错 return 也不会留垃圾在 UnLua 的主线程栈上 */
	struct FTop
	{
		lua_State* L;
		int Top;
		explicit FTop(lua_State* InL) : L(InL), Top(lua_gettop(InL)) {}
		~FTop() { lua_settop(L, Top); }
	};

	/** UObject 指针还活着（对象表里的键可能是已经销毁的对象） */
	UObject* LiveObject(const void* P);
	/** 按对象（或目标世界的 GameInstance）选 Lua 环境：项目的 SetStateProvider 优先，再按 UnLua 的接口自动选 */
	lua_State* StateFor(UObject* Context, FString& Error);
	/** 请求里 world 指的世界的 GameInstance */
	UObject* WorldContext(const TSharedPtr<FJsonObject>& A);
	/** 找到的对象表在注册表里的键，按 lua_State 记住 */
	TMap<lua_State*, FString>& MapKeys();
	/** 把 UnLua 的对象表（UObject 指针 → 实例表）压栈；没有时什么也不压，返回 false */
	bool PushObjectMap(lua_State* L);

	/** 一次请求里用到的 Lua 上下文：对象表、值→对象、模块表→模块名的反查（按需建一次） */
	struct FLuaCtx
	{
		lua_State* L = nullptr;
		int Map = 0;
		bool bRev = false;
		TMap<const void*, const void*> Rev;
		bool bMods = false;
		TMap<const void*, FString> Mods;

		/**
		 * Open 压在栈上的对象表在用完时弹掉（2.8 起）：以前每次操作都在主线程栈上留一格，
		 * GameTest 回放时每帧读条目的 Lua 字段，不弹会一直往上涨
		 */
		~FLuaCtx()
		{
			if (L && Map && lua_gettop(L) >= Map)
			{
				lua_settop(L, Map - 1);
			}
		}

		bool Open(UObject* Context, FString& Error)
		{
			L = StateFor(Context, Error);
			if (!L)
			{
				return false;
			}
			if (PushObjectMap(L))
			{
				Map = lua_gettop(L);
			}
			return true;
		}

		/** 表 / userdata 是哪个 UObject 的（对象表里反查） */
		UObject* ObjectOf(int Idx)
		{
			if (!Map)
			{
				return nullptr;
			}
			if (!bRev)
			{
				bRev = true;
				int32 N = 0;
				lua_pushnil(L);
				while (lua_next(L, Map))
				{
					const int VT = lua_type(L, -1);
					if (lua_type(L, -2) == LUA_TLIGHTUSERDATA && (VT == LUA_TTABLE || VT == LUA_TUSERDATA))
					{
						Rev.Add(lua_topointer(L, -1), lua_touserdata(L, -2));
					}
					lua_pop(L, 1);
					if (++N >= 500000)
					{
						lua_pop(L, 1);
						break;
					}
				}
			}
			const void* const* P = Rev.Find(lua_topointer(L, Idx));
			return P ? LiveObject(*P) : nullptr;
		}

		FString ModuleOfTable(const void* P)
		{
			if (!bMods)
			{
				bMods = true;
				lua_getfield(L, LUA_REGISTRYINDEX, LUA_LOADED_TABLE);
				if (lua_istable(L, -1))
				{
					lua_pushnil(L);
					while (lua_next(L, -2))
					{
						if (lua_type(L, -2) == LUA_TSTRING && lua_istable(L, -1))
						{
							size_t N = 0;
							const char* S = lua_tolstring(L, -2, &N);
							Mods.Add(lua_topointer(L, -1), FromUtf8(S, N));
						}
						lua_pop(L, 1);
					}
				}
				lua_pop(L, 1);
			}
			const FString* Name = Mods.Find(P);
			return Name ? *Name : FString();
		}

		/** 实例表的模块名：元表本身、元表的 __index、元表的元表，哪个在 package.loaded 里就是哪个 */
		FString ModuleOf(int Idx)
		{
			FTop Guard(L);
			if (!lua_getmetatable(L, Idx))
			{
				return FString();
			}
			const int MT = lua_gettop(L);
			FString Name = ModuleOfTable(lua_topointer(L, MT));
			if (Name.IsEmpty())
			{
				lua_pushstring(L, "__index");
				lua_rawget(L, MT);
				if (lua_istable(L, -1))
				{
					Name = ModuleOfTable(lua_topointer(L, -1));
				}
				lua_pop(L, 1);
			}
			if (Name.IsEmpty() && lua_getmetatable(L, MT))
			{
				Name = ModuleOfTable(lua_topointer(L, -1));
			}
			return Name;
		}
	};

	/** 实现了 UnLuaInterface 的对象：按反射调 GetModuleName */
	FString InterfaceModule(UObject* Obj);
	/** 弹出栈顶的错误信息 */
	FString PopError(lua_State* L);
	/** t[k]，T 是表 / userdata 的绝对位置，键在栈顶；成功时键换成值（走 pcall，元方法报错只变成 Error） */
	bool PGet(lua_State* L, int T, FString& Error);
	/** t[k] = v，键和值在栈顶（键在下），完成后两者都出栈 */
	bool PSet(lua_State* L, int T, FString& Error);
	bool PushJsonKey(lua_State* L, const TSharedPtr<FJsonValue>& K);
	FString KeyText(const TSharedPtr<FJsonValue>& K);
	/** 压起点：给了对象是它的实例表，没给是 _G */
	bool PushRoot(FLuaCtx& C, const FString& Path, UObject* Obj, FString& Error);
	/** 从栈顶的值沿 Keys 的前 Count 段往下走，栈顶换成最后的值 */
	bool Walk(FLuaCtx& C, const TArray<TSharedPtr<FJsonValue>>& Keys, int32 Count, FString& Error);
	int32 CountEntries(lua_State* L, int T, int32 Cap, bool& bMore);
	/** 一个 Lua 值的描述：t、v、n、obj、module、src（见 lua.get） */
	void Describe(FLuaCtx& C, int Idx, const TSharedPtr<FJsonObject>& F);
	void DescribeKey(lua_State* L, int Idx, const TSharedPtr<FJsonObject>& F);
	/** 列一张表的项（排序、分页），写 fields / total / offset / more / truncated */
	void ListTable(FLuaCtx& C, int T, int32 Offset, int32 Limit, const TSharedPtr<FJsonObject>& Out);
	/** 元表链上的函数（最多三层），写 functions */
	void ListFunctions(FLuaCtx& C, int T, const TSharedPtr<FJsonObject>& Out);
	/** JSON 标量 → Lua；bPrevFloat：原来是小数时整数值也按小数写 */
	bool PushJsonValue(lua_State* L, const TSharedPtr<FJsonValue>& V, bool bPrevFloat, FString& Error);
	/** 任意 JSON → Lua：对象、数组转成表（数组下标从 1 开始），最多嵌套 Depth 层 */
	bool PushJsonAny(lua_State* L, const TSharedPtr<FJsonValue>& V, int32 Depth, FString& Error);
	/** 标量的 JSON；表、函数这些返回空 */
	TSharedPtr<FJsonValue> ScalarJson(lua_State* L, int Idx);
	TArray<TSharedPtr<FJsonValue>> KeysOf(const TSharedPtr<FJsonObject>& A);
	/** 有对象路径时找对象（Lua 环境按对象选），没有时按目标世界选 */
	bool OpenFor(const TSharedPtr<FJsonObject>& A, FLuaCtx& C, UObject*& Obj, FString& Error);

	// 执行 Lua：超时钩子和收 print 的输出（lua.exec、lua.call 共用）
	extern double GDeadline;
	void TimeoutHook(lua_State* L, lua_Debug* Ar);
	/** 执行完放回原来的钩子；执行期间 IDE 的 Lua 调试器换过钩子（还在用 TimeoutHook 以外的）就不动，免得把它新挂的盖掉 */
	void RestoreHookAfterTimeout(lua_State* L, lua_Hook OldHook, int OldMask, int OldCount);
	extern TArray<FString>* GPrintSink;
	int PrintFn(lua_State* L);
	int TracebackFn(lua_State* L);
}

#endif
