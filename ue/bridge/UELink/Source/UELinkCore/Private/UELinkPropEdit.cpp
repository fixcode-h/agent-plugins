// set 操作的容器按钮和新建内嵌子对象（见 UELinkPropEdit.h）
#include "UELinkPropEdit.h"
#include "AgentPanelAssetTree.h"
#include "AgentPanelBridgeUtil.h"

#include "GameFramework/Actor.h"
#include "Misc/PackageName.h"
#include "UObject/Class.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"

namespace AgentPanel
{
	// 不用匿名命名空间：单体编译时和别的文件的同名小函数会撞
	namespace PropEdit
	{
		/** 键、值的临时存放：按属性大小分配、构造和析构（和 ResolvePath 里取映射的键一样） */
		struct FTempValue
		{
			FProperty* Prop;
			TArray<uint8> Buf;

			explicit FTempValue(FProperty* InProp) : Prop(InProp)
			{
				Buf.SetNumZeroed(Prop->GetSize());
				Prop->InitializeValue(Buf.GetData());
			}
			~FTempValue() { Prop->DestroyValue(Buf.GetData()); }
			void* Get() { return Buf.GetData(); }
		};

		/** 类名或路径：原生类名、/Script 路径，蓝图类没加载时按资源路径加载（/Game/BP_Foo、/Game/BP_Foo.BP_Foo 都换成 BP_Foo_C） */
		UClass* ResolveClass(const FString& Name)
		{
			UClass* C = FindClassByName(Name);
			if (C || !Name.StartsWith(TEXT("/")))
			{
				return C;
			}
			FString Pkg = Name;
			FString Obj;
			if (!Name.Split(TEXT("."), &Pkg, &Obj))
			{
				Obj = FPackageName::GetShortName(Name);
			}
			if (!Obj.EndsWith(TEXT("_C")))
			{
				Obj += TEXT("_C");
			}
			return LoadObject<UClass>(nullptr, *(Pkg + TEXT(".") + Obj), nullptr, LOAD_NoWarn | LOAD_Quiet);
		}

		/** 请求里的某个字段（key / value），没有时返回空指针 */
		TSharedPtr<FJsonValue> Field(const TSharedPtr<FJsonObject>& Args, const TCHAR* Name)
		{
			return Args.IsValid() ? Args->TryGetField(Name) : TSharedPtr<FJsonValue>();
		}

		/**
		 * 新元素的内容：给了 class 且元素是对象就建一个子对象放进去，否则给了 value 就按值写；都没给保持默认值。
		 * Elem 已经构造好（默认值），失败时调用方负责把元素删掉
		 */
		bool FillElement(FProperty* ElemProp, void* Elem, UObject* Owner, const TSharedPtr<FJsonObject>& Args, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const FString ClassName = Str(Args, TEXT("class"));
			if (!ClassName.IsEmpty())
			{
				FObjectPropertyBase* OP = CastField<FObjectPropertyBase>(ElemProp);
				if (!OP)
				{
					Error = FString::Printf(TEXT("元素类型是 %s，不是对象，不能按 class 新建子对象：去掉 class，用 value 写值"), *TypeOf(ElemProp));
					return false;
				}
				UObject* Created = NewInstance(OP, Owner, ClassName, Error);
				if (!Created)
				{
					return false;
				}
				OP->SetObjectPropertyValue(Elem, Created);
				Out->SetStringField(TEXT("created"), Created->GetPathName());
				return true;
			}
			const TSharedPtr<FJsonValue> V = Field(Args, TEXT("value"));
			return !V.IsValid() || FromJson(ElemProp, Elem, V, Error);
		}

