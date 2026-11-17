// 给 EmmyLua 调试器提供 UE 对象的属性（断点暂停时变量面板里展开 UObject）。
//
// 为什么在 UELink 里做：调试器只有 Lua 的视角，读 UObject 的属性要经过 UnLua 的 __index（对象已销毁时直接崩，
// 而且列不出全部属性）。UELink 在进程里、能用 UE 反射：按声明类分组列出全部 UPROPERTY、组件、UFunction，
// 结构体和容器分页展开，读之前先确认对象还活着。设计见 IntelliJ-EmmyLua 的 docs/design/variable-view.md 第 8 节。
//
// 怎么接上：不链接 emmy，也不要求项目改代码。每 2 秒看一眼进程里有没有 emmy runtime 的模块，有且导出了
// Emmy_RegisterHostValueProviderV2 就注册（UELinkEmmyHostValueAbi.h）。runtime 在暂停循环里、Lua 所在线程
// （UnLua 是游戏线程）上回调，这时游戏线程停着，属性内存在这一次暂停内不会变；不在游戏线程上就不认领。
//
// 只在编进 Lua 支持（项目有 UnLua）时有效：认 Lua 值是哪个 UObject 要靠 UnLua 的对象表（AgentPanelLuaShared.h）。
#include "AgentPanelLuaOps.h"

#if !AGENT_PANEL_WITH_LUA

void AgentPanelRegisterEmmyValues() {}
void AgentPanelUnregisterEmmyValues() {}

#else

#include "AgentPanelLuaShared.h"
#include "Components/ActorComponent.h"
#include "Containers/Ticker.h"
#include "GameFramework/Actor.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UELinkEmmyHostValueAbi.h"
#include "UObject/EnumProperty.h"
#include "UObject/SoftObjectPtr.h"
#include "UObject/TextProperty.h"
#include "UObject/UnrealType.h"
#include "UObject/UObjectArray.h"

#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include <windows.h>
#include "Windows/HideWindowsPlatformTypes.h"
#else
#include <dlfcn.h>
#endif

DEFINE_LOG_CATEGORY_STATIC(LogUELinkEmmy, Log, All);

namespace UELinkEmmyValues
{
	using namespace AgentPanelLuaImpl;

	/** 一次暂停里最多发多少个句柄：再多说明有人在疯狂展开，后面的行不再给展开入口 */
	constexpr int32 MaxNodes = 100000;
	/** 方法分组最多列多少个（大类有上千个 UFunction，列完也看不过来） */
	constexpr int32 MaxFunctions = 2000;

	enum class ENode : uint8
	{
		Object,      // 一个 UObject：子项是按类分组 + 组件 + 方法
		ClassGroup,  // Owner 上 Struct 这个类自己声明的属性
		Components,  // Actor 的组件
		Functions,   // Owner 类链上的 UFunction
		Struct,      // Ptr 处的一个结构体
		Array,
		Set,
		Map,
	};

	/** 展开句柄指向的东西。Ptr 是属性内存，只在发出它的那次暂停内有效；每次用之前先确认 Owner 还活着 */
	struct FNode
	{
		ENode Kind = ENode::Object;
		TWeakObjectPtr<UObject> Owner;
		const UStruct* Struct = nullptr;
		FProperty* Prop = nullptr;
		void* Ptr = nullptr;
	};

	struct FState
	{
		FTSTicker::FDelegateHandle Tick;
		void* Module = nullptr;
		FUELinkEmmyUnregisterFn Unregister = nullptr;
		FUELinkEmmyHasFn Has = nullptr;
		uint64 ProviderId = 0;

		/** 当前暂停的缓存：句柄表、Lua 值 → UObject 指针的反查表 */
		uint64 VmId = 0;
		uint64 PauseId = 0;
		TArray<FNode> Nodes;
		lua_State* RevState = nullptr;
		bool bRev = false;
		TMap<const void*, const void*> Rev;

		void ResetPause(uint64 InVm, uint64 InPause)
		{
			VmId = InVm;
			PauseId = InPause;
			Nodes.Reset();
			RevState = nullptr;
			bRev = false;
			Rev.Reset();
		}
	};

	FState& S()
	{
		static FState State;
		return State;
	}

	// ---- JSON 输出 ----

