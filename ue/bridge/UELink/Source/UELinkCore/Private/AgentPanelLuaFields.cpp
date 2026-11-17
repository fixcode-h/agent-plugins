// 2.8：读对象 Lua 实例表上自己的字段（FAgentPanelLua::ReadFields）。GameTest 录制时给列表条目挑标识要用：
// UnLua 项目的条目数据经常只在 Lua 表上（self.Data.cfgId），反射看不到。
// 只用 lua_next 原样读（不会触发 __index / __pairs 元方法、不调用户函数），所以回放时每帧读也没有副作用；
// 用户的 UnLua 是二次开发版，找实例表沿用 lua.get 的办法（注册表里的对象表，名字不对就扫），不碰 UnLua 内部结构。
#include "AgentPanelLua.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

#if !AGENT_PANEL_WITH_LUA

TSharedPtr<FJsonObject> FAgentPanelLua::ReadFields(UObject*, int32, int32, FString& Error)
{
	Error = TEXT("这个项目没有 Lua（UELink 编译时没找到 UnLua）");
	return nullptr;
}

#else

#include "lua.hpp"
#include "AgentPanelLuaShared.h"

namespace AgentPanelLuaFields
{
	using namespace AgentPanelLuaImpl;

	struct FBudget
	{
		int32 Left = 0;
		bool bMore = false;
	};

	/** 表的一个键 → JSON 字段名：字符串原样，整数写成数字文本；别的类型（表、布尔当键）跳过 */
	bool KeyName(lua_State* L, int K, FString& Out)
	{
		const int Type = lua_type(L, K);
		if (Type == LUA_TSTRING)
		{
			size_t N = 0;
			const char* S = lua_tolstring(L, K, &N); // 键本来就是字符串，lua_tolstring 不会改它，lua_next 照样能接着走
			Out = FromUtf8(S, N);
			return !Out.IsEmpty();
		}
		if (Type == LUA_TNUMBER && lua_isinteger(L, K))
		{
			// 数字键不能用 lua_tolstring：它会把栈上的键原地改成字符串，下一次 lua_next 就找不到位置了
			Out = FString::Printf(TEXT("%lld"), static_cast<long long>(lua_tointeger(L, K)));
			return true;
		}
		return false;
	}

	/** 栈上 T 位置的表 → JSON 对象（递归 Depth 层），字段预算用完就停 */
	TSharedPtr<FJsonObject> ReadTable(lua_State* L, int T, int32 Depth, FBudget& Budget)
	{
		T = lua_absindex(L, T);
		TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
		if (!lua_checkstack(L, 4))
		{
			return Out;
		}
		lua_pushnil(L);
		while (lua_next(L, T))
		{
			// 栈：… 键 值
			if (Budget.Left <= 0)
			{
				Budget.bMore = true;
				lua_pop(L, 2);
				break;
			}
			FString Name;
			if (KeyName(L, -2, Name))
			{
				switch (lua_type(L, -1))
				{
				case LUA_TBOOLEAN:
					Out->SetBoolField(Name, lua_toboolean(L, -1) != 0);
					--Budget.Left;
					break;
				case LUA_TNUMBER:
					Out->SetNumberField(Name, lua_isinteger(L, -1) ? static_cast<double>(lua_tointeger(L, -1)) : lua_tonumber(L, -1));
					--Budget.Left;
					break;
				case LUA_TSTRING:
				{
					size_t N = 0;
					const char* S = lua_tolstring(L, -1, &N);
					Out->SetStringField(Name, FromUtf8(S, N));
					--Budget.Left;
					break;
				}
				case LUA_TTABLE:
					if (Depth > 1)
					{
						--Budget.Left;
						Out->SetObjectField(Name, ReadTable(L, -1, Depth - 1, Budget));
					}
					break;
				default:
					// 函数、userdata（UObject 代理）、协程不是标识，跳过
					break;
				}
			}
			lua_pop(L, 1);
		}
		return Out;
	}
}

TSharedPtr<FJsonObject> FAgentPanelLua::ReadFields(UObject* Obj, int32 MaxDepth, int32 MaxFields, FString& Error)
{
	using namespace AgentPanelLuaImpl;
	if (!IsValid(Obj))
	{
		Error = TEXT("对象已经不在了");
		return nullptr;
	}
	FLuaCtx C;
	if (!C.Open(Obj, Error))
	{
		return nullptr;
	}
	if (!C.Map)
	{
		Error = TEXT("Lua 注册表里没找到 UnLua 的对象表（这个 UnLua 分支可能改了存法）");
		return nullptr;
	}
	FTop Guard(C.L);
	lua_rawgetp(C.L, C.Map, Obj);
	if (!lua_istable(C.L, -1))
	{
		Error = FString::Printf(TEXT("%s 没绑定 Lua 模块，没有实例表"), *Obj->GetName());
		return nullptr;
	}
	AgentPanelLuaFields::FBudget Budget;
	Budget.Left = FMath::Clamp(MaxFields, 1, 2000);
	TSharedPtr<FJsonObject> Out = AgentPanelLuaFields::ReadTable(C.L, -1, FMath::Clamp(MaxDepth, 1, 4), Budget);
	if (Budget.bMore)
	{
		Out->SetBoolField(TEXT("__more"), true);
	}
	return Out;
}

#endif