		bool EditArray(FArrayProperty* AP, void* Value, UObject* Owner, const FString& Op, const TSharedPtr<FJsonObject>& Args, EPropertyChangeType::Type& Change, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			FScriptArrayHelper H(AP, Value);
			const int32 Index = Int(Args, TEXT("index"), -1);
			if (Op != TEXT("clear") && AP->HasAnyPropertyFlags(CPF_EditFixedSize))
			{
				Error = FString::Printf(TEXT("%s 是固定长度的数组（EditFixedSize），不能加删元素"), *AP->GetName());
				return false;
			}
			if (Op == TEXT("clear"))
			{
				H.EmptyValues();
				Change = EPropertyChangeType::ArrayClear;
				return true;
			}
			if (Op == TEXT("add"))
			{
				const int32 At = H.AddValue();
				if (!FillElement(AP->Inner, H.GetRawPtr(At), Owner, Args, Out, Error))
				{
					H.RemoveValues(At, 1);
					return false;
				}
				Out->SetNumberField(TEXT("index"), At);
				Change = EPropertyChangeType::ArrayAdd;
				return true;
			}
			if (!H.IsValidIndex(Index))
			{
				Error = FString::Printf(TEXT("%s 只有 %d 个元素，没有 [%d]"), *AP->GetName(), H.Num(), Index);
				return false;
			}
			if (Op == TEXT("insert"))
			{
				H.InsertValues(Index, 1);
				if (!FillElement(AP->Inner, H.GetRawPtr(Index), Owner, Args, Out, Error))
				{
					H.RemoveValues(Index, 1);
					return false;
				}
				Out->SetNumberField(TEXT("index"), Index);
				Change = EPropertyChangeType::ArrayAdd;
				return true;
			}
			if (Op == TEXT("remove"))
			{
				H.RemoveValues(Index, 1);
				Change = EPropertyChangeType::ArrayRemove;
				return true;
			}
			if (Op == TEXT("duplicate"))
			{
				H.InsertValues(Index + 1, 1);
				AP->Inner->CopyCompleteValue(H.GetRawPtr(Index + 1), H.GetRawPtr(Index));
				// 实例化子对象：复制出一个新对象，不让两个元素指向同一个（和编辑器里「复制」一样）
				if (FObjectProperty* OP = CastField<FObjectProperty>(AP->Inner))
				{
					if (OP->HasAnyPropertyFlags(CPF_InstancedReference | CPF_PersistentInstance) || AP->HasAnyPropertyFlags(CPF_ContainsInstancedReference))
					{
						if (UObject* Src = OP->GetObjectPropertyValue(H.GetRawPtr(Index)))
						{
							OP->SetObjectPropertyValue(H.GetRawPtr(Index + 1), DuplicateObject(Src, Owner));
						}
					}
				}
				Out->SetNumberField(TEXT("index"), Index + 1);
				Change = EPropertyChangeType::Duplicate;
				return true;
			}
			Error = FString::Printf(TEXT("不认识的数组操作 %s（add / insert / duplicate / remove / clear）"), *Op);
			return false;
		}

		/** 集合和映射按键改：键用 key 给（JSON 或 UE 文本格式，和属性路径里 Tags["Fire"] 的写法一样） */
		bool NeedKey(FProperty* KeyProp, FTempValue& Key, const TSharedPtr<FJsonObject>& Args, const FString& Op, FString& Error)
		{
			const TSharedPtr<FJsonValue> K = Field(Args, TEXT("key"));
			if (!K.IsValid() || K->IsNull())
			{
				Error = FString::Printf(TEXT("集合和映射的 %s 要给 key（元素或键的值）"), *Op);
				return false;
			}
			return FromJson(KeyProp, Key.Get(), K, Error);
		}

		bool EditSet(FSetProperty* SP, void* Value, const FString& Op, const TSharedPtr<FJsonObject>& Args, EPropertyChangeType::Type& Change, FString& Error)
		{
			FScriptSetHelper H(SP, Value);
			if (Op == TEXT("clear"))
			{
				H.EmptyElements();
				Change = EPropertyChangeType::ArrayClear;
				return true;
			}
			if (Op != TEXT("add") && Op != TEXT("remove"))
			{
				Error = FString::Printf(TEXT("集合只能 add / remove / clear（按 key），不能 %s"), *Op);
				return false;
			}
			FTempValue Key(SP->ElementProp);
			if (!NeedKey(SP->ElementProp, Key, Args, Op, Error))
			{
				return false;
			}
			const int32 Found = H.FindElementIndex(Key.Get());
			if (Op == TEXT("add"))
			{
				if (Found != INDEX_NONE)
				{
					Error = FString::Printf(TEXT("%s 里已经有这个元素了"), *SP->GetName());
					return false;
				}
				H.AddElement(Key.Get());
				Change = EPropertyChangeType::ArrayAdd;
				return true;
			}
			if (Found == INDEX_NONE)
			{
				Error = FString::Printf(TEXT("%s 里没有这个元素"), *SP->GetName());
				return false;
			}
			H.RemoveAt(Found);
			Change = EPropertyChangeType::ArrayRemove;
			return true;
		}

