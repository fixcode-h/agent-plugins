#include "AgentPanelBridgeUtil.h"

#include "Engine/Blueprint.h"
#include "Engine/World.h"
#include "Misc/PackageName.h"
#include "JsonObjectConverter.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/EnumProperty.h"
#include "UObject/Package.h"
#include "UObject/TextProperty.h"
#include "UObject/UnrealType.h"

namespace AgentPanel
{
	FString Str(const TSharedPtr<FJsonObject>& Args, const TCHAR* Key, const FString& Default)
	{
		FString V;
		return Args.IsValid() && Args->TryGetStringField(Key, V) ? V : Default;
	}

	int32 Int(const TSharedPtr<FJsonObject>& Args, const TCHAR* Key, int32 Default)
	{
		double V = 0;
		return Args.IsValid() && Args->TryGetNumberField(Key, V) ? (int32)V : Default;
	}

	bool Bool(const TSharedPtr<FJsonObject>& Args, const TCHAR* Key, bool Default)
	{
		bool V = false;
		return Args.IsValid() && Args->TryGetBoolField(Key, V) ? V : Default;
	}

	bool StartsWithNoCase(const FString& S, const FString& Prefix)
	{
		return Prefix.IsEmpty() || S.StartsWith(Prefix, ESearchCase::IgnoreCase);
	}

	UObject* FindObjectByPath(const FString& Path, bool bLoad, FString& Error)
	{
		if (Path.IsEmpty())
		{
			Error = TEXT("没有给对象路径");
			return nullptr;
		}
		UObject* Obj = StaticFindObject(UObject::StaticClass(), nullptr, *Path);
		if (!Obj && bLoad)
		{
			// 资源路径可能只写了包名（/Game/Data/DT_Items），补上对象名再试
			FString Full = Path;
			if (!Full.Contains(TEXT(".")))
			{
				Full = Path + TEXT(".") + FPackageName::GetShortName(Path);
			}
			Obj = LoadObject<UObject>(nullptr, *Full, nullptr, LOAD_NoWarn | LOAD_Quiet);
		}
		if (!Obj)
		{
			Error = FString::Printf(TEXT("找不到对象：%s"), *Path);
			return nullptr;
		}
		// 蓝图资源本身没什么可读的，读写的是它生成的类的默认对象（类默认值）
		if (UBlueprint* BP = Cast<UBlueprint>(Obj))
		{
			if (BP->GeneratedClass)
			{
				return BP->GeneratedClass->GetDefaultObject();
			}
		}
		return Obj;
	}

	/** 拆一段：Name[2]["key"] → 名字和下标列表（数字下标或带引号的键） */
	static bool SplitSegment(const FString& Seg, FString& Name, TArray<FString>& Subs, FString& Error)
	{
		int32 Bracket = INDEX_NONE;
		Seg.FindChar(TEXT('['), Bracket);
		Name = Bracket == INDEX_NONE ? Seg : Seg.Left(Bracket);
		FString Rest = Bracket == INDEX_NONE ? FString() : Seg.Mid(Bracket);
		while (!Rest.IsEmpty())
		{
			int32 Close = INDEX_NONE;
			if (!Rest.StartsWith(TEXT("[")) || !Rest.FindChar(TEXT(']'), Close))
			{
				Error = FString::Printf(TEXT("属性路径写法不对：%s"), *Seg);
				return false;
			}
			FString Inner = Rest.Mid(1, Close - 1).TrimStartAndEnd();
			Inner.TrimQuotesInline();
			Subs.Add(Inner);
			Rest = Rest.Mid(Close + 1);
		}
		return true;
	}

	/** 路径按点分段，但引号里的点不算（Map 的键可能带点） */
	static TArray<FString> SplitPath(const FString& Path)
	{
		TArray<FString> Out;
		FString Cur;
		bool bQuote = false;
		for (TCHAR C : Path)
		{
			if (C == TEXT('"'))
			{
				bQuote = !bQuote;
			}
			if (C == TEXT('.') && !bQuote)
			{
				Out.Add(Cur);
				Cur.Reset();
				continue;
			}
			Cur.AppendChar(C);
		}
		if (!Cur.IsEmpty())
		{
			Out.Add(Cur);
		}
		return Out;
	}

