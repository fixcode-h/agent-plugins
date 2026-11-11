#include "AgentPanelBridge.h"
#include "Runtime/Launch/Resources/Version.h"

// 5.8 起 FCoreDelegates::OnPostEngineInit 弃用，改用 GetOnPostEngineInit()；更早的版本只有前者
#if ENGINE_MAJOR_VERSION > 5 || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8)
#define AGENT_PANEL_POST_ENGINE_INIT FCoreDelegates::GetOnPostEngineInit()
#else
#define AGENT_PANEL_POST_ENGINE_INIT FCoreDelegates::OnPostEngineInit
#endif

#include "AgentPanelLog.h"
#include "AgentPanelLuaOps.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Misc/Parse.h"
#include "Misc/DateTime.h"
#include "HttpServerModule.h"
#include "HttpServerRequest.h"
#include "HttpServerResponse.h"
#include "IHttpRouter.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/App.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CoreDelegates.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

DEFINE_LOG_CATEGORY_STATIC(LogAgentPanelBridge, Log, All);

static const TCHAR* BridgeVersion = TEXT("1.4.0");

FAgentPanelBridge& FAgentPanelBridge::Get()
{
	static FAgentPanelBridge Instance;
	return Instance;
}

void FAgentPanelBridge::AddOp(const FString& Name, FAgentPanelOp Op)
{
	Ops.Add(Name, MoveTemp(Op));
}

static FString ToJsonString(const TSharedPtr<FJsonObject>& Obj)
{
	FString S;
	TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> W = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&S);
	FJsonSerializer::Serialize(Obj.ToSharedRef(), W);
	return S;
}

static TUniquePtr<FHttpServerResponse> JsonResponse(const TSharedPtr<FJsonObject>& Obj, EHttpServerResponseCodes Code = EHttpServerResponseCodes::Ok)
{
	TUniquePtr<FHttpServerResponse> R = FHttpServerResponse::Create(ToJsonString(Obj), TEXT("application/json; charset=utf-8"));
	R->Code = Code;
	return R;
}

static TSharedPtr<FJsonObject> ErrorObject(const FString& Error)
{
	TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
	O->SetBoolField(TEXT("ok"), false);
	O->SetStringField(TEXT("error"), Error);
	return O;
}

/** 请求头不区分大小写 */
static FString Header(const FHttpServerRequest& Req, const FString& Name)
{
	for (const TPair<FString, TArray<FString>>& H : Req.Headers)
	{
		if (H.Key.Equals(Name, ESearchCase::IgnoreCase) && H.Value.Num() > 0)
		{
			return H.Value[0];
		}
	}
	return FString();
}

FString FAgentPanelBridge::WorldId(const UWorld* World)
{
	if (!World || !GEngine)
	{
		return FString();
	}
	if (const FWorldContext* C = GEngine->GetWorldContextFromWorld(World))
	{
		if (C->WorldType == EWorldType::PIE)
		{
			return FString::Printf(TEXT("pie%d"), C->PIEInstance);
		}
		if (C->WorldType == EWorldType::Editor)
		{
			return TEXT("editor");
		}
	}
	return TEXT("game");
}

static const TCHAR* NetModeName(ENetMode M)
{
	switch (M)
	{
	case NM_DedicatedServer: return TEXT("dedicated");
	case NM_ListenServer: return TEXT("listen");
	case NM_Client: return TEXT("client");
	default: return TEXT("standalone");
	}
}

UWorld* FAgentPanelBridge::ResolveWorld(const FString& WorldIdIn, FString& Error)
{
	if (!GEngine)
	{
		Error = TEXT("引擎还没初始化好");
		return nullptr;
	}
	UWorld* Editor = nullptr;
	UWorld* Game = nullptr;
	UWorld* PieServer = nullptr;
	UWorld* PieAny = nullptr;
	for (const FWorldContext& C : GEngine->GetWorldContexts())
	{
		UWorld* W = C.World();
		if (!W)
		{
			continue;
		}
		const FString Id = WorldId(W);
		if (!WorldIdIn.IsEmpty() && Id == WorldIdIn)
		{
			return W;
		}
		if (C.WorldType == EWorldType::Editor)
		{
			Editor = W;
		}
		else if (C.WorldType == EWorldType::PIE)
		{
			if (!PieAny || C.PIEInstance < FCString::Atoi(*WorldId(PieAny).Mid(3)))
			{
				PieAny = W;
			}
			if (W->GetNetMode() != NM_Client && !PieServer)
			{
				PieServer = W;
			}
		}
		else if (C.WorldType == EWorldType::Game)
		{
			Game = W;
		}
	}
	if (!WorldIdIn.IsEmpty())
	{
		Error = FString::Printf(TEXT("找不到世界 %s（PIE 可能已经停了）"), *WorldIdIn);
		return nullptr;
	}
	UWorld* W = PieServer ? PieServer : PieAny ? PieAny : Game ? Game : Editor;
	if (!W)
	{
		Error = TEXT("这个进程里没有世界（后台编辑器只能读资源）");
	}
	return W;
}

