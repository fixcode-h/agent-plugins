// 运行时模块的操作：控制台、控制台变量、GM、Actor（按名字前缀）、组件、属性读写、函数调用、运行时对象、资源查询和 DataTable 读、
// 日志、截图。编辑器专用的（资源写入保存、PIE、Live Coding、编辑器视口截图）在编辑器模块里登记。
#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"
#include "AgentPanelGMLibrary.h"
#include "AgentPanelLog.h"
#include "AgentPanelUmg.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Misc/Base64.h"
#include "Components/ActorComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/Level.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "GameFramework/CheatManager.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "ImageUtils.h"
#include "JsonObjectConverter.h"
#include "UObject/UObjectHash.h"
#include "UObject/UObjectIterator.h"
#include "UnrealClient.h"

using namespace AgentPanel;

namespace
{
	/** 收集一条命令直接回的文字 */
	struct FCapture : public FOutputDevice
	{
		FString Text;
		virtual void Serialize(const TCHAR* V, ELogVerbosity::Type, const FName&) override
		{
			Text += V;
			Text += LINE_TERMINATOR;
		}
	};

	TSharedPtr<FJsonValue> Obj(const TSharedPtr<FJsonObject>& O) { return MakeShared<FJsonValueObject>(O); }

	/** 控制台变量是谁设的（「改过的」筛选和界面上的来源标签） */
	FString SetByName(EConsoleVariableFlags F)
	{
		switch (F & ECVF_SetByMask)
		{
		case ECVF_SetByConstructor: return TEXT("default");
		case ECVF_SetByScalability: return TEXT("scalability");
		case ECVF_SetByGameSetting: return TEXT("game");
		case ECVF_SetByProjectSetting: return TEXT("project");
		case ECVF_SetBySystemSettingsIni: return TEXT("ini");
		case ECVF_SetByDeviceProfile: return TEXT("deviceProfile");
		case ECVF_SetByConsoleVariablesIni: return TEXT("ini");
		case ECVF_SetByCommandline: return TEXT("commandline");
		case ECVF_SetByCode: return TEXT("code");
		case ECVF_SetByConsole: return TEXT("console");
		default: return TEXT("other");
		}
	}

	TSharedPtr<FJsonObject> CVarInfo(const TCHAR* Name, IConsoleObject* CObj)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("name"), Name);
		O->SetStringField(TEXT("help"), FString(CObj->GetHelp()).Left(300));
		if (IConsoleVariable* V = CObj->AsVariable())
		{
			O->SetStringField(TEXT("kind"), TEXT("var"));
			O->SetStringField(TEXT("value"), V->GetString());
			O->SetStringField(TEXT("setBy"), SetByName(V->GetFlags()));
		}
		else
		{
			O->SetStringField(TEXT("kind"), TEXT("cmd"));
		}
		return O;
	}

	/** 这个世界里能接控制台命令的视口（PIE 和游戏世界才有），没有时走 GEngine->Exec */
	FString RunConsole(UWorld* World, const FString& Command)
	{
		if (UGameViewportClient* VC = World ? World->GetGameViewport() : nullptr)
		{
			// 和游戏里按 ~ 输入一样：先给本地玩家（PlayerController、CheatManager 的 Exec 函数），再给引擎
			return VC->ConsoleCommand(Command);
		}
		FCapture Out;
		if (GEngine)
		{
			GEngine->Exec(World, *Command, Out);
		}
		return Out.Text;
	}

	/** 能当 GM 用的类：这些类上的 Exec 函数在控制台里输名字就能执行 */
	bool IsExecHost(UClass* C)
	{
		return C->IsChildOf(UCheatManager::StaticClass()) || C->IsChildOf(APlayerController::StaticClass()) ||
			C->IsChildOf(AGameModeBase::StaticClass()) || C->IsChildOf(APawn::StaticClass()) || C->IsChildOf(AHUD::StaticClass());
	}

	bool IsTempClass(UClass* C)
	{
		const FString N = C->GetName();
		return N.StartsWith(TEXT("SKEL_")) || N.StartsWith(TEXT("REINST_")) || N.StartsWith(TEXT("TRASHCLASS_")) || N.StartsWith(TEXT("HOTRELOADED_"));
	}

	FString CategoryOf(UFunction* F, UClass* Owner)
	{
#if WITH_EDITORONLY_DATA
		const FString Cat = F->GetMetaData(TEXT("Category"));
		if (!Cat.IsEmpty())
		{
			return Cat;
		}
#endif
		return Owner->GetName();
	}

	FString TooltipOf(UFunction* F)
	{
#if WITH_EDITORONLY_DATA
		return F->GetMetaData(TEXT("ToolTip")).Left(400);
#else
		return FString();
#endif
	}

	TSharedPtr<FJsonObject> GmInfo(UFunction* F, UClass* Owner, const TCHAR* Source)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("name"), F->GetName());
		O->SetStringField(TEXT("owner"), Owner->GetName());
		O->SetStringField(TEXT("category"), CategoryOf(F, Owner));
		O->SetStringField(TEXT("tooltip"), TooltipOf(F));
		O->SetStringField(TEXT("source"), Source);
		O->SetBoolField(TEXT("server"), F->HasAnyFunctionFlags(FUNC_NetServer));
		O->SetArrayField(TEXT("params"), ParamsOf(F));
		return O;
	}

	UClass* FindClassByName(const FString& Name)
	{
		if (Name.IsEmpty())
		{
			return nullptr;
		}
		if (Name.StartsWith(TEXT("/")))
		{
			return FindObject<UClass>(nullptr, *Name);
		}
		UClass* C = FindFirstObject<UClass>(*Name, EFindFirstObjectOptions::NativeFirst);
		if (!C && !Name.EndsWith(TEXT("_C")))
		{
			C = FindFirstObject<UClass>(*(Name + TEXT("_C")), EFindFirstObjectOptions::None);
		}
		return C;
	}

	FViewport* GameViewport(UWorld* World)
	{
		UGameViewportClient* VC = World ? World->GetGameViewport() : nullptr;
		return VC ? VC->Viewport : nullptr;
	}
}