	bool ResolvePath(UStruct* Struct, void* Container, UObject* Owner, const FString& Path, FResolved& Out, FString& Error)
	{
		TArray<FString> Segs = SplitPath(Path);
		if (Segs.Num() == 0)
		{
			Error = TEXT("没有给属性路径");
			return false;
		}
		UStruct* CurStruct = Struct;
		void* CurContainer = Container;
		for (int32 i = 0; i < Segs.Num(); ++i)
		{
			FString Name;
			TArray<FString> Subs;
			if (!SplitSegment(Segs[i], Name, Subs, Error))
			{
				return false;
			}
			FProperty* Prop = CurStruct ? CurStruct->FindPropertyByName(FName(*Name)) : nullptr;
			if (!Prop)
			{
				// 蓝图变量的显示名和内部名可能不同，再按不区分大小写找一遍
				for (TFieldIterator<FProperty> It(CurStruct); It; ++It)
				{
					if (It->GetName().Equals(Name, ESearchCase::IgnoreCase) || It->GetAuthoredName().Equals(Name, ESearchCase::IgnoreCase))
					{
						Prop = *It;
						break;
					}
				}
			}
			if (!Prop)
			{
				Error = FString::Printf(TEXT("%s 上没有属性 %s"), CurStruct ? *CurStruct->GetName() : TEXT("?"), *Name);
				return false;
			}
			void* Value = Prop->ContainerPtrToValuePtr<void>(CurContainer);
			for (const FString& Sub : Subs)
			{
				if (FArrayProperty* AP = CastField<FArrayProperty>(Prop))
				{
					FScriptArrayHelper H(AP, Value);
					const int32 Idx = FCString::Atoi(*Sub);
					if (!H.IsValidIndex(Idx))
					{
						Error = FString::Printf(TEXT("%s 只有 %d 个元素，没有 [%d]"), *Name, H.Num(), Idx);
						return false;
					}
					Value = H.GetRawPtr(Idx);
					Prop = AP->Inner;
				}
				else if (FMapProperty* MP = CastField<FMapProperty>(Prop))
				{
					FScriptMapHelper H(MP, Value);
					TArray<uint8> Key;
					Key.SetNumZeroed(MP->KeyProp->GetSize());
					MP->KeyProp->InitializeValue(Key.GetData());
					MP->KeyProp->ImportText_Direct(*Sub, Key.GetData(), nullptr, PPF_None);
					const int32 Idx = H.FindMapIndexWithKey(Key.GetData());
					MP->KeyProp->DestroyValue(Key.GetData());
					if (Idx == INDEX_NONE)
					{
						Error = FString::Printf(TEXT("%s 里没有键 %s"), *Name, *Sub);
						return false;
					}
					Value = H.GetValuePtr(Idx);
					Prop = MP->ValueProp;
				}
				else
				{
					Error = FString::Printf(TEXT("%s 不是数组或 Map，不能用 [%s]"), *Name, *Sub);
					return false;
				}
			}
			if (i == Segs.Num() - 1)
			{
				Out.Prop = Prop;
				Out.Value = Value;
				Out.Owner = Owner;
				return true;
			}
			// 还有下一段：结构体往里走，对象引用跟到那个对象上
			if (FStructProperty* SP = CastField<FStructProperty>(Prop))
			{
				CurStruct = SP->Struct;
				CurContainer = Value;
			}
			else if (FObjectPropertyBase* OP = CastField<FObjectPropertyBase>(Prop))
			{
				UObject* Next = OP->GetObjectPropertyValue(Value);
				if (!Next)
				{
					Error = FString::Printf(TEXT("%s 是空引用"), *Name);
					return false;
				}
				CurStruct = Next->GetClass();
				CurContainer = Next;
				Owner = Next;
			}
			else
			{
				Error = FString::Printf(TEXT("%s 不是结构体或对象，不能再往下取"), *Name);
				return false;
			}
		}
		return false;
	}

