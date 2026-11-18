#include "AgentPanelBridge.h"
#include "UELinkCompat.h"

#include "AgentPanelLog.h"
#include "UELinkVersion.h"
#include "AgentPanelLuaOps.h"
#include "Async/Async.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Misc/Parse.h"
#include "UObject/GarbageCollection.h"
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

// 面板按名片里的 bridge 字段比版本：合进 UELink 后报 UELink 的版本（2.0.0 起，比旧桥接的 1.x 都大）
static const TCHAR* BridgeVersion = UELINK_VERSION;

FAgentPanelBridge& FAgentPanelBridge::Get()
{
	static FAgentPanelBridge Instance;
	return Instance;
}

void FAgentPanelBridge::AddOp(const FString& Name, FAgentPanelOp Op)
{
	Ops.Add(Name, MoveTemp(Op));
}

void FAgentPanelBridge::AddAsyncOp(const FString& Name, FAgentPanelAsyncOp Op)
{
	AsyncOps.Add(Name, MoveTemp(Op));
}

bool FAgentPanelBridge::AddExtensionOp(const FString& Name, FAgentPanelOp Op)
{
	// 前缀把扩展的操作和 UELink 自己的分开：以后 UELink 加操作不会撞上扩展，客户端看名字就知道归谁
	int32 Dot = INDEX_NONE;
	if (!Name.FindChar(TEXT('.'), Dot) || Dot == 0)
	{
		UE_LOG(LogAgentPanelBridge, Error, TEXT("UELink：扩展操作 %s 没有带「前缀.」，没有登记"), *Name);
		return false;
	}
	if (Ops.Contains(Name))
	{
		UE_LOG(LogAgentPanelBridge, Error, TEXT("UELink：操作 %s 已经有了，扩展不能覆盖，没有登记"), *Name);
		return false;
	}
	Ops.Add(Name, MoveTemp(Op));
	return true;
}

void FAgentPanelBridge::RemoveOp(const FString& Name)
{
	Ops.Remove(Name);
}

void FAgentPanelBridge::PublishEvent(const FString& Topic, const TSharedRef<FJsonObject>& Event)
{
	// 主题和操作名同一套前缀规则：没有前缀的主题会和 UELink 自己的 log / tests / liveCoding 混在一起
	int32 Dot = INDEX_NONE;
	if (!Topic.FindChar(TEXT('.'), Dot) || Dot <= 0 || Dot == Topic.Len() - 1)
	{
		UE_LOG(LogAgentPanelBridge, Warning, TEXT("UELink：推送事件的主题要带「前缀.」：%s"), *Topic);
		return;
	}
	EventDelegate.Broadcast(Topic, Event);
}

TArray<TSharedPtr<FJsonValue>> FAgentPanelBridge::ExtensionsJson() const
{
	TArray<TSharedPtr<FJsonValue>> Arr;
	for (const TPair<FString, FString>& E : Extensions)
	{
		TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("name"), E.Key);
		O->SetStringField(TEXT("version"), E.Value);
		Arr.Add(MakeShared<FJsonValueObject>(O));
	}
	return Arr;
}

void FAgentPanelBridge::RegisterExtension(const FString& Name, const FString& Version)
{
	TPair<FString, FString>* Found = Extensions.FindByPredicate([&](const TPair<FString, FString>& E) { return E.Key == Name; });
	if (Found)
	{
		Found->Value = Version;
	}
	else
	{
		Extensions.Emplace(Name, Version);
	}
	UpdateExtensionsCard();
}

void FAgentPanelBridge::UnregisterExtension(const FString& Name)
{
	Extensions.RemoveAll([&](const TPair<FString, FString>& E) { return E.Key == Name; });
	UpdateExtensionsCard();
}