/** 截一个视口的图：缩到 MaxWidth 以内，PNG 转 base64（编辑器模块截编辑器视口时也用） */
bool AgentPanelCaptureViewport(FViewport* VP, int32 MaxWidth, TSharedPtr<FJsonObject>& Out, FString& Error)
{
	if (!VP)
	{
		Error = TEXT("这个世界没有视口（专用服务器、后台编辑器截不了图）");
		return false;
	}
	TArray<FColor> Pixels;
	if (!VP->ReadPixels(Pixels) || Pixels.Num() == 0)
	{
		Error = TEXT("读不到视口像素（窗口可能最小化了）");
		return false;
	}
	FIntPoint Size = VP->GetSizeXY();
	for (FColor& C : Pixels)
	{
		C.A = 255;
	}
	if (MaxWidth > 0 && Size.X > MaxWidth)
	{
		const int32 W = MaxWidth;
		const int32 H = FMath::Max(1, Size.Y * MaxWidth / Size.X);
		TArray<FColor> Small;
		FImageUtils::ImageResize(Size.X, Size.Y, Pixels, W, H, Small, false);
		Pixels = MoveTemp(Small);
		Size = FIntPoint(W, H);
	}
	TArray64<uint8> Png;
	FImageUtils::PNGCompressImageArray(Size.X, Size.Y, TArrayView64<const FColor>(Pixels.GetData(), Pixels.Num()), Png);
	Out->SetStringField(TEXT("png"), FBase64::Encode(Png.GetData(), (uint32)Png.Num()));
	Out->SetNumberField(TEXT("width"), Size.X);
	Out->SetNumberField(TEXT("height"), Size.Y);
	return true;
}