		bool EditMap(FMapProperty* MP, void* Value, UObject* Owner, const FString& Op, const TSharedPtr<FJsonObject>& Args, EPropertyChangeType::Type& Change, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			FScriptMapHelper H(MP, Value);
			if (Op == TEXT("clear"))
			{
				H.EmptyValues();
				Change = EPropertyChangeType::ArrayClear;
				return true;
			}
			if (Op != TEXT("add") && Op != TEXT("remove"))
			{
				Error = FString::Printf(TEXT("映射只能 add / remove / clear（按 key），不能 %s；改某个键的值用 prop=%s[键]"), *Op, *MP->GetName());
				return false;
			}
			FTempValue Key(MP->KeyProp);
			if (!NeedKey(MP->KeyProp, Key, Args, Op, Error))
			{
				return false;
			}
			const int32 Found = H.FindMapIndexWithKey(Key.Get());
			if (Op == TEXT("remove"))
			{
				if (Found == INDEX_NONE)
				{
					Error = FString::Printf(TEXT("%s 里没有这个键"), *MP->GetName());
					return false;
				}
				H.RemoveAt(Found);
				Change = EPropertyChangeType::ArrayRemove;
				return true;
			}
			if (Found != INDEX_NONE)
			{
				Error = FString::Printf(TEXT("%s 里已经有这个键了：改它的值用 prop=%s[键] + value"), *MP->GetName(), *MP->GetName());
				return false;
			}
			// 值先在临时区填好（新建的子对象也先放这里），全部成功才加进映射，失败时映射不留半个元素
			FTempValue Val(MP->ValueProp);
			if (!FillElement(MP->ValueProp, Val.Get(), Owner, Args, Out, Error))
			{
				return false;
			}
			H.AddPair(Key.Get(), Val.Get());
			Change = EPropertyChangeType::ArrayAdd;
			return true;
		}
	}

	bool EditContainer(FProperty* Prop, void* Value, UObject* Owner, const TSharedPtr<FJsonObject>& Args, EPropertyChangeType::Type& Change, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		using namespace PropEdit;
		const FString Op = Str(Args, TEXT("array"));
		if (FArrayProperty* AP = CastField<FArrayProperty>(Prop))
		{
			return EditArray(AP, Value, Owner, Op, Args, Change, Out, Error);
		}
		if (FSetProperty* SP = CastField<FSetProperty>(Prop))
		{
			return EditSet(SP, Value, Op, Args, Change, Error);
		}
		if (FMapProperty* MP = CastField<FMapProperty>(Prop))
		{
			return EditMap(MP, Value, Owner, Op, Args, Change, Out, Error);
		}
		Error = FString::Printf(TEXT("%s 不是数组、集合或映射，不能 %s"), *Prop->GetName(), *Op);
		return false;
	}

	UObject* NewInstance(FObjectPropertyBase* Prop, UObject* Owner, const FString& ClassName, FString& Error)
	{
		if (!Prop || !Owner)
		{
			Error = TEXT("没有属性或所属对象，建不了子对象");
			return nullptr;
		}
		if (CastField<FObjectProperty>(Prop) == nullptr)
		{
			Error = FString::Printf(TEXT("%s 是 %s，不是直接的对象引用（软引用、弱引用不能放内嵌子对象）"), *Prop->GetName(), *TypeOf(Prop));
			return nullptr;
		}
		UClass* Cls = PropEdit::ResolveClass(ClassName);
		if (!Cls)
		{
			Error = FString::Printf(TEXT("找不到类 %s：写原生类名（如 InputTriggerPressed）或蓝图类路径（/Game/...）"), *ClassName);
			return nullptr;
		}
		UClass* Want = Prop->PropertyClass;
		if (Want && !Cls->IsChildOf(Want))
		{
			Error = FString::Printf(TEXT("%s 要的是 %s 或它的子类，%s 不是"), *Prop->GetName(), *Want->GetName(), *Cls->GetName());
			return nullptr;
		}
		if (Cls->HasAnyClassFlags(CLASS_Abstract | CLASS_Deprecated | CLASS_NewerVersionExists))
		{
			Error = FString::Printf(TEXT("%s 是抽象的或已弃用，不能新建：挑一个具体的子类"), *Cls->GetName());
			return nullptr;
		}
		if (Cls->IsChildOf(AActor::StaticClass()))
		{
			Error = TEXT("Actor 不能当内嵌子对象：在关卡里放 Actor 用 editor.spawn");
			return nullptr;
		}
		// 编辑器细节面板只给 Instanced 属性或 EditInlineNew 类出「新建」下拉；别的属性建子对象，保存后往往是一个没人认的孤儿
		const bool bInstanced = Prop->HasAnyPropertyFlags(CPF_InstancedReference | CPF_PersistentInstance);
		if (!bInstanced && !Cls->HasAnyClassFlags(CLASS_EditInlineNew))
		{
			Error = FString::Printf(TEXT("%s 不是实例化（Instanced）属性，%s 也不是 EditInlineNew 类：这里只能引用已有对象，用 value 写对象路径"), *Prop->GetName(), *Cls->GetName());
			return nullptr;
		}
		// 标志照细节面板：Owner 是类默认值或原型时子对象也是原型（RF_ArchetypeObject、RF_Public 随 RF_PropagateToSubObjects 传下去）
		const EObjectFlags Flags = Owner->GetMaskedFlags(RF_PropagateToSubObjects) | RF_Transactional;
		return NewObject<UObject>(Owner, Cls, NAME_None, Flags);
	}
}