	static FString JsonString(const TSharedPtr<FJsonValue>& V)
	{
		FString S;
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> W = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&S);
		FJsonSerializer::Serialize(V, FString(), W);
		return S;
	}

	TSharedPtr<FJsonValue> ToJson(FProperty* Prop, const void* Value, int32 MaxChars)
	{
		TSharedPtr<FJsonValue> V = FJsonObjectConverter::UPropertyToJsonValue(Prop, Value);
		if (!V.IsValid())
		{
			FString Text;
			Prop->ExportTextItem_Direct(Text, Value, nullptr, nullptr, PPF_None);
			return MakeShared<FJsonValueString>(Text);
		}
		if (MaxChars > 0)
		{
			const FString S = JsonString(V);
			if (S.Len() > MaxChars)
			{
				// 太大：只回摘要，Agent / 网页再按路径取具体字段，免得一次把上下文撑满
				TSharedPtr<FJsonObject> Sum = MakeShared<FJsonObject>();
				Sum->SetBoolField(TEXT("_truncated"), true);
				Sum->SetNumberField(TEXT("_chars"), S.Len());
				if (const FArrayProperty* AP = CastField<FArrayProperty>(Prop))
				{
					FScriptArrayHelper H(AP, Value);
					Sum->SetNumberField(TEXT("_count"), H.Num());
				}
				else if (const FMapProperty* MP = CastField<FMapProperty>(Prop))
				{
					FScriptMapHelper H(MP, Value);
					Sum->SetNumberField(TEXT("_count"), H.Num());
				}
				Sum->SetStringField(TEXT("_preview"), S.Left(300));
				return MakeShared<FJsonValueObject>(Sum);
			}
		}
		return V;
	}

	bool FromJson(FProperty* Prop, void* Value, const TSharedPtr<FJsonValue>& Json, FString& Error)
	{
		if (!Json.IsValid())
		{
			Error = TEXT("没有给值");
			return false;
		}
		// 字符串类属性和字符串值：JSON 转换就够了；其他类型给的是字符串时，按 UE 文本格式（"(X=1,Y=2,Z=3)"、枚举名）写
		const bool bTextual = Prop->IsA<FStrProperty>() || Prop->IsA<FNameProperty>() || Prop->IsA<FTextProperty>();
		if (Json->Type == EJson::String && !bTextual)
		{
			const FString Text = Json->AsString();
			if (Prop->ImportText_Direct(*Text, Value, nullptr, PPF_None) != nullptr)
			{
				return true;
			}
		}
		if (FJsonObjectConverter::JsonValueToUProperty(Json, Prop, Value))
		{
			return true;
		}
		Error = FString::Printf(TEXT("值写不进 %s（类型 %s）：%s"), *Prop->GetName(), *TypeOf(Prop), *JsonString(Json));
		return false;
	}

	FString TypeOf(FProperty* Prop)
	{
		FString Extended;
		FString Cpp = Prop->GetCPPType(&Extended);
		return Cpp + Extended;
	}

	static TSharedPtr<FJsonObject> PropInfo(FProperty* Prop, const void* Container, int32 MaxChars)
	{
		TSharedPtr<FJsonObject> P = MakeShared<FJsonObject>();
		P->SetStringField(TEXT("name"), Prop->GetAuthoredName());
		P->SetStringField(TEXT("type"), TypeOf(Prop));
#if WITH_EDITORONLY_DATA
		P->SetStringField(TEXT("category"), Prop->GetMetaData(TEXT("Category")));
		P->SetStringField(TEXT("tooltip"), Prop->GetMetaData(TEXT("ToolTip")).Left(300));
#endif
		P->SetBoolField(TEXT("replicated"), Prop->HasAnyPropertyFlags(CPF_Net));
		P->SetBoolField(TEXT("readOnly"), Prop->HasAnyPropertyFlags(CPF_EditConst | CPF_BlueprintReadOnly) && !Prop->HasAnyPropertyFlags(CPF_Edit));
		if (const FEnumProperty* EP = CastField<FEnumProperty>(Prop))
		{
			TArray<TSharedPtr<FJsonValue>> Names;
			for (int32 i = 0; i < EP->GetEnum()->NumEnums() - 1; ++i)
			{
				Names.Add(MakeShared<FJsonValueString>(EP->GetEnum()->GetNameStringByIndex(i)));
			}
			P->SetArrayField(TEXT("enum"), Names);
		}
		else if (const FByteProperty* BP = CastField<FByteProperty>(Prop))
		{
			if (BP->Enum)
			{
				TArray<TSharedPtr<FJsonValue>> Names;
				for (int32 i = 0; i < BP->Enum->NumEnums() - 1; ++i)
				{
					Names.Add(MakeShared<FJsonValueString>(BP->Enum->GetNameStringByIndex(i)));
				}
				P->SetArrayField(TEXT("enum"), Names);
			}
		}
		P->SetField(TEXT("value"), ToJson(Prop, Prop->ContainerPtrToValuePtr<void>(Container), MaxChars));
		return P;
	}

	TArray<TSharedPtr<FJsonValue>> ListProps(UStruct* Struct, const void* Container, const FString& Filter, int32 MaxChars)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (TFieldIterator<FProperty> It(Struct); It; ++It)
		{
			FProperty* Prop = *It;
			// 只列 UPROPERTY 里编辑器或蓝图看得见的；纯 C++ 内部状态（没有这些标记）也列出来，排查时常要看，但跳过 Transient 的大缓存不做特殊处理
			if (!Filter.IsEmpty() && !StartsWithNoCase(Prop->GetAuthoredName(), Filter))
			{
				continue;
			}
			Out.Add(MakeShared<FJsonValueObject>(PropInfo(Prop, Container, MaxChars)));
		}
		return Out;
	}

	TArray<TSharedPtr<FJsonValue>> ParamsOf(UFunction* Func)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (TFieldIterator<FProperty> It(Func); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
		{
			if (It->HasAnyPropertyFlags(CPF_ReturnParm))
			{
				continue;
			}
			TSharedPtr<FJsonObject> P = MakeShared<FJsonObject>();
			P->SetStringField(TEXT("name"), It->GetName());
			P->SetStringField(TEXT("type"), TypeOf(*It));
			P->SetBoolField(TEXT("out"), It->HasAnyPropertyFlags(CPF_OutParm) && !It->HasAnyPropertyFlags(CPF_ReferenceParm));
			UEnum* Enum = nullptr;
			if (const FEnumProperty* EP = CastField<FEnumProperty>(*It))
			{
				Enum = EP->GetEnum();
			}
			else if (const FByteProperty* BP = CastField<FByteProperty>(*It))
			{
				Enum = BP->Enum;
			}
			if (Enum)
			{
				TArray<TSharedPtr<FJsonValue>> Names;
				for (int32 i = 0; i < Enum->NumEnums() - 1; ++i)
				{
					Names.Add(MakeShared<FJsonValueString>(Enum->GetNameStringByIndex(i)));
				}
				P->SetArrayField(TEXT("enum"), Names);
			}
			Out.Add(MakeShared<FJsonValueObject>(P));
		}
		return Out;
	}

	bool CallFunction(UObject* Target, UFunction* Func, const TSharedPtr<FJsonValue>& Args, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		TArray<uint8> Buf;
		Buf.SetNumZeroed(FMath::Max<int32>(Func->ParmsSize, 1));
		for (TFieldIterator<FProperty> It(Func); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
		{
			It->InitializeValue_InContainer(Buf.GetData());
		}
		bool bOk = true;
		int32 Index = 0;
		for (TFieldIterator<FProperty> It(Func); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
		{
			FProperty* P = *It;
			if (P->HasAnyPropertyFlags(CPF_ReturnParm))
			{
				continue;
			}
			TSharedPtr<FJsonValue> V;
			if (Args.IsValid() && Args->Type == EJson::Array)
			{
				const TArray<TSharedPtr<FJsonValue>>& Arr = Args->AsArray();
				if (Arr.IsValidIndex(Index))
				{
					V = Arr[Index];
				}
			}
			else if (Args.IsValid() && Args->Type == EJson::Object)
			{
				V = Args->AsObject()->TryGetField(P->GetName());
			}
			++Index;
			if (!V.IsValid() || V->IsNull())
			{
				continue; // 没给的参数用默认值（零值）
			}
			if (!FromJson(P, P->ContainerPtrToValuePtr<void>(Buf.GetData()), V, Error))
			{
				bOk = false;
				break;
			}
		}
		if (bOk)
		{
			Target->ProcessEvent(Func, Buf.GetData());
			TSharedPtr<FJsonObject> OutParams = MakeShared<FJsonObject>();
			for (TFieldIterator<FProperty> It(Func); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
			{
				void* V = It->ContainerPtrToValuePtr<void>(Buf.GetData());
				if (It->HasAnyPropertyFlags(CPF_ReturnParm))
				{
					Out->SetField(TEXT("ret"), ToJson(*It, V));
				}
				else if (It->HasAnyPropertyFlags(CPF_OutParm))
				{
					OutParams->SetField(It->GetName(), ToJson(*It, V));
				}
			}
			Out->SetObjectField(TEXT("out"), OutParams);
		}
		for (TFieldIterator<FProperty> It(Func); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
		{
			It->DestroyValue_InContainer(Buf.GetData());
		}
		return bOk;
	}

	TSet<FString>& DirtyPackages()
	{
		static TSet<FString> Set;
		return Set;
	}

	const TCHAR* ObjectKind(const UObject* Obj)
	{
		// IsTemplate 会顺着 Outer 查：类默认对象、蓝图里的模板控件 / 组件都算
		if (Obj->IsTemplate())
		{
			return TEXT("cdo");
		}
		if (Obj->IsA<UField>() || Obj->IsA<UPackage>())
		{
			return TEXT("class");
		}
		// 顺着 Outer 往上：先碰到世界的是场景里的对象（编辑器里关卡的包不是临时包，不能按包判断）；先碰到资源的是资源
		for (const UObject* X = Obj; X; X = X->GetOuter())
		{
			if (X->IsA<UWorld>())
			{
				return TEXT("instance");
			}
			if (X->IsAsset())
			{
				return TEXT("asset");
			}
		}
		return TEXT("instance");
	}

	TSharedPtr<FJsonObject> Brief(const UObject* Obj)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("path"), Obj->GetPathName());
		O->SetStringField(TEXT("name"), Obj->GetName());
		O->SetStringField(TEXT("class"), Obj->GetClass()->GetName());
		O->SetStringField(TEXT("kind"), ObjectKind(Obj));
		return O;
	}
}