TSharedPtr<FJsonObject> FAgentPanelBridge::Info() const
{
	TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
	O->SetBoolField(TEXT("ok"), true);
	O->SetStringField(TEXT("bridge"), BridgeVersion);
	O->SetStringField(TEXT("engine"), FEngineVersion::Current().ToString(EVersionComponent::Patch));
	O->SetStringField(TEXT("project"), FApp::GetProjectName());
	O->SetStringField(TEXT("kind"), Kind);
	O->SetNumberField(TEXT("pid"), FPlatformProcess::GetCurrentProcessId());
	O->SetStringField(TEXT("log"), FAgentPanelLog::Get().FilePath());
	TArray<TSharedPtr<FJsonValue>> Worlds;
	if (GEngine)
	{
		for (const FWorldContext& C : GEngine->GetWorldContexts())
		{
			UWorld* W = C.World();
			if (!W || (C.WorldType != EWorldType::Editor && C.WorldType != EWorldType::PIE && C.WorldType != EWorldType::Game))
			{
				continue;
			}
			TSharedPtr<FJsonObject> WO = MakeShared<FJsonObject>();
			WO->SetStringField(TEXT("id"), WorldId(W));
			WO->SetStringField(TEXT("type"), C.WorldType == EWorldType::Editor ? TEXT("editor") : C.WorldType == EWorldType::PIE ? TEXT("pie") : TEXT("game"));
			WO->SetStringField(TEXT("netMode"), NetModeName(W->GetNetMode()));
			WO->SetNumberField(TEXT("pieInstance"), C.PIEInstance);
			WO->SetStringField(TEXT("map"), W->GetMapName());
			APlayerController* PC = W->GetFirstPlayerController();
			WO->SetStringField(TEXT("player"), PC ? PC->GetName() : FString());
			Worlds.Add(MakeShared<FJsonValueObject>(WO));
		}
	}
	O->SetArrayField(TEXT("worlds"), Worlds);
	TArray<TSharedPtr<FJsonValue>> Names;
	for (const TPair<FString, FAgentPanelOp>& P : Ops)
	{
		Names.Add(MakeShared<FJsonValueString>(P.Key));
	}
	O->SetArrayField(TEXT("ops"), Names);
	AgentPanelLuaInfo(O);
	return O;
}

TSharedPtr<FJsonObject> FAgentPanelBridge::Dispatch(const TSharedPtr<FJsonObject>& Body)
{
	FString Op;
	if (!Body.IsValid() || !Body->TryGetStringField(TEXT("op"), Op))
	{
		return ErrorObject(TEXT("请求里没有 op"));
	}
	FAgentPanelOp* Fn = Ops.Find(Op);
	if (!Fn)
	{
		return ErrorObject(FString::Printf(TEXT("这个进程不支持 %s（编辑器专用的操作要在编辑器或后台编辑器里执行）"), *Op));
	}
	const TSharedPtr<FJsonObject>* ArgsPtr = nullptr;
	TSharedPtr<FJsonObject> Args = Body->TryGetObjectField(TEXT("args"), ArgsPtr) && ArgsPtr ? *ArgsPtr : MakeShared<FJsonObject>();
	TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
	FString Error;
	if (!(*Fn)(Args, Out, Error))
	{
		return ErrorObject(Error.IsEmpty() ? TEXT("执行失败") : Error);
	}
	Out->SetBoolField(TEXT("ok"), true);
	return Out;
}