void FAgentPanelBridge::RegisterRuntimeOps()
{
	// ---------- 控制台 ----------
	AddOp(TEXT("console"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString Cmd = Str(A, TEXT("command")).TrimStartAndEnd();
		if (Cmd.IsEmpty())
		{
			Error = TEXT("没有给命令");
			return false;
		}
		UWorld* World = ResolveWorld(Str(A, TEXT("world")), Error);
		if (!World && !Str(A, TEXT("world")).IsEmpty())
		{
			return false;
		}
		Error.Reset();
		const uint64 Before = FAgentPanelLog::Get().LastSeq();
		const FString Direct = RunConsole(World, Cmd);
		// 输出 = 命令自己回的文字 + 执行期间打的日志（很多命令只往日志里写）
		TArray<TSharedPtr<FJsonValue>> Lines;
		TArray<FString> Split;
		Direct.ParseIntoArrayLines(Split, false);
		for (const FString& L : Split)
		{
			if (!L.IsEmpty())
			{
				Lines.Add(MakeShared<FJsonValueString>(L));
			}
		}
		for (const FString& L : FAgentPanelLog::Get().TextSince(Before, 400))
		{
			Lines.Add(MakeShared<FJsonValueString>(L));
		}
		Out->SetArrayField(TEXT("output"), Lines);
		Out->SetStringField(TEXT("world"), WorldId(World));
		return true;
	});

	AddOp(TEXT("cvars"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString Query = Str(A, TEXT("query"));
		const bool bChanged = Bool(A, TEXT("changed"), false);
		const bool bPrefix = Bool(A, TEXT("prefix"), true);
		const int32 Limit = Int(A, TEXT("limit"), 50);
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Total = 0;
		auto Visit = FConsoleObjectVisitor::CreateLambda([&](const TCHAR* Name, IConsoleObject* CObj)
		{
			if (CObj->TestFlags(ECVF_Unregistered))
			{
				return;
			}
			if (bChanged)
			{
				IConsoleVariable* V = CObj->AsVariable();
				const uint32 By = V ? (uint32)(V->GetFlags() & ECVF_SetByMask) : 0;
				// 「改过的」：控制台、代码、命令行设过的（默认值、画质档位、配置文件里的不算）
				if (!V || (By != ECVF_SetByConsole && By != ECVF_SetByCode && By != ECVF_SetByCommandline))
				{
					return;
				}
			}
			++Total;
			if (Items.Num() < Limit)
			{
				Items.Add(Obj(CVarInfo(Name, CObj)));
			}
		});
		if (bPrefix)
		{
			IConsoleManager::Get().ForEachConsoleObjectThatStartsWith(Visit, *Query);
		}
		else
		{
			IConsoleManager::Get().ForEachConsoleObjectThatContains(Visit, *Query);
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
		return true;
	});

	AddOp(TEXT("cvar.set"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString Name = Str(A, TEXT("name"));
		IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(*Name);
		if (!V)
		{
			Error = FString::Printf(TEXT("没有控制台变量 %s"), *Name);
			return false;
		}
		Out->SetStringField(TEXT("prev"), V->GetString());
		Out->SetStringField(TEXT("prevSetBy"), SetByName(V->GetFlags()));
		V->Set(*Str(A, TEXT("value")), ECVF_SetByConsole);
		Out->SetStringField(TEXT("value"), V->GetString());
		return true;
	});

	// ---------- GM ----------
	AddOp(TEXT("gm.list"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		TArray<TSharedPtr<FJsonValue>> Items;
		TSet<FString> Seen;
		for (TObjectIterator<UClass> It; It; ++It)
		{
			UClass* C = *It;
			if (IsTempClass(C) || C->HasAnyClassFlags(CLASS_NewerVersionExists | CLASS_Deprecated))
			{
				continue;
			}
			const bool bLibrary = C->IsChildOf(UAgentPanelGMLibrary::StaticClass()) && C != UAgentPanelGMLibrary::StaticClass();
			if (!bLibrary && !IsExecHost(C))
			{
				continue;
			}
			for (TFieldIterator<UFunction> F(C, EFieldIteratorFlags::ExcludeSuper); F; ++F)
			{
				if (bLibrary ? F->GetOwnerClass() == UAgentPanelGMLibrary::StaticClass() : !F->HasAnyFunctionFlags(FUNC_Exec))
				{
					continue;
				}
				// 同名的 Exec 函数在控制台里只会执行一个（先找到的那个），列一次
				const FString Key = bLibrary ? C->GetName() + TEXT(".") + F->GetName() : F->GetName();
				if (Seen.Contains(Key))
				{
					continue;
				}
				Seen.Add(Key);
				Items.Add(Obj(GmInfo(*F, C, bLibrary ? TEXT("library") : TEXT("exec"))));
			}
		}
		Out->SetArrayField(TEXT("items"), Items);
		return true;
	});

	AddOp(TEXT("gm.run"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UWorld* World = ResolveWorld(Str(A, TEXT("world")), Error);
		if (!World)
		{
			return false;
		}
		const FString Name = Str(A, TEXT("name"));
		const FString Owner = Str(A, TEXT("owner"));
		const TArray<TSharedPtr<FJsonValue>>* ArgsArr = nullptr;
		TArray<TSharedPtr<FJsonValue>> Args;
		if (A->TryGetArrayField(TEXT("args"), ArgsArr))
		{
			Args = *ArgsArr;
		}
		UClass* OwnerClass = FindClassByName(Owner);
		if (OwnerClass && OwnerClass->IsChildOf(UAgentPanelGMLibrary::StaticClass()))
		{
			// GM 库：在目标世界里建一个临时对象执行
			UFunction* F = OwnerClass->FindFunctionByName(FName(*Name));
			if (!F)
			{
				Error = FString::Printf(TEXT("%s 上没有 %s"), *Owner, *Name);
				return false;
			}
			UAgentPanelGMLibrary* Lib = NewObject<UAgentPanelGMLibrary>(GetTransientPackage(), OwnerClass);
			Lib->World = World;
			const uint64 Before = FAgentPanelLog::Get().LastSeq();
			const bool bOk = CallFunction(Lib, F, MakeShared<FJsonValueArray>(Args), Out, Error);
			TArray<TSharedPtr<FJsonValue>> Lines;
			for (const FString& L : FAgentPanelLog::Get().TextSince(Before, 400))
			{
				Lines.Add(MakeShared<FJsonValueString>(L));
			}
			Out->SetArrayField(TEXT("output"), Lines);
			return bOk;
		}
		// Exec 函数：拼成控制台命令执行（参数按 UE 的写法用空格隔开，带空格的加引号）
		FString Cmd = Name;
		for (const TSharedPtr<FJsonValue>& V : Args)
		{
			FString S = V->Type == EJson::String ? V->AsString() : V->Type == EJson::Boolean ? (V->AsBool() ? TEXT("true") : TEXT("false")) : FString::SanitizeFloat(V->AsNumber(), 0);
			if (S.Contains(TEXT(" ")))
			{
				S = TEXT("\"") + S + TEXT("\"");
			}
			Cmd += TEXT(" ") + S;
		}
		const uint64 Before = FAgentPanelLog::Get().LastSeq();
		const FString Direct = RunConsole(World, Cmd);
		TArray<TSharedPtr<FJsonValue>> Lines;
		TArray<FString> Split;
		Direct.ParseIntoArrayLines(Split, false);
		for (const FString& L : Split)
		{
			Lines.Add(MakeShared<FJsonValueString>(L));
		}
		for (const FString& L : FAgentPanelLog::Get().TextSince(Before, 400))
		{
			Lines.Add(MakeShared<FJsonValueString>(L));
		}
		Out->SetArrayField(TEXT("output"), Lines);
		Out->SetStringField(TEXT("command"), Cmd);
		return true;
	});

	// ---------- Actor 和组件（不做场景树：只按名字前缀找，用户 2026-11-10 定） ----------
	AddOp(TEXT("actors"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UWorld* World = ResolveWorld(Str(A, TEXT("world")), Error);
		if (!World)
		{
			return false;
		}
		const FString Prefix = Str(A, TEXT("prefix")).TrimStartAndEnd();
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 1000);
		TArray<TSharedPtr<FJsonValue>> Items;
		bool bMore = false;
		if (!Prefix.IsEmpty())
		{
			for (TActorIterator<AActor> It(World); It; ++It)
			{
				AActor* Act = *It;
				if (!IsValid(Act))
				{
					continue;
				}
				FString Label;
#if WITH_EDITOR
				Label = Act->GetActorLabel(false);
#endif
				if (!StartsWithNoCase(Act->GetName(), Prefix) && !StartsWithNoCase(Label, Prefix))
				{
					continue;
				}
				if (Items.Num() >= Limit)
				{
					bMore = true;
					break;
				}
				TSharedPtr<FJsonObject> O = Brief(Act);
				O->SetStringField(TEXT("label"), Label);
				O->SetStringField(TEXT("level"), Act->GetLevel() ? Act->GetLevel()->GetOuter()->GetName() : FString());
				APawn* Pawn = Cast<APawn>(Act);
				O->SetBoolField(TEXT("player"), Pawn && Pawn->IsPlayerControlled());
				Items.Add(Obj(O));
			}
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetBoolField(TEXT("more"), bMore);
		Out->SetStringField(TEXT("world"), WorldId(World));
		return true;
	});

	AddOp(TEXT("components"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		AActor* Act = Cast<AActor>(FindObjectByPath(Str(A, TEXT("path")), false, Error));
		if (!Act)
		{
			if (Error.IsEmpty())
			{
				Error = TEXT("这不是 Actor");
			}
			return false;
		}
		TArray<UActorComponent*> Comps;
		Act->GetComponents(Comps);
		TArray<TSharedPtr<FJsonValue>> Items;
		for (UActorComponent* C : Comps)
		{
			TSharedPtr<FJsonObject> O = Brief(C);
			USceneComponent* S = Cast<USceneComponent>(C);
			O->SetStringField(TEXT("parent"), S && S->GetAttachParent() ? S->GetAttachParent()->GetPathName() : FString());
			O->SetBoolField(TEXT("root"), S && S == Act->GetRootComponent());
			Items.Add(Obj(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		return true;
	});

	// ---------- 属性 ----------
	AddOp(TEXT("props"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UObject* Target = FindObjectByPath(Str(A, TEXT("path")), Bool(A, TEXT("load"), true), Error);
		if (!Target)
		{
			return false;
		}
		Out->SetObjectField(TEXT("object"), Brief(Target));
		Out->SetStringField(TEXT("kind"), ObjectKind(Target));
		Out->SetBoolField(TEXT("widget"), IsUmgWidget(Target));
		if (Cast<UClass>(Target))
		{
			Out->SetStringField(TEXT("readOnlyWhy"), TEXT("这是类本身，不能改。改默认值打开它的资源，改运行中的表现选运行时实例"));
		}
		Out->SetArrayField(TEXT("props"), ListProps(Target->GetClass(), Target, Str(A, TEXT("filter")), Int(A, TEXT("maxChars"), 2000), Target));
		return true;
	});

	AddOp(TEXT("get"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UObject* Target = FindObjectByPath(Str(A, TEXT("path")), Bool(A, TEXT("load"), true), Error);
		if (!Target)
		{
			return false;
		}
		FResolved R;
		if (!ResolvePath(Target->GetClass(), Target, Target, Str(A, TEXT("prop")), R, Error))
		{
			return false;
		}
		Out->SetField(TEXT("value"), ToJson(R.Prop, R.Value, Int(A, TEXT("maxChars"), 20000)));
		Out->SetStringField(TEXT("type"), TypeOf(R.Prop));
		return true;
	});

	AddOp(TEXT("set"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UObject* Target = FindObjectByPath(Str(A, TEXT("path")), Bool(A, TEXT("load"), true), Error);
		if (!Target)
		{
			return false;
		}
		if (Cast<UClass>(Target))
		{
			Error = TEXT("这是类本身，不能改：改默认值打开它的资源，改运行中的表现选运行时实例");
			return false;
		}
		FResolved R;
		if (!ResolvePath(Target->GetClass(), Target, Target, Str(A, TEXT("prop")), R, Error))
		{
			return false;
		}
		if (!R.bEditable)
		{
			Error = FString::Printf(TEXT("不能改 %s"), *R.ReadOnlyWhy);
			return false;
		}
		Out->SetField(TEXT("prev"), ToJson(R.Prop, R.Value, 0));
		UObject* Owner = R.Owner ? R.Owner : Target;
		// 资源（不在任何世界里、包不是临时的）：编辑器里按编辑器的方式改（可撤销、通知编辑器刷新、标脏）
		const bool bAsset = !Owner->GetWorld() && !Owner->GetOutermost()->HasAnyPackageFlags(PKG_PlayInEditor) && Owner->GetOutermost() != GetTransientPackage();
		bool bOk = false;
		if (bAsset)
		{
#if WITH_EDITOR
			Owner->Modify();
			Owner->PreEditChange(R.Prop);
#endif
			bOk = FromJson(R.Prop, R.Value, A->TryGetField(TEXT("value")), Error);
#if WITH_EDITOR
			FPropertyChangedEvent Ev(R.Prop, EPropertyChangeType::ValueSet);
			Owner->PostEditChangeProperty(Ev);
#endif
			if (bOk)
			{
				Owner->MarkPackageDirty();
				DirtyPackages().Add(Owner->GetOutermost()->GetName());
			}
		}
		else
		{
			// 运行时对象：走属性的 setter，界面和逻辑才会跟着变（UMG 的 Visibility、颜色等只写内存不会刷新到屏幕上）
			bOk = SetRuntimeValue(Owner, R, A->TryGetField(TEXT("value")), Error);
		}
		Out->SetField(TEXT("value"), ToJson(R.Prop, R.Value, 0));
		Out->SetBoolField(TEXT("asset"), bAsset);
		Out->SetBoolField(TEXT("replicated"), R.Prop->HasAnyPropertyFlags(CPF_Net));
		UWorld* W = Owner->GetWorld();
		Out->SetBoolField(TEXT("client"), W && W->GetNetMode() == NM_Client);
		return bOk;
	});

	AddOp(TEXT("watch"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		TArray<TSharedPtr<FJsonValue>> Values;
		if (A->TryGetArrayField(TEXT("items"), Arr))
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				const TSharedPtr<FJsonObject> Item = V->AsObject();
				TSharedPtr<FJsonObject> R = MakeShared<FJsonObject>();
				FString Err;
				UObject* Target = FindObjectByPath(Str(Item, TEXT("path")), false, Err);
				FResolved Res;
				if (Target && ResolvePath(Target->GetClass(), Target, Target, Str(Item, TEXT("prop")), Res, Err))
				{
					R->SetField(TEXT("value"), ToJson(Res.Prop, Res.Value, 500));
				}
				else
				{
					R->SetStringField(TEXT("error"), Err);
				}
				Values.Add(Obj(R));
			}
		}
		Out->SetArrayField(TEXT("values"), Values);
		return true;
	});

	// ---------- 函数 ----------
	AddOp(TEXT("functions"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UObject* Target = FindObjectByPath(Str(A, TEXT("path")), true, Error);
		if (!Target)
		{
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Items;
		for (TFieldIterator<UFunction> F(Target->GetClass()); F; ++F)
		{
			bool bAllowed = F->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_Exec);
#if WITH_EDITORONLY_DATA
			bAllowed = bAllowed || F->HasMetaData(TEXT("AgentPanel"));
#endif
			if (!bAllowed || F->HasAnyFunctionFlags(FUNC_Delegate))
			{
				continue;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("name"), F->GetName());
			O->SetStringField(TEXT("owner"), F->GetOwnerClass()->GetName());
			O->SetStringField(TEXT("category"), CategoryOf(*F, F->GetOwnerClass()));
			O->SetStringField(TEXT("tooltip"), TooltipOf(*F));
			O->SetArrayField(TEXT("params"), ParamsOf(*F));
			FProperty* Ret = F->GetReturnProperty();
			O->SetStringField(TEXT("ret"), Ret ? TypeOf(Ret) : FString());
			O->SetBoolField(TEXT("pure"), F->HasAnyFunctionFlags(FUNC_BlueprintPure | FUNC_Const));
			Items.Add(Obj(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		return true;
	});

	AddOp(TEXT("call"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UObject* Target = FindObjectByPath(Str(A, TEXT("path")), true, Error);
		if (!Target)
		{
			return false;
		}
		const FString Name = Str(A, TEXT("function"));
		UFunction* F = Target->FindFunction(FName(*Name));
		if (!F)
		{
			Error = FString::Printf(TEXT("%s 上没有函数 %s"), *Target->GetClass()->GetName(), *Name);
			return false;
		}
		bool bAllowed = F->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_Exec);
#if WITH_EDITORONLY_DATA
		bAllowed = bAllowed || F->HasMetaData(TEXT("AgentPanel"));
#endif
		if (!bAllowed)
		{
			Error = FString::Printf(TEXT("%s 不是 BlueprintCallable / Exec 函数，也没标 AgentPanel，不开放调用"), *Name);
			return false;
		}
		return CallFunction(Target, F, A->TryGetField(TEXT("args")), Out, Error);
	});

	// ---------- 运行时对象（按类、名字前缀） ----------
	AddOp(TEXT("objects"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		const FString ClassName = Str(A, TEXT("class"));
		const FString Prefix = Str(A, TEXT("prefix"));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 200), 1, 1000);
		UWorld* World = nullptr;
		if (!Str(A, TEXT("world")).IsEmpty())
		{
			World = ResolveWorld(Str(A, TEXT("world")), Error);
			if (!World)
			{
				return false;
			}
		}
		UClass* C = ClassName.IsEmpty() ? UObject::StaticClass() : FindClassByName(ClassName);
		if (!C)
		{
			Error = FString::Printf(TEXT("找不到类 %s"), *ClassName);
			return false;
		}
		if (ClassName.IsEmpty() && Prefix.IsEmpty())
		{
			Error = TEXT("要给类名或名字前缀");
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Items;
		bool bMore = false;
		bool bPartial = false;
		auto Visit = [&](UObject* O)
		{
			if (!IsValid(O) || O->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
			{
				return true;
			}
			if (!StartsWithNoCase(O->GetName(), Prefix) || (World && O->GetWorld() != World))
			{
				return true;
			}
			if (Items.Num() >= Limit)
			{
				bMore = true;
				return false;
			}
			TSharedPtr<FJsonObject> B = Brief(O);
			B->SetStringField(TEXT("kind"), ObjectKind(O));
			Items.Add(Obj(B));
			return true;
		};
		if (!ClassName.IsEmpty())
		{
			// 有类名：按类的哈希只取这个类（含子类）的对象，快
			TArray<UObject*> Objs;
			GetObjectsOfClass(C, Objs, true);
			for (UObject* O : Objs)
			{
				if (!Visit(O))
				{
					break;
				}
			}
		}
		else
		{
			// 只有名字前缀：要扫全部 UObject（大项目几百万个）。在游戏线程上限时 50 毫秒，超时返回已找到的并标 partial，
			// 面板提示「加上类名搜得更快更全」，不让一次搜索卡住游戏帧
			const double Deadline = FPlatformTime::Seconds() + 0.05;
			int32 Count = 0;
			for (TObjectIterator<UObject> It; It; ++It)
			{
				if (!Visit(*It))
				{
					break;
				}
				if ((++Count & 4095) == 0 && FPlatformTime::Seconds() > Deadline)
				{
					bPartial = true;
					break;
				}
			}
		}
		Out->SetBoolField(TEXT("partial"), bPartial);
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetBoolField(TEXT("more"), bMore);
		return true;
	});

	// ---------- 资源 ----------
	AddOp(TEXT("assets"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		IAssetRegistry& AR = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
		FARFilter Filter;
		Filter.bRecursivePaths = true;
		Filter.PackagePaths.Add(FName(*Str(A, TEXT("path"), TEXT("/Game"))));
		const FString ClassName = Str(A, TEXT("class"));
		if (!ClassName.IsEmpty())
		{
			UClass* C = FindClassByName(ClassName);
			if (!C)
			{
				Error = FString::Printf(TEXT("找不到类 %s"), *ClassName);
				return false;
			}
			Filter.ClassPaths.Add(C->GetClassPathName());
			Filter.bRecursiveClasses = true;
		}
		TArray<FAssetData> Found;
		AR.GetAssets(Filter, Found);
		const FString Prefix = Str(A, TEXT("prefix"));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 300), 1, 2000);
		TArray<TSharedPtr<FJsonValue>> Items;
		int32 Total = 0;
		for (const FAssetData& D : Found)
		{
			if (!StartsWithNoCase(D.AssetName.ToString(), Prefix))
			{
				continue;
			}
			++Total;
			if (Items.Num() >= Limit)
			{
				continue;
			}
			TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
			O->SetStringField(TEXT("path"), D.GetObjectPathString());
			O->SetStringField(TEXT("name"), D.AssetName.ToString());
			O->SetStringField(TEXT("class"), D.AssetClassPath.GetAssetName().ToString());
			O->SetStringField(TEXT("package"), D.PackageName.ToString());
			Items.Add(Obj(O));
		}
		Out->SetArrayField(TEXT("items"), Items);
		Out->SetNumberField(TEXT("total"), Total);
		return true;
	});

	AddOp(TEXT("datatable"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UDataTable* DT = Cast<UDataTable>(FindObjectByPath(Str(A, TEXT("path")), true, Error));
		if (!DT)
		{
			if (Error.IsEmpty())
			{
				Error = TEXT("这不是 DataTable");
			}
			return false;
		}
		const UScriptStruct* RowStruct = DT->GetRowStruct();
		if (!RowStruct)
		{
			Error = TEXT("DataTable 没有行结构（行结构的类可能没编译进来）");
			return false;
		}
		TArray<TSharedPtr<FJsonValue>> Columns;
		for (TFieldIterator<FProperty> It(RowStruct); It; ++It)
		{
			TSharedPtr<FJsonObject> C = MakeShared<FJsonObject>();
			C->SetStringField(TEXT("name"), It->GetAuthoredName());
			C->SetStringField(TEXT("type"), TypeOf(*It));
			C->SetBoolField(TEXT("complex"), It->IsA<FStructProperty>() || It->IsA<FArrayProperty>() || It->IsA<FMapProperty>() || It->IsA<FSetProperty>());
			Columns.Add(Obj(C));
		}
		const FString Filter = Str(A, TEXT("filter"));
		const int32 Offset = FMath::Max(0, Int(A, TEXT("offset"), 0));
		const int32 Limit = FMath::Clamp(Int(A, TEXT("limit"), 100), 1, 1000);
		TArray<TSharedPtr<FJsonValue>> Rows;
		int32 Total = 0;
		// 性能：上万行的表每翻一页都把整张表转 JSON 太慢。只有当前页的行才转 JSON；
		// 有筛选时才逐行拼搜索文本（导出成文本，比转 JSON 便宜），没筛选只数行数
		for (const TPair<FName, uint8*>& Row : DT->GetRowMap())
		{
			if (!Filter.IsEmpty() && !StartsWithNoCase(Row.Key.ToString(), Filter))
			{
				bool bHit = false;
				for (TFieldIterator<FProperty> It(RowStruct); It && !bHit; ++It)
				{
					FString Cell;
					It->ExportTextItem_Direct(Cell, It->ContainerPtrToValuePtr<void>(Row.Value), nullptr, nullptr, PPF_None);
					bHit = Cell.Contains(Filter, ESearchCase::IgnoreCase);
				}
				if (!bHit)
				{
					continue;
				}
			}
			++Total;
			if (Total <= Offset || Rows.Num() >= Limit)
			{
				continue;
			}
			TSharedPtr<FJsonObject> Values = MakeShared<FJsonObject>();
			for (TFieldIterator<FProperty> It(RowStruct); It; ++It)
			{
				Values->SetField(It->GetAuthoredName(), ToJson(*It, It->ContainerPtrToValuePtr<void>(Row.Value), 200));
			}
			TSharedPtr<FJsonObject> R = MakeShared<FJsonObject>();
			R->SetStringField(TEXT("name"), Row.Key.ToString());
			R->SetObjectField(TEXT("values"), Values);
			Rows.Add(Obj(R));
		}
		Out->SetStringField(TEXT("struct"), RowStruct->GetName());
		Out->SetArrayField(TEXT("columns"), Columns);
		Out->SetArrayField(TEXT("rows"), Rows);
		Out->SetNumberField(TEXT("total"), Total);
		Out->SetBoolField(TEXT("dirty"), DT->GetOutermost()->IsDirty());
		return true;
	});

	AddOp(TEXT("datatable.row"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UDataTable* DT = Cast<UDataTable>(FindObjectByPath(Str(A, TEXT("path")), true, Error));
		if (!DT || !DT->GetRowStruct())
		{
			if (Error.IsEmpty())
			{
				Error = TEXT("这不是 DataTable");
			}
			return false;
		}
		uint8* Row = DT->FindRowUnchecked(FName(*Str(A, TEXT("row"))));
		if (!Row)
		{
			Error = FString::Printf(TEXT("%s 里没有行 %s"), *DT->GetName(), *Str(A, TEXT("row")));
			return false;
		}
		Out->SetArrayField(TEXT("props"), ListProps(const_cast<UScriptStruct*>(DT->GetRowStruct()), Row, Str(A, TEXT("filter")), 20000));
		return true;
	});

	// ---------- 日志 ----------
	AddOp(TEXT("log.tail"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		double Since = 0;
		A->TryGetNumberField(TEXT("since"), Since);
		TSharedPtr<FJsonObject> R = FAgentPanelLog::Get().Tail((uint64)Since, FMath::Clamp(Int(A, TEXT("limit"), 300), 1, 5000),
			Str(A, TEXT("category")), Str(A, TEXT("verbosity")), Str(A, TEXT("contains")));
		for (const TPair<FString, TSharedPtr<FJsonValue>>& P : R->Values)
		{
			Out->SetField(P.Key, P.Value);
		}
		return true;
	});

	AddOp(TEXT("log.clear"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		return FAgentPanelLog::Get().ClearFile(Bool(A, TEXT("backup"), false), Out, Error);
	});

	// ---------- 截图（游戏视口；编辑器视口由编辑器模块接管这个操作） ----------
	AddOp(TEXT("screenshot"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		UWorld* World = ResolveWorld(Str(A, TEXT("world")), Error);
		if (!World)
		{
			return false;
		}
		Out->SetStringField(TEXT("world"), WorldId(World));
		return AgentPanelCaptureViewport(GameViewport(World), Int(A, TEXT("maxWidth"), 1280), Out, Error);
	});

	RegisterUmgOps(*this);
}
