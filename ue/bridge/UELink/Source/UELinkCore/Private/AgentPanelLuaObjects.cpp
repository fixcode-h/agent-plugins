// 绑了 Lua 的对象列表 lua.objects 和 Lua 垃圾回收 lua.gc（2.19 起从 AgentPanelLua.cpp 挪出来）。
//
// lua.objects 给面板的「Lua 对象树」用：每个对象带状态（待回收 / 世界已关）、所在世界、UE 类继承链、归属（外层的 Actor 或控件），
// 面板据此自己搭「按 Lua 类 / 按 UE 类继承 / 按归属」三种树、做按类名搜（含子类），不用每展开一层来回请求一次。
// 对象表里的键可能是已经释放的地址（用户的 UnLua 是二次开发版，不保证销毁时一定删掉这项）：先在活对象地址集合里查到了才去读它。
#include "AgentPanelLua.h"
#include "AgentPanelLuaOps.h"

#include "AgentPanelBridge.h"

#if !AGENT_PANEL_WITH_LUA

void AgentPanelRegisterLuaObjectOps(FAgentPanelBridge&) {}

#else

#include "AgentPanelBridgeUtil.h"
#include "AgentPanelLuaShared.h"
#include "Blueprint/UserWidget.h"
#include "Components/ActorComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "HAL/PlatformTime.h"
#include "UObject/UObjectArray.h"
#include "UObject/UObjectIterator.h"
#include "lua.hpp"

namespace AgentPanelLuaImpl
{
	bool IsLiveWorld(const UWorld* W)
	{
		if (!W || W->bIsTearingDown || !GEngine)
		{
			return false;
		}
		for (const FWorldContext& Ctx : GEngine->GetWorldContexts())
		{
			if (Ctx.World() == W)
			{
				return true;
			}
		}
		return false;
	}

	TSet<const UObjectBase*> CollectLiveObjects()
	{
		TSet<const UObjectBase*> Live;
		Live.Reserve(GUObjectArray.GetObjectArrayNumMinusAvailable());
		for (TObjectIterator<UObject> It(RF_NoFlags); It; ++It)
		{
			Live.Add(*It);
		}
		return Live;
	}
}

namespace AgentPanelLuaObj
{
	using namespace AgentPanel;
	using namespace AgentPanelLuaImpl;

	/** 「世界已关」只看 Actor、组件、UMG 控件：别的对象（GameInstance、子系统、数据对象）不挂在关卡上 */
	bool LivesInLevel(const UObject* Obj)
	{
		return Obj->IsA<AActor>() || Obj->IsA<UActorComponent>() || Obj->IsA<UUserWidget>();
	}

	/**
	 * 归属：外层链上第一个 Actor 或控件（组件 → Actor，子控件 → 父界面）；Actor 自己没有这样的外层时用它的 Owner（Pawn → 控制器）。
	 * 只认在活对象集合里的，免得读到正在销毁的外层
	 */
	UObject* OwnerOf(UObject* Obj, const TSet<const UObjectBase*>& Live)
	{
		for (UObject* O = Obj->GetOuter(); O && Live.Contains(O); O = O->GetOuter())
		{
			if (O->IsA<AActor>() || O->IsA<UUserWidget>())
			{
				return O;
			}
		}
		if (const AActor* Actor = Cast<AActor>(Obj))
		{
			AActor* Owner = Actor->GetOwner();
			if (Owner && Owner != Obj && Live.Contains(Owner))
			{
				return Owner;
			}
		}
		return nullptr;
	}