void FAgentPanelBridge::WriteCard()
{
	const FString Dir = FPaths::Combine(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()), TEXT("AgentPanel"), TEXT("instances"));
	IFileManager::Get().MakeDirectory(*Dir, true);
	CardFile = FPaths::Combine(Dir, FString::Printf(TEXT("%u.json"), FPlatformProcess::GetCurrentProcessId()));
	TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
	O->SetNumberField(TEXT("pid"), FPlatformProcess::GetCurrentProcessId());
	O->SetNumberField(TEXT("port"), Port);
	O->SetStringField(TEXT("token"), Token);
	O->SetStringField(TEXT("kind"), Kind);
	O->SetStringField(TEXT("engine"), FEngineVersion::Current().ToString(EVersionComponent::Patch));
	O->SetStringField(TEXT("bridge"), BridgeVersion);
	O->SetStringField(TEXT("project"), FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()));
	O->SetStringField(TEXT("startedAt"), FDateTime::UtcNow().ToIso8601());
	FFileHelper::SaveStringToFile(ToJsonString(O), *CardFile, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

bool FAgentPanelBridge::Start(const FString& InKind)
{
	if (Port != 0)
	{
		return true;
	}
	Kind = InKind;
	Token = FGuid::NewGuid().ToString(EGuidFormats::Digits).ToLower();
	FAgentPanelLog::Get().Attach();
	if (Ops.Num() == 0 || !Ops.Contains(TEXT("console")))
	{
		RegisterRuntimeOps();
	}
	// 只听本机：监听地址在建路由之前设好（HTTPServer 按这个配置绑定）
	GConfig->SetString(TEXT("HTTPServer.Listeners"), TEXT("DefaultBindAddress"), TEXT("127.0.0.1"), GEngineIni);
	FHttpServerModule& Http = FHttpServerModule::Get();
	// 端口：命令行 -AgentPanelPort= 指定的优先，否则从 30110 往后找空闲的（同一台机器上可能开着好几个进程）
	int32 Want = 0;
	FParse::Value(FCommandLine::Get(), TEXT("AgentPanelPort="), Want);
	TSharedPtr<IHttpRouter> Router;
	for (int32 P = Want > 0 ? Want : 30110; P < (Want > 0 ? Want + 1 : 30200) && !Router.IsValid(); ++P)
	{
		Router = Http.GetHttpRouter(P, /* bFailOnBindFailure */ true);
		if (Router.IsValid())
		{
			Port = P;
		}
	}
	if (!Router.IsValid())
	{
		UE_LOG(LogAgentPanelBridge, Warning, TEXT("Agent 面板桥接没起来：30110-30199 没有空闲端口"));
		return false;
	}
	Router->BindRoute(FHttpPath(TEXT("/info")), EHttpServerRequestVerbs::VERB_GET,
		FHttpRequestHandler::CreateLambda([this](const FHttpServerRequest& Req, const FHttpResultCallback& Done)
		{
			if (Header(Req, TEXT("X-AgentPanel-Token")) != Token)
			{
				Done(JsonResponse(ErrorObject(TEXT("令牌不对")), EHttpServerResponseCodes::Denied));
				return true;
			}
			Done(JsonResponse(Info()));
			return true;
		}));
	Router->BindRoute(FHttpPath(TEXT("/rpc")), EHttpServerRequestVerbs::VERB_POST,
		FHttpRequestHandler::CreateLambda([this](const FHttpServerRequest& Req, const FHttpResultCallback& Done)
		{
			if (Header(Req, TEXT("X-AgentPanel-Token")) != Token)
			{
				Done(JsonResponse(ErrorObject(TEXT("令牌不对")), EHttpServerResponseCodes::Denied));
				return true;
			}
			LastRequest = FPlatformTime::Seconds();
			FUTF8ToTCHAR Conv(reinterpret_cast<const ANSICHAR*>(Req.Body.GetData()), Req.Body.Num());
			const FString Text(Conv.Length(), Conv.Get());
			TSharedPtr<FJsonObject> Body;
			TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
			if (!FJsonSerializer::Deserialize(Reader, Body) || !Body.IsValid())
			{
				Done(JsonResponse(ErrorObject(TEXT("请求不是 JSON")), EHttpServerResponseCodes::BadRequest));
				return true;
			}
			// 路由在游戏线程上回调（HTTPServer 由核心 ticker 驱动），反射读写可以直接做
			Done(JsonResponse(Dispatch(Body)));
			return true;
		}));
	Http.StartAllListeners();
	LastRequest = FPlatformTime::Seconds();
	WriteCard();
	UE_LOG(LogAgentPanelBridge, Display, TEXT("Agent 面板桥接已启动：127.0.0.1:%d（%s）"), Port, *Kind);
	return true;
}

void FAgentPanelBridge::Stop()
{
	if (!CardFile.IsEmpty())
	{
		IFileManager::Get().Delete(*CardFile, false, true, true);
		CardFile.Reset();
	}
	FAgentPanelLog::Get().Detach();
	Port = 0;
}

/** 运行时模块：编辑器、PIE、-game、专用服务器里在引擎初始化完成后起服务；后台编辑器由它自己的 commandlet 起 */
class FAgentPanelBridgeModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
#if AGENT_PANEL_BRIDGE_ENABLED
		if (IsRunningCommandlet() || FParse::Param(FCommandLine::Get(), TEXT("NoAgentPanel")))
		{
			return;
		}
		PostInit = AGENT_PANEL_POST_ENGINE_INIT.AddLambda([]()
		{
			const FString Kind = GIsEditor && !IsRunningGame() ? TEXT("editor") : IsRunningDedicatedServer() ? TEXT("server") : TEXT("game");
			FAgentPanelBridge::Get().Start(Kind);
		});
#endif
	}

	virtual void ShutdownModule() override
	{
		AGENT_PANEL_POST_ENGINE_INIT.Remove(PostInit);
		FAgentPanelBridge::Get().Stop();
	}

private:
	FDelegateHandle PostInit;
};

IMPLEMENT_MODULE(FAgentPanelBridgeModule, AgentPanelBridge)