void FAgentPanelBridge::UpdateExtensionsCard()
{
	CardExtra.Add(TEXT("extensions"), MakeShared<FJsonValueArray>(ExtensionsJson()));
	// 扩展模块可能比 HTTP 服务先起也可能后起。还没有身份（服务和推送通道都没起）时只记下，等 Start 写名片时带上；
	// 不在这里 EnsureIdentity：那会把进程类型先定成 editor，游戏进程里就写错了
	if (!Token.IsEmpty())
	{
		WriteCard();
	}
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
		// 停止 PIE 的那一帧世界还在列表里但正在拆：当它已经没了，操作不去碰正在销毁的 Actor 和组件
		if (!W || !IsValid(W) || W->bIsTearingDown)
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
	O->SetArrayField(TEXT("extensions"), ExtensionsJson());
	// 2.7：编辑器就绪（编辑器模块写进名片字段的 ready / readyAt），客户端不用再读一次名片
	for (const TCHAR* Key : {TEXT("ready"), TEXT("readyAt")})
	{
		if (const TSharedPtr<FJsonValue>* V = CardExtra.Find(Key))
		{
			O->SetField(Key, *V);
		}
	}
	TArray<TSharedPtr<FJsonValue>> Worlds;
	if (GEngine)
	{
		for (const FWorldContext& C : GEngine->GetWorldContexts())
		{
			UWorld* W = C.World();
			if (!W || !IsValid(W) || W->bIsTearingDown || (C.WorldType != EWorldType::Editor && C.WorldType != EWorldType::PIE && C.WorldType != EWorldType::Game))
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
	for (const TPair<FString, FAgentPanelAsyncOp>& P : AsyncOps)
	{
		if (!Ops.Contains(P.Key))
		{
			Names.Add(MakeShared<FJsonValueString>(P.Key));
		}
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
	// 引擎在退出、或正在回收垃圾时不执行任何操作：这时对象随时会被销毁，读写都可能踩到野指针
	if (IsEngineExitRequested())
	{
		return ErrorObject(TEXT("编辑器正在退出，不再执行操作"));
	}
	if (IsGarbageCollecting())
	{
		return ErrorObject(TEXT("引擎正在回收垃圾，稍后再试"));
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
	// 操作可能把 Out 换成一个取不到的对象（如 GetObjectField 缺字段时返回空指针），
	// 这里兜底成空对象，免得扩展的一处疏忽直接让编辑器崩溃
	if (!Out.IsValid())
	{
		Out = MakeShared<FJsonObject>();
	}
	Out->SetBoolField(TEXT("ok"), true);
	return Out;
}

bool FAgentPanelBridge::DispatchAsync(const TSharedPtr<FJsonObject>& Body, const TFunction<void(TUniquePtr<FHttpServerResponse>&& Response)>& Done)
{
	FString Op;
	if (!Body.IsValid() || !Body->TryGetStringField(TEXT("op"), Op))
	{
		return false;
	}
	FAgentPanelAsyncOp* Fn = AsyncOps.Find(Op);
	if (!Fn)
	{
		return false;
	}
	// 退出和回收垃圾时的拦法和同步操作一样：交给 Dispatch 回错误
	if (IsEngineExitRequested() || IsGarbageCollecting())
	{
		return false;
	}
	const TSharedPtr<FJsonObject>* ArgsPtr = nullptr;
	TSharedPtr<FJsonObject> Args = Body->TryGetObjectField(TEXT("args"), ArgsPtr) && ArgsPtr ? *ArgsPtr : MakeShared<FJsonObject>();
	TSharedRef<std::atomic<bool>, ESPMode::ThreadSafe> Live = Alive;
	TSharedRef<std::atomic<bool>, ESPMode::ThreadSafe> Replied = MakeShared<std::atomic<bool>, ESPMode::ThreadSafe>(false);
	FHttpResultCallback Callback = Done;
	(*Fn)(Args, [Live, Replied, Callback](bool bOk, TSharedPtr<FJsonObject> Out, const FString& Error)
	{
		// 只回一次：操作写错了调两次时，第二次直接丢掉（HTTP 连接只能回一次）
		if (Replied->exchange(true))
		{
			return;
		}
		TSharedPtr<FJsonObject> Res = Out.IsValid() ? Out : MakeShared<FJsonObject>();
		if (bOk)
		{
			Res->SetBoolField(TEXT("ok"), true);
		}
		else
		{
			Res = ErrorObject(Error.IsEmpty() ? TEXT("执行失败") : Error);
		}
		auto Send = [Live, Callback, Res]()
		{
			if (Live->load())
			{
				Callback(JsonResponse(Res));
			}
		};
		if (IsInGameThread())
		{
			Send();
		}
		else
		{
			AsyncTask(ENamedThreads::GameThread, MoveTemp(Send));
		}
	});
	return true;
}

void FAgentPanelBridge::SetCardField(const FString& Name, const TSharedPtr<FJsonValue>& Value)
{
	CardExtra.Add(Name, Value);
	EnsureIdentity();
	WriteCard();
}

void FAgentPanelBridge::EnsureIdentity()
{
	if (Token.IsEmpty())
	{
		Token = FGuid::NewGuid().ToString(EGuidFormats::Digits).ToLower();
		StartedAt = FDateTime::UtcNow().ToIso8601();
	}
	if (Kind.IsEmpty())
	{
		// 只有推送通道（只在编辑器里起）会在 Start 之前走到这里
		Kind = TEXT("editor");
	}
}

void FAgentPanelBridge::WriteCard()
{
	TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
	O->SetNumberField(TEXT("pid"), FPlatformProcess::GetCurrentProcessId());
	if (Port != 0)
	{
		// 没有 HTTP 服务时不写端口：面板 UE 插件跳过没有 port 的名片
		O->SetNumberField(TEXT("port"), Port);
	}
	O->SetStringField(TEXT("token"), Token);
	O->SetStringField(TEXT("kind"), Kind);
	O->SetStringField(TEXT("engine"), FEngineVersion::Current().ToString(EVersionComponent::Patch));
	O->SetStringField(TEXT("bridge"), BridgeVersion);
	O->SetStringField(TEXT("project"), FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath()));
	// 名片会因为编辑器模块补字段重写，启动时间用 Start 时记下的，不随重写变
	O->SetStringField(TEXT("startedAt"), StartedAt);
	// UELink 新加的字段：旧面板不认识的字段直接忽略
	O->SetStringField(TEXT("plugin"), TEXT("UELink"));
	O->SetStringField(TEXT("version"), BridgeVersion);
	if (Port != 0)
	{
		O->SetNumberField(TEXT("http"), Port);
	}
	for (const TPair<FString, TSharedPtr<FJsonValue>>& Extra : CardExtra)
	{
		O->SetField(Extra.Key, Extra.Value);
	}
	const FString Json = ToJsonString(O);
	// 2.1 起只写 Saved/UELink/instances（2.0 还给旧面板 UE 插件写一份 Saved/AgentPanel/instances，已去掉）
	const FString Dir = FPaths::Combine(FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()), TEXT("UELink"), TEXT("instances"));
	IFileManager::Get().MakeDirectory(*Dir, true);
	const FString File = FPaths::Combine(Dir, FString::Printf(TEXT("%u.json"), FPlatformProcess::GetCurrentProcessId()));
	FFileHelper::SaveStringToFile(Json, *File, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	CardFiles.Reset();
	CardFiles.Add(File);
}

bool FAgentPanelBridge::Start(const FString& InKind)
{
	if (Port != 0)
	{
		return true;
	}
	Kind = InKind;
	EnsureIdentity();
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
		UE_LOG(LogAgentPanelBridge, Warning, TEXT("UELink 的 HTTP 服务没起来：30110-30199 没有空闲端口"));
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
			// 异步操作（2.11，trace 分析）：回复稍后由操作自己发
			if (DispatchAsync(Body, Done))
			{
				return true;
			}
			// 路由在游戏线程上回调（HTTPServer 由核心 ticker 驱动），反射读写可以直接做
			Done(JsonResponse(Dispatch(Body)));
			return true;
		}));
	Http.StartAllListeners();
	Alive->store(true);
	LastRequest = FPlatformTime::Seconds();
	WriteCard();
	UE_LOG(LogAgentPanelBridge, Display, TEXT("UELink %s 已启动：127.0.0.1:%d（%s）"), BridgeVersion, Port, *Kind);
	return true;
}

void FAgentPanelBridge::Stop()
{
	for (const FString& File : CardFiles)
	{
		IFileManager::Get().Delete(*File, false, true, true);
	}
	CardFiles.Reset();
	FAgentPanelLog::Get().Detach();
	// 还没回的异步操作不再回：连接跟着服务一起没了
	Alive->store(false);
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
		PostInit = UELINK_POST_ENGINE_INIT.AddLambda([]()
		{
			const FString Kind = GIsEditor && !IsRunningGame() ? TEXT("editor") : IsRunningDedicatedServer() ? TEXT("server") : TEXT("game");
			FAgentPanelBridge::Get().Start(Kind);
		});
#endif
	}

	virtual void ShutdownModule() override
	{
		UELINK_POST_ENGINE_INIT.Remove(PostInit);
		AgentPanelUnregisterEmmyValues();
		AgentPanelUnregisterLuaTrace();
		FAgentPanelBridge::Get().Stop();
	}

private:
	FDelegateHandle PostInit;
};

IMPLEMENT_MODULE(FAgentPanelBridgeModule, UELinkCore)