	/** 对象的一行：path、name、class、module，再加 state（不是活着时才有）、world、classChain、owner */
	TSharedPtr<FJsonObject> ObjectRow(FLuaCtx& C, UObject* Obj, const TSet<const UObjectBase*>& Live)
	{
		TSharedPtr<FJsonObject> O = Brief(Obj);
		// 没开始玩时 UnLua 只给类（UClass）建了表：这时模块名要问类的默认对象，问类对象本身问的是 BlueprintGeneratedClass
		UClass* AsClass = Cast<UClass>(Obj);
		if (AsClass)
		{
			O->SetBoolField(TEXT("isClass"), true);
		}
		UObject* Cdo = AsClass ? AsClass->GetDefaultObject(false) : nullptr;
		FString Mod = InterfaceModule(Cdo ? Cdo : Obj);
		if (Mod.IsEmpty())
		{
			lua_rawgetp(C.L, C.Map, Obj);
			if (lua_istable(C.L, -1))
			{
				Mod = C.ModuleOf(lua_gettop(C.L));
			}
			lua_pop(C.L, 1);
		}
		O->SetStringField(TEXT("module"), Mod);
		UWorld* World = Obj->GetWorld();
		const bool bWorldLive = World && Live.Contains(World) && IsLiveWorld(World);
		if (!IsValid(Obj))
		{
			O->SetStringField(TEXT("state"), TEXT("garbage"));
		}
		else if (LivesInLevel(Obj) && !Obj->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject) && !bWorldLive)
		{
			O->SetStringField(TEXT("state"), TEXT("noworld"));
		}
		if (bWorldLive)
		{
			O->SetStringField(TEXT("world"), FAgentPanelBridge::WorldId(World));
		}
		if (World && Live.Contains(World))
		{
			O->SetStringField(TEXT("map"), World->GetName());
		}
		// 父类一直到 UObject：面板按它做「按类名搜（含子类）」和 UE 类继承树
		TArray<TSharedPtr<FJsonValue>> Chain;
		for (const UClass* Cls = Obj->GetClass()->GetSuperClass(); Cls; Cls = Cls->GetSuperClass())
		{
			Chain.Add(MakeShared<FJsonValueString>(Cls->GetName()));
		}
		O->SetArrayField(TEXT("classChain"), Chain);
		if (UObject* Owner = OwnerOf(Obj, Live))
		{
			O->SetStringField(TEXT("owner"), Owner->GetPathName());
			O->SetStringField(TEXT("ownerName"), Owner->GetName());
		}
		return O;
	}

	bool ObjectsOp(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		FTop Guard(C.L);
		if (!C.Map)
		{
			Error = TEXT("Lua 注册表里没找到 UnLua 的对象表（这个 UnLua 分支可能改了存法）");
			return false;
		}
		UWorld* World = nullptr;
		if (!Str(A, TEXT("world")).IsEmpty())
		{
			World = FAgentPanelBridge::ResolveWorld(Str(A, TEXT("world")), Error);
			if (!World)
			{
				return false;
			}
		}
		const FString ClassName = Str(A, TEXT("class"));
		UClass* Cls = nullptr;
		if (!ClassName.IsEmpty())
		{
			Cls = ClassName.StartsWith(TEXT("/")) ? FindObject<UClass>(nullptr, *ClassName) : FindFirstObject<UClass>(*ClassName, EFindFirstObjectOptions::NativeFirst);
			if (!Cls && !ClassName.EndsWith(TEXT("_C")))
			{
				Cls = FindFirstObject<UClass>(*(ClassName + TEXT("_C")), EFindFirstObjectOptions::None);
			}
			if (!Cls)
			{
				Error = FString::Printf(TEXT("找不到类 %s：蓝图类要写生成类名（可以省掉 _C），C++ 类不带 U / A 前缀也行，例如 PlayerController"), *ClassName);
				return false;
			}
		}
		const FString Prefix = Str(A, TEXT("prefix"));
		const FString Module = Str(A, TEXT("module"));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 1000);
		lua_State* L = C.L;
		// 先把对象表的键收出来再逐个处理：取模块名时 GetModuleName 可能跑进 Lua、往对象表里加东西，遍历中改表 lua_next 的行为是未定义的
		TArray<const void*> Ptrs;
		lua_pushnil(L);
		while (lua_next(L, C.Map))
		{
			if (lua_type(L, -2) == LUA_TLIGHTUSERDATA && lua_istable(L, -1))
			{
				Ptrs.Add(lua_touserdata(L, -2));
			}
			lua_pop(L, 1);
		}
		const TSet<const UObjectBase*> Live = CollectLiveObjects();
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Stale = 0;
		bool bMore = false;
		for (const void* P : Ptrs)
		{
			const UObjectBase* Base = static_cast<const UObjectBase*>(P);
			if (!Live.Contains(Base) || !GUObjectArray.IsValid(Base))
			{
				// 地址已经不是活对象：只计数，不读（UnLua 销毁时本该删掉这项，分支漏删时会留下）
				++Stale;
				continue;
			}
			UObject* Obj = static_cast<UObject*>(const_cast<UObjectBase*>(Base));
			if (Obj->HasAnyFlags(RF_ClassDefaultObject) || (Cls && !Obj->IsA(Cls)) || !StartsWithNoCase(Obj->GetName(), Prefix))
			{
				continue;
			}
			if (World && Obj->GetWorld() && Obj->GetWorld() != World)
			{
				continue;
			}
			TSharedPtr<FJsonObject> Row = ObjectRow(C, Obj, Live);
			if (!Module.IsEmpty() && !Row->GetStringField(TEXT("module")).Contains(Module, ESearchCase::IgnoreCase))
			{
				continue;
			}
			if (Items.Num() >= Limit)
			{
				bMore = true;
				break;
			}
			Items.Add(MakeShared<FJsonValueObject>(Row));
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetBoolField(TEXT("more"), bMore);
		Out->SetNumberField(TEXT("bound"), Ptrs.Num());
		Out->SetNumberField(TEXT("stale"), Stale);
		Out->SetNumberField(TEXT("memoryKB"), lua_gc(L, LUA_GCCOUNT, 0));
		return true;
	}

	/** collect：跑一次完整的 Lua 垃圾回收；count：只回现在的内存。都回 KB */
	bool GcOp(const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		FLuaCtx C;
		if (!C.Open(WorldContext(A), Error))
		{
			return false;
		}
		FTop Guard(C.L);
		const FString Action = Str(A, TEXT("action"), TEXT("count"));
		if (Action != TEXT("collect") && Action != TEXT("count"))
		{
			Error = FString::Printf(TEXT("不认识的 action %s：只能是 collect（跑一次 Lua 垃圾回收）或 count（只看内存）"), *Action);
			return false;
		}
		const int Before = lua_gc(C.L, LUA_GCCOUNT, 0);
		Out->SetNumberField(TEXT("beforeKB"), Before);
		if (Action == TEXT("collect"))
		{
			const double T0 = FPlatformTime::Seconds();
			lua_gc(C.L, LUA_GCCOLLECT, 0);
			Out->SetNumberField(TEXT("ms"), FMath::RoundToInt((FPlatformTime::Seconds() - T0) * 10000.0) / 10.0);
		}
		Out->SetNumberField(TEXT("afterKB"), lua_gc(C.L, LUA_GCCOUNT, 0));
		return true;
	}
}

void AgentPanelRegisterLuaObjectOps(FAgentPanelBridge& B)
{
	B.AddOp(TEXT("lua.objects"), &AgentPanelLuaObj::ObjectsOp);
	B.AddOp(TEXT("lua.gc"), &AgentPanelLuaObj::GcOp);
}

#endif