	void Emit(const FUELinkEmmyHostValueQuery* Q, const TSharedRef<FJsonObject>& Obj)
	{
		FString Text;
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> W = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text);
		FJsonSerializer::Serialize(Obj, W);
		FTCHARToUTF8 Utf8(*Text);
		if (Q->write)
		{
			Q->write(Q->sink, Utf8.Get(), static_cast<size_t>(Utf8.Length()));
		}
	}

	/** 按字节上限截断（UTF-8 计），超出加 … */
	FString Clip(const FString& Text, uint32 MaxBytes)
	{
		const int32 Limit = FMath::Max<int32>(16, static_cast<int32>(MaxBytes));
		if (FTCHARToUTF8(*Text).Length() <= Limit)
		{
			return Text;
		}
		// 按字符截到字节数以内（中文一个字 3 字节），每次少截一些，避免逐字循环
		FString Out = Text.Left(Limit);
		while (Out.Len() > 0 && FTCHARToUTF8(*Out).Length() > Limit - 3)
		{
			Out = Out.LeftChop(FMath::Max(1, Out.Len() / 8));
		}
		return Out + TEXT("…");
	}

	FString Quote(const FString& Text, uint32 MaxBytes)
	{
		FString Esc = Text.ReplaceCharWithEscapedChar();
		Esc.ReplaceInline(TEXT("\""), TEXT("\\\""));
		return TEXT("\"") + Clip(Esc, MaxBytes > 2 ? MaxBytes - 2 : MaxBytes) + TEXT("\"");
	}

	FString NewRef(ENode Kind, UObject* Owner, const UStruct* Struct = nullptr, FProperty* Prop = nullptr, void* Ptr = nullptr)
	{
		FState& St = S();
		if (St.Nodes.Num() >= MaxNodes)
		{
			return FString();
		}
		FNode N;
		N.Kind = Kind;
		N.Owner = Owner;
		N.Struct = Struct;
		N.Prop = Prop;
		N.Ptr = Ptr;
		const int32 Id = St.Nodes.Add(N);
		return FString::Printf(TEXT("uel:%llu:%d"), St.PauseId, Id);
	}

	const FNode* FindRef(const char* Ref)
	{
		FState& St = S();
		const FString R = UTF8_TO_TCHAR(Ref);
		FString Head, Rest;
		if (!R.Split(TEXT(":"), &Head, &Rest) || Head != TEXT("uel"))
		{
			return nullptr;
		}
		FString PauseText, IdText;
		if (!Rest.Split(TEXT(":"), &PauseText, &IdText) || FCString::Strtoui64(*PauseText, nullptr, 10) != St.PauseId)
		{
			return nullptr;
		}
		const int32 Id = FCString::Atoi(*IdText);
		return St.Nodes.IsValidIndex(Id) ? &St.Nodes[Id] : nullptr;
	}

	// ---- Lua 值 → UObject ----

	/**
	 * 栈上的 userdata / 实例表对应的 UObject 原始指针（可能已经销毁，调用方再判断）。
	 * 用 UnLua 的对象表反查，不读 userdata 的内存布局（用户的 UnLua 可能是改过的分支）；反查表一次暂停建一次。
	 */
	const void* RawObjectOf(lua_State* L, int Idx)
	{
		FState& St = S();
		if (!St.bRev || St.RevState != L)
		{
			St.bRev = true;
			St.RevState = L;
			St.Rev.Reset();
			FTop Guard(L);
			if (PushObjectMap(L))
			{
				const int Map = lua_gettop(L);
				int32 N = 0;
				lua_pushnil(L);
				while (lua_next(L, Map))
				{
					const int VT = lua_type(L, -1);
					if (lua_type(L, -2) == LUA_TLIGHTUSERDATA && (VT == LUA_TTABLE || VT == LUA_TUSERDATA))
					{
						St.Rev.Add(lua_topointer(L, -1), lua_touserdata(L, -2));
					}
					lua_pop(L, 1);
					if (++N >= 500000)
					{
						lua_pop(L, 1);
						break;
					}
				}
			}
		}
		const void* const* P = St.Rev.Find(lua_topointer(L, Idx));
		return P ? *P : nullptr;
	}

	// ---- 一行属性 ----

	FString TypeNameOf(const UStruct* Struct)
	{
		if (const UClass* C = Cast<UClass>(Struct))
		{
			return C->GetName();
		}
		if (const UScriptStruct* SS = Cast<UScriptStruct>(Struct))
		{
			return SS->GetStructCPPName();
		}
		return Struct ? Struct->GetName() : FString();
	}

	FString CppTypeOf(FProperty* P)
	{
		FString Ext;
		const FString Base = P->GetCPPType(&Ext, CPPF_None);
		return Base + Ext;
	}

	/** 结构体能不能直接用导出文本当摘要：字段不多、没有容器和对象（导出文本可能很长） */
	bool IsSmallStruct(const UScriptStruct* SS)
	{
		int32 N = 0;
		for (TFieldIterator<FProperty> It(SS); It; ++It)
		{
			if (++N > 8 || CastField<FArrayProperty>(*It) || CastField<FMapProperty>(*It) || CastField<FSetProperty>(*It) ||
				CastField<FObjectPropertyBase>(*It) || CastField<FStructProperty>(*It))
			{
				return false;
			}
		}
		return true;
	}

	FString ExportText(FProperty* P, const void* V)
	{
		FString Text;
		P->ExportTextItem_Direct(Text, V, nullptr, nullptr, PPF_None);
		return Text;
	}

	/** 一个对象作为一行：名字、类名、路径；已失效时只给 <已失效> */
	void FillObjectRow(const TSharedRef<FJsonObject>& Row, UObject* Obj, bool bWasSet)
	{
		if (!Obj)
		{
			Row->SetStringField(TEXT("type"), bWasSet ? TEXT("userdata") : TEXT("nil"));
			Row->SetStringField(TEXT("value"), bWasSet ? TEXT("<已失效>") : TEXT("nil"));
			if (bWasSet)
			{
				Row->SetStringField(TEXT("kind"), TEXT("ueObject"));
				TArray<TSharedPtr<FJsonValue>> Attrs;
				Attrs.Add(MakeShared<FJsonValueString>(TEXT("invalid")));
				Row->SetArrayField(TEXT("attrs"), Attrs);
			}
			return;
		}
		Row->SetStringField(TEXT("type"), TEXT("userdata"));
		Row->SetStringField(TEXT("kind"), TEXT("ueObject"));
		Row->SetStringField(TEXT("typeName"), Obj->GetClass()->GetName());
		Row->SetStringField(TEXT("value"), Obj->GetName());
		Row->SetStringField(TEXT("hint"), Obj->GetPathName());
		const FString Ref = NewRef(ENode::Object, Obj);
		if (!Ref.IsEmpty())
		{
			Row->SetBoolField(TEXT("expandable"), true);
			Row->SetStringField(TEXT("childRef"), Ref);
		}
	}

	TSharedRef<FJsonObject> PropertyRow(const FString& Name, FProperty* P, void* V, UObject* Owner, uint32 MaxLen)
	{
		TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
		Row->SetStringField(TEXT("name"), Name);
		if (FBoolProperty* BP = CastField<FBoolProperty>(P))
		{
			Row->SetStringField(TEXT("type"), TEXT("boolean"));
			Row->SetStringField(TEXT("value"), BP->GetPropertyValue(V) ? TEXT("true") : TEXT("false"));
			return Row;
		}
		const UEnum* Enum = nullptr;
		if (FEnumProperty* EP = CastField<FEnumProperty>(P))
		{
			Enum = EP->GetEnum();
		}
		else if (FByteProperty* ByP = CastField<FByteProperty>(P))
		{
			Enum = ByP->Enum;
		}
		if (Enum)
		{
			// 枚举属性的底层整数和它在同一块内存上；字节枚举本身就是整数属性
			FNumericProperty* Under = CastField<FEnumProperty>(P) ? CastField<FEnumProperty>(P)->GetUnderlyingProperty() : CastField<FNumericProperty>(P);
			const int64 Raw = Under ? Under->GetSignedIntPropertyValue(V) : 0;
			const FString Item = Enum->GetNameStringByValue(Raw);
			Row->SetStringField(TEXT("type"), TEXT("number"));
			Row->SetStringField(TEXT("kind"), TEXT("ueEnum"));
			Row->SetStringField(TEXT("typeName"), Enum->GetName());
			Row->SetStringField(TEXT("value"), FString::Printf(TEXT("%s::%s (%lld)"), *Enum->GetName(), Item.IsEmpty() ? TEXT("?") : *Item, Raw));
			return Row;
		}
		if (FNumericProperty* NP = CastField<FNumericProperty>(P))
		{
			Row->SetStringField(TEXT("type"), TEXT("number"));
			if (NP->IsFloatingPoint())
			{
				FString Text = FString::SanitizeFloat(NP->GetFloatingPointPropertyValue(V));
				Row->SetStringField(TEXT("kind"), TEXT("float"));
				Row->SetStringField(TEXT("value"), Text);
			}
			else
			{
				Row->SetStringField(TEXT("kind"), TEXT("integer"));
				Row->SetStringField(TEXT("value"), NP->GetNumericPropertyValueToString(V));
			}
			Row->SetStringField(TEXT("typeName"), CppTypeOf(P));
			return Row;
		}
		if (FStrProperty* SP = CastField<FStrProperty>(P))
		{
			const FString& Str = SP->GetPropertyValue(V);
			Row->SetStringField(TEXT("type"), TEXT("string"));
			Row->SetStringField(TEXT("typeName"), TEXT("FString"));
			Row->SetStringField(TEXT("value"), Quote(Str, MaxLen));
			Row->SetNumberField(TEXT("length"), FTCHARToUTF8(*Str).Length());
			return Row;
		}
		if (FNameProperty* NmP = CastField<FNameProperty>(P))
		{
			Row->SetStringField(TEXT("type"), TEXT("string"));
			Row->SetStringField(TEXT("typeName"), TEXT("FName"));
			Row->SetStringField(TEXT("value"), Quote(NmP->GetPropertyValue(V).ToString(), MaxLen));
			return Row;
		}
		if (FTextProperty* TP = CastField<FTextProperty>(P))
		{
			Row->SetStringField(TEXT("type"), TEXT("string"));
			Row->SetStringField(TEXT("typeName"), TEXT("FText"));
			Row->SetStringField(TEXT("value"), TEXT("text ") + Quote(TP->GetPropertyValue(V).ToString(), MaxLen));
			return Row;
		}
		if (FSoftObjectProperty* SoP = CastField<FSoftObjectProperty>(P))
		{
			// 软引用不解析、不加载：只显示路径，没加载的标出来
			const FSoftObjectPtr& Soft = *static_cast<const FSoftObjectPtr*>(V);
			Row->SetStringField(TEXT("type"), TEXT("userdata"));
			Row->SetStringField(TEXT("typeName"), CppTypeOf(P));
			const FString Path = Soft.ToString();
			Row->SetStringField(TEXT("value"), Path.IsEmpty() ? TEXT("nil") : Clip(Soft.Get() ? Path : Path + TEXT("（未加载）"), MaxLen));
			return Row;
		}
		if (FObjectPropertyBase* OP = CastField<FObjectPropertyBase>(P))
		{
			// UPROPERTY 引用被 GC 跟踪：要么活着要么已清空；弱引用可能指向待销毁对象，统一用 IsValid 再确认
			UObject* Obj = OP->GetObjectPropertyValue(V);
			const bool bWasSet = Obj != nullptr;
			FillObjectRow(Row, IsValid(Obj) ? Obj : nullptr, bWasSet);
			if (!Row->HasField(TEXT("typeName")) && OP->PropertyClass)
			{
				Row->SetStringField(TEXT("typeName"), OP->PropertyClass->GetName());
			}
			return Row;
		}
		if (FInterfaceProperty* IP = CastField<FInterfaceProperty>(P))
		{
			UObject* Obj = IP->GetPropertyValue(V).GetObject();
			FillObjectRow(Row, IsValid(Obj) ? Obj : nullptr, Obj != nullptr);
			return Row;
		}
		if (FStructProperty* StP = CastField<FStructProperty>(P))
		{
			Row->SetStringField(TEXT("type"), TEXT("userdata"));
			Row->SetStringField(TEXT("kind"), TEXT("ueStruct"));
			Row->SetStringField(TEXT("typeName"), TypeNameOf(StP->Struct));
			Row->SetStringField(TEXT("value"), IsSmallStruct(StP->Struct) ? Clip(ExportText(P, V), MaxLen) : TEXT("{…}"));
			const FString Ref = NewRef(ENode::Struct, Owner, StP->Struct, P, V);
			if (!Ref.IsEmpty())
			{
				Row->SetBoolField(TEXT("expandable"), true);
				Row->SetStringField(TEXT("childRef"), Ref);
			}
			return Row;
		}
		int32 Num = -1;
		ENode Kind = ENode::Array;
		if (FArrayProperty* AP = CastField<FArrayProperty>(P))
		{
			Num = FScriptArrayHelper(AP, V).Num();
			Kind = ENode::Array;
		}
		else if (FSetProperty* SetP = CastField<FSetProperty>(P))
		{
			Num = FScriptSetHelper(SetP, V).Num();
			Kind = ENode::Set;
		}
		else if (FMapProperty* MP = CastField<FMapProperty>(P))
		{
			Num = FScriptMapHelper(MP, V).Num();
			Kind = ENode::Map;
		}
		if (Num >= 0)
		{
			Row->SetStringField(TEXT("type"), TEXT("userdata"));
			Row->SetStringField(TEXT("kind"), TEXT("ueContainer"));
			Row->SetStringField(TEXT("typeName"), CppTypeOf(P));
			Row->SetStringField(TEXT("value"), FString::Printf(TEXT("Num=%d"), Num));
			Row->SetNumberField(TEXT("length"), Num);
			if (Num > 0)
			{
				const FString Ref = NewRef(Kind, Owner, nullptr, P, V);
				if (!Ref.IsEmpty())
				{
					Row->SetBoolField(TEXT("expandable"), true);
					Row->SetStringField(TEXT("childRef"), Ref);
				}
			}
			return Row;
		}
		// 委托、多播委托、其他：导出文本当摘要，不展开
		Row->SetStringField(TEXT("type"), TEXT("userdata"));
		Row->SetStringField(TEXT("typeName"), CppTypeOf(P));
		Row->SetStringField(TEXT("value"), Clip(ExportText(P, V), MaxLen));
		return Row;
	}

	TSharedRef<FJsonObject> GroupRow(const FString& Name, const FString& Value, const FString& Ref, int32 Count)
	{
		TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
		Row->SetStringField(TEXT("name"), Name);
		Row->SetStringField(TEXT("type"), TEXT("table"));
		Row->SetStringField(TEXT("kind"), TEXT("group"));
		Row->SetStringField(TEXT("value"), Value);
		Row->SetNumberField(TEXT("length"), Count);
		if (!Ref.IsEmpty())
		{
			Row->SetBoolField(TEXT("expandable"), true);
			Row->SetStringField(TEXT("childRef"), Ref);
		}
		return Row;
	}

	// ---- 各种节点的子项（只构造请求的那一页） ----

	struct FPage
	{
		int32 Start = 0;
		int32 Count = 100;
		int32 Total = 0;
		TArray<TSharedPtr<FJsonValue>> Rows;

		bool Want(int32 Index) const { return Index >= Start && Index < Start + Count; }
		void Add(const TSharedRef<FJsonObject>& Row) { Rows.Add(MakeShared<FJsonValueObject>(Row)); }
	};

	/** 类链上自己声明了属性的类，最派生的在前 */
	TArray<const UClass*> ClassesWithProperties(const UClass* Class)
	{
		TArray<const UClass*> Out;
		for (const UClass* C = Class; C; C = C->GetSuperClass())
		{
			if (TFieldIterator<FProperty>(C, EFieldIteratorFlags::ExcludeSuper))
			{
				Out.Add(C);
			}
		}
		return Out;
	}

	int32 CountOwnProperties(const UStruct* Struct)
	{
		int32 N = 0;
		for (TFieldIterator<FProperty> It(Struct, EFieldIteratorFlags::ExcludeSuper); It; ++It)
		{
			++N;
		}
		return N;
	}

	void ObjectChildren(UObject* Obj, FPage& Page)
	{
		int32 Index = 0;
		// 按声明类分组：和细节面板一样，属性在各自声明的类下面，按声明顺序
		for (const UClass* C : ClassesWithProperties(Obj->GetClass()))
		{
			if (Page.Want(Index))
			{
				const int32 N = CountOwnProperties(C);
				Page.Add(GroupRow(C->GetName(), FString::Printf(TEXT("%d 个属性"), N), NewRef(ENode::ClassGroup, Obj, C), N));
			}
			++Index;
		}
		if (AActor* Actor = Cast<AActor>(Obj))
		{
			const int32 N = Actor->GetComponents().Num();
			if (N > 0)
			{
				if (Page.Want(Index))
				{
					Page.Add(GroupRow(TEXT("组件"), FString::Printf(TEXT("%d 个"), N), NewRef(ENode::Components, Obj), N));
				}
				++Index;
			}
		}
		if (Page.Want(Index))
		{
			int32 N = 0;
			for (TFieldIterator<UFunction> It(Obj->GetClass()); It && N < MaxFunctions; ++It)
			{
				++N;
			}
			Page.Add(GroupRow(TEXT("方法 (UFunction)"), FString::Printf(TEXT("%d 个"), N), NewRef(ENode::Functions, Obj, Obj->GetClass()), N));
		}
		++Index;
		Page.Total = Index;
	}

	void StructChildren(const UStruct* Struct, void* Base, UObject* Owner, bool bOwnOnly, uint32 MaxLen, FPage& Page)
	{
		int32 Index = 0;
		for (TFieldIterator<FProperty> It(Struct, bOwnOnly ? EFieldIteratorFlags::ExcludeSuper : EFieldIteratorFlags::IncludeSuper); It; ++It, ++Index)
		{
			if (Page.Want(Index))
			{
				Page.Add(PropertyRow(It->GetAuthoredName(), *It, It->ContainerPtrToValuePtr<void>(Base), Owner, MaxLen));
			}
		}
		Page.Total = Index;
	}

	FString FunctionSignature(const UFunction* Fn)
	{
		FString Params;
		FString Ret;
		for (TFieldIterator<FProperty> It(Fn); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
		{
			if (It->HasAnyPropertyFlags(CPF_ReturnParm))
			{
				Ret = CppTypeOf(*It);
				continue;
			}
			if (!Params.IsEmpty())
			{
				Params += TEXT(", ");
			}
			Params += It->GetAuthoredName() + TEXT(": ") + CppTypeOf(*It);
		}
		return FString::Printf(TEXT("(%s)%s"), *Params, Ret.IsEmpty() ? TEXT("") : *(TEXT(" -> ") + Ret));
	}

	void FunctionChildren(const UClass* Class, FPage& Page)
	{
		// 按名字排：方法很多时按名字找比按声明顺序快
		TArray<const UFunction*> Fns;
		for (TFieldIterator<UFunction> It(Class); It && Fns.Num() < MaxFunctions; ++It)
		{
			Fns.Add(*It);
		}
		Fns.Sort([](const UFunction& A, const UFunction& B) { return A.GetName() < B.GetName(); });
		for (int32 i = 0; i < Fns.Num(); ++i)
		{
			if (Page.Want(i))
			{
				TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
				Row->SetStringField(TEXT("name"), Fns[i]->GetName());
				Row->SetStringField(TEXT("type"), TEXT("function"));
				Row->SetStringField(TEXT("kind"), TEXT("cfunction"));
				Row->SetStringField(TEXT("typeName"), Fns[i]->GetOwnerClass() ? Fns[i]->GetOwnerClass()->GetName() : FString());
				Row->SetStringField(TEXT("value"), FunctionSignature(Fns[i]));
				Page.Add(Row);
			}
		}
		Page.Total = Fns.Num();
	}

	void ComponentChildren(AActor* Actor, FPage& Page)
	{
		TArray<UActorComponent*> Comps;
		Actor->GetComponents(Comps);
		Comps.Sort([](const UActorComponent& A, const UActorComponent& B) { return A.GetName() < B.GetName(); });
		for (int32 i = 0; i < Comps.Num(); ++i)
		{
			if (Page.Want(i))
			{
				TSharedRef<FJsonObject> Row = MakeShared<FJsonObject>();
				Row->SetStringField(TEXT("name"), Comps[i]->GetName());
				FillObjectRow(Row, IsValid(Comps[i]) ? Comps[i] : nullptr, true);
				Page.Add(Row);
			}
		}
		Page.Total = Comps.Num();
	}

	void ContainerChildren(const FNode& N, UObject* Owner, uint32 MaxLen, FPage& Page)
	{
		if (FArrayProperty* AP = CastField<FArrayProperty>(N.Prop))
		{
			FScriptArrayHelper H(AP, N.Ptr);
			Page.Total = H.Num();
			// Lua 里 UnLua 的 TArray 下标从 1 开始，显示和它一致
			for (int32 i = Page.Start; i < FMath::Min(H.Num(), Page.Start + Page.Count); ++i)
			{
				Page.Add(PropertyRow(FString::Printf(TEXT("[%d]"), i + 1), AP->Inner, H.GetRawPtr(i), Owner, MaxLen));
			}
		}
		else if (FSetProperty* SP = CastField<FSetProperty>(N.Prop))
		{
			FScriptSetHelper H(SP, N.Ptr);
			Page.Total = H.Num();
			for (int32 i = 0, n = 0; i < H.GetMaxIndex() && n < Page.Start + Page.Count; ++i)
			{
				if (H.IsValidIndex(i))
				{
					if (n >= Page.Start)
					{
						Page.Add(PropertyRow(FString::Printf(TEXT("[%d]"), n + 1), SP->ElementProp, H.GetElementPtr(i), Owner, MaxLen));
					}
					++n;
				}
			}
		}
		else if (FMapProperty* MP = CastField<FMapProperty>(N.Prop))
		{
			FScriptMapHelper H(MP, N.Ptr);
			Page.Total = H.Num();
			for (int32 i = 0, n = 0; i < H.GetMaxIndex() && n < Page.Start + Page.Count; ++i)
			{
				if (H.IsValidIndex(i))
				{
					if (n >= Page.Start)
					{
						// 键用摘要当名字：字符串键带引号，和 Lua 表的非标识符键写法一致
						TSharedRef<FJsonObject> KeyRow = PropertyRow(FString(), MP->KeyProp, H.GetKeyPtr(i), Owner, 64);
						FString Key;
						KeyRow->TryGetStringField(TEXT("value"), Key);
						Page.Add(PropertyRow(TEXT("[") + Key + TEXT("]"), MP->ValueProp, H.GetValuePtr(i), Owner, MaxLen));
					}
					++n;
				}
			}
		}
	}

	// ---- 回调 ----

	/** 进入一次查询：换了暂停就清缓存；不在游戏线程上不认领 */
	bool Enter(const FUELinkEmmyHostValueQuery* Q)
	{
		if (!Q || Q->size < sizeof(FUELinkEmmyHostValueQuery) || !IsInGameThread() || IsGarbageCollecting())
		{
			return false;
		}
		FState& St = S();
		if (St.VmId != Q->vmId || St.PauseId != Q->pauseId)
		{
			St.ResetPause(Q->vmId, Q->pauseId);
		}
		return true;
	}

	/** 查询指向的根对象：栈上的值或句柄。bClaimed=false 表示不是 UE 对象，交给 runtime 的其他来源 */
	UObject* ResolveRoot(const FUELinkEmmyHostValueQuery* Q, bool& bClaimed)
	{
		bClaimed = false;
		if (!Q->L || Q->hostRef)
		{
			return nullptr;
		}
		const int T = lua_type(Q->L, Q->index);
		if (T != LUA_TUSERDATA && T != LUA_TTABLE)
		{
			return nullptr;
		}
		const void* Raw = RawObjectOf(Q->L, Q->index);
		if (!Raw)
		{
			return nullptr;
		}
		bClaimed = true;
		// 先在活着的对象里确认，确认之前不读指针指向的内存（对象可能早就释放了）
		return LiveObject(Raw);
	}

	int UELINK_EMMY_CALL Describe(void*, const FUELinkEmmyHostValueQuery* Q)
	{
		if (!Enter(Q))
		{
			return UELINK_EMMY_NEEDS_GAME_THREAD;
		}
		TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
		if (Q->hostRef)
		{
			// 句柄本身的描述由 listChildren 那一行给过了，这里只确认对象还在
			const FNode* N = FindRef(Q->hostRef);
			if (!N)
			{
				return UELINK_EMMY_UNAVAILABLE;
			}
			const bool bValid = N->Owner.IsValid();
			Out->SetBoolField(TEXT("valid"), bValid);
			if (!bValid)
			{
				Out->SetStringField(TEXT("summary"), TEXT("<已失效>"));
			}
			Emit(Q, Out);
			return bValid ? UELINK_EMMY_OK : UELINK_EMMY_OBJECT_INVALID;
		}
		bool bClaimed = false;
		UObject* Obj = ResolveRoot(Q, bClaimed);
		if (!bClaimed)
		{
			return UELINK_EMMY_UNAVAILABLE;
		}
		Out->SetStringField(TEXT("kind"), TEXT("ueObject"));
		if (!Obj)
		{
			Out->SetBoolField(TEXT("valid"), false);
			Out->SetStringField(TEXT("summary"), TEXT("<已失效>"));
			Emit(Q, Out);
			return UELINK_EMMY_OBJECT_INVALID;
		}
		Out->SetBoolField(TEXT("valid"), true);
		Out->SetStringField(TEXT("typeName"), Obj->GetClass()->GetName());
		Out->SetStringField(TEXT("summary"), Clip(Obj->GetName(), Q->maxValueLength));
		Out->SetStringField(TEXT("hint"), Obj->GetPathName());
		Out->SetBoolField(TEXT("expandable"), true);
		Emit(Q, Out);
		return UELINK_EMMY_OK;
	}

	int UELINK_EMMY_CALL ListChildren(void*, const FUELinkEmmyHostValueQuery* Q)
	{
		if (!Enter(Q))
		{
			return UELINK_EMMY_NEEDS_GAME_THREAD;
		}
		FPage Page;
		Page.Start = static_cast<int32>(FMath::Min<uint32>(Q->start, MAX_int32));
		Page.Count = static_cast<int32>(FMath::Clamp<uint32>(Q->count == 0 ? 100 : Q->count, 1, 1000));
		const uint32 MaxLen = Q->maxValueLength == 0 ? 256 : FMath::Min<uint32>(Q->maxValueLength, 1024);
		TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();

		if (!Q->hostRef)
		{
			bool bClaimed = false;
			UObject* Obj = ResolveRoot(Q, bClaimed);
			if (!bClaimed)
			{
				return UELINK_EMMY_UNAVAILABLE;
			}
			if (!Obj)
			{
				Out->SetBoolField(TEXT("valid"), false);
				Out->SetNumberField(TEXT("total"), 0);
				Out->SetArrayField(TEXT("children"), TArray<TSharedPtr<FJsonValue>>());
				Emit(Q, Out);
				return UELINK_EMMY_OBJECT_INVALID;
			}
			ObjectChildren(Obj, Page);
		}
		else
		{
			const FNode* Found = FindRef(Q->hostRef);
			if (!Found)
			{
				return UELINK_EMMY_UNAVAILABLE;
			}
			// 拷一份：下面构造行时会往 Nodes 里加句柄，数组扩容后原来的指针就失效了
			const FNode N = *Found;
			UObject* Owner = N.Owner.Get();
			if (!IsValid(Owner))
			{
				Out->SetBoolField(TEXT("valid"), false);
				Out->SetNumberField(TEXT("total"), 0);
				Out->SetArrayField(TEXT("children"), TArray<TSharedPtr<FJsonValue>>());
				Emit(Q, Out);
				return UELINK_EMMY_OBJECT_INVALID;
			}
			switch (N.Kind)
			{
			case ENode::Object:
				ObjectChildren(Owner, Page);
				break;
			case ENode::ClassGroup:
				StructChildren(N.Struct, Owner, Owner, true, MaxLen, Page);
				break;
			case ENode::Components:
				if (AActor* Actor = Cast<AActor>(Owner))
				{
					ComponentChildren(Actor, Page);
				}
				break;
			case ENode::Functions:
				FunctionChildren(Owner->GetClass(), Page);
				break;
			case ENode::Struct:
				StructChildren(N.Struct, N.Ptr, Owner, false, MaxLen, Page);
				break;
			default:
				ContainerChildren(N, Owner, MaxLen, Page);
				break;
			}
		}
		Out->SetBoolField(TEXT("valid"), true);
		Out->SetNumberField(TEXT("total"), Page.Total);
		Out->SetArrayField(TEXT("children"), Page.Rows);
		Emit(Q, Out);
		return UELINK_EMMY_OK;
	}

	void UELINK_EMMY_CALL ReleasePause(void*, uint64_t VmId, uint64_t PauseId)
	{
		FState& St = S();
		if (St.VmId == VmId && St.PauseId == PauseId)
		{
			St.ResetPause(0, 0);
		}
	}

	// ---- 找 emmy runtime 并注册 ----

	/** emmy runtime 所在的模块：PC 附加注入的 emmy_core / emmy_debugger_core，或者静态链进了主程序 */
	void* FindEmmyModule()
	{
#if PLATFORM_WINDOWS
		for (const wchar_t* Name : { L"emmy_core.dll", L"emmy_debugger_core.dll" })
		{
			if (HMODULE M = ::GetModuleHandleW(Name))
			{
				return M;
			}
		}
		// 项目把调试核心静态链进游戏（内嵌 runtime）时，导出在主程序上
		HMODULE Exe = ::GetModuleHandleW(nullptr);
		return Exe && ::GetProcAddress(Exe, UELINK_EMMY_REGISTER_EXPORT) ? Exe : nullptr;
#else
		for (const char* Name : { "libemmy_core.so", "emmy_core.so", "libemmy_debugger_core.so", "libemmy_core.dylib", "emmy_core.dylib" })
		{
			// RTLD_NOLOAD：只找已经加载的，不主动加载
			if (void* M = dlopen(Name, RTLD_LAZY | RTLD_NOLOAD))
			{
				dlclose(M);
				return M;
			}
		}
		// 静态链进主程序（内嵌 runtime）时，从全局符号表里找
		void* Self = dlopen(nullptr, RTLD_LAZY);
		if (Self && dlsym(Self, UELINK_EMMY_REGISTER_EXPORT))
		{
			return Self;
		}
		return nullptr;
#endif
	}

	void* FindExport(void* Module, const char* Name)
	{
#if PLATFORM_WINDOWS
		return reinterpret_cast<void*>(::GetProcAddress(static_cast<HMODULE>(Module), Name));
#else
		return dlsym(Module, Name);
#endif
	}

	bool OnTick(float)
	{
		FState& St = S();
		void* Module = FindEmmyModule();
		if (Module == St.Module)
		{
			// 调试核心被卸载后又在同一地址加载时模块句柄不变，但注册已经随旧实例没了：新版 runtime 能问出来，重新注册
			const bool bLost = Module && St.ProviderId && St.Has && St.Has(St.ProviderId) == 0;
			if (!bLost)
			{
				return true;
			}
			UE_LOG(LogUELinkEmmy, Log, TEXT("UELink: EmmyLua 调试 runtime 重新加载过，重新注册 UE 属性提供者"));
		}
		// 模块换了（卸载、重新注入）：旧的注册随旧模块一起没了，按新模块重新来
		St.Module = Module;
		St.ProviderId = 0;
		St.Unregister = nullptr;
		St.Has = nullptr;
		St.ResetPause(0, 0);
		if (!Module)
		{
			return true;
		}
		FUELinkEmmyRegisterFn Register = reinterpret_cast<FUELinkEmmyRegisterFn>(FindExport(Module, UELINK_EMMY_REGISTER_EXPORT));
		if (!Register)
		{
			UE_LOG(LogUELinkEmmy, Log, TEXT("UELink: 找到 EmmyLua 调试 runtime，但它不支持宿主值提供者 v2（版本较旧），断点时 UE 属性仍由 Lua 侧显示"));
			return true;
		}
		static FUELinkEmmyHostValueProviderV2 Provider;
		Provider.size = sizeof(Provider);
		Provider.version = UELINK_EMMY_HOST_VALUE_ABI_VERSION;
		Provider.userData = nullptr;
		Provider.name = "UELink";
		Provider.describe = &Describe;
		Provider.listChildren = &ListChildren;
		Provider.releasePause = &ReleasePause;
		St.ProviderId = Register(&Provider);
		St.Unregister = reinterpret_cast<FUELinkEmmyUnregisterFn>(FindExport(Module, UELINK_EMMY_UNREGISTER_EXPORT));
		St.Has = reinterpret_cast<FUELinkEmmyHasFn>(FindExport(Module, UELINK_EMMY_HAS_EXPORT));
		if (St.ProviderId == 0)
		{
			UE_LOG(LogUELinkEmmy, Warning, TEXT("UELink: EmmyLua 调试 runtime 拒绝了 UE 属性提供者（接口版本不一致），断点时 UE 属性仍由 Lua 侧显示"));
			return true;
		}
		UE_LOG(LogUELinkEmmy, Log, TEXT("UELink: 已向 EmmyLua 调试 runtime 注册 UE 属性提供者（id %llu）"), St.ProviderId);
		return true;
	}
}

void AgentPanelRegisterEmmyValues()
{
	using namespace UELinkEmmyValues;
	FState& St = S();
	if (!St.Tick.IsValid())
	{
		// 2 秒看一次：只是查一下模块句柄，开销可以忽略；附加注入随时可能发生，所以一直看
		St.Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&OnTick), 2.0f);
	}
}

void AgentPanelUnregisterEmmyValues()
{
	using namespace UELinkEmmyValues;
	FState& St = S();
	if (St.Tick.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(St.Tick);
		St.Tick.Reset();
	}
	// 模块还在才注销：UELink 先卸载时 runtime 不能再回调已经卸载的代码
	if (St.ProviderId && St.Unregister && FindEmmyModule() == St.Module)
	{
		St.Unregister(St.ProviderId);
	}
	St.ProviderId = 0;
	St.Unregister = nullptr;
	St.Has = nullptr;
	St.Module = nullptr;
	St.ResetPause(0, 0);
}

#endif
