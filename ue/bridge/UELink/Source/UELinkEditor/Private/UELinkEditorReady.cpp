// 2.7：编辑器就绪状态。以前面板和 Agent 只能看名片出现（引擎初始化完、HTTP 服务起来）或者干等一段时间，
// 但那时编辑器主窗口可能还没出来、资源注册表还在扫盘，调用会卡住或拿到不全的结果。
// 这里每 0.5 秒看一次：主窗口建好、资源注册表扫完、没有异步加载中的包，连续两次都满足就算「就绪」，
// 名片写上 ready: true（启动时是 false）、推 uelink.ready 事件、日志里打一行；之后不再回退。
// 着色器和资源编译不算进就绪（编辑器在编着色器时已经能用），只在 editor.ready 的回包里报剩多少，客户端自己决定等不等。
// 只用引擎公开的状态（IMainFrameModule、IAssetRegistry、IsAsyncLoading、GShaderCompilingManager、FAssetCompilingManager），5.4 和 5.8 都有。
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "AssetCompilingManager.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Editor.h"
#include "Interfaces/IMainFrameModule.h"
#include "Misc/CoreMisc.h"
#include "Misc/DateTime.h"
#include "Modules/ModuleManager.h"
#include "ShaderCompiler.h"
#include "UObject/UObjectGlobals.h"

using namespace AgentPanel;
using namespace AgentPanelEd;

namespace UELinkEditorReady
{
	FTSTicker::FDelegateHandle Tick;
	bool bReady = false;
	/** 连续满足就绪条件的次数：资源注册表扫完和下一批加载之间可能有一帧空档，要两次都满足 */
	int32 Stable = 0;
	FString ReadyAt;
	double ReadySeconds = 0;

	struct FState
	{
		bool bMainFrame = false;
		bool bAssetsLoading = false;
		bool bAsyncLoading = false;
		int32 ShadersLeft = 0;
		int32 AssetsCompiling = 0;
	};

	/** 只在要跟踪的进程里有：编辑器（不是 commandlet、不是 -game） */
	bool Applies()
	{
		return GIsEditor && !IsRunningCommandlet() && !IsRunningGame();
	}

	FState Read()
	{
		FState S;
		// MainFrame 模块没加载时不能 GetModuleChecked（会断言），先看 IsModuleLoaded
		if (GEditor && FModuleManager::Get().IsModuleLoaded(TEXT("MainFrame")))
		{
			S.bMainFrame = FModuleManager::GetModuleChecked<IMainFrameModule>(TEXT("MainFrame")).IsWindowInitialized();
		}
		if (IAssetRegistry* Registry = IAssetRegistry::Get())
		{
			S.bAssetsLoading = Registry->IsLoadingAssets();
		}
		else
		{
			S.bAssetsLoading = true;
		}
		S.bAsyncLoading = IsAsyncLoading();
		S.ShadersLeft = GShaderCompilingManager ? GShaderCompilingManager->GetNumRemainingJobs() : 0;
		S.AssetsCompiling = FAssetCompilingManager::Get().GetNumRemainingAssets();
		return S;
	}

	/** 从进程启动算起的秒数（GStartTime 是引擎记下的进程启动时刻） */
	double SinceStart()
	{
		return FPlatformTime::Seconds() - GStartTime;
	}

	/** 还在等什么：给 editor.ready 的回包和日志用，客户端可以直接显示 */
	FString WaitingFor(const FState& S)
	{
		if (!S.bMainFrame)
		{
			return TEXT("mainFrame");
		}
		if (S.bAssetsLoading)
		{
			return TEXT("assetRegistry");
		}
		if (S.bAsyncLoading)
		{
			return TEXT("asyncLoading");
		}
		return FString();
	}

	void MarkReady()
	{
		bReady = true;
		ReadySeconds = SinceStart();
		ReadyAt = FDateTime::UtcNow().ToIso8601();
		FAgentPanelBridge& B = FAgentPanelBridge::Get();
		// 先写 readyAt 再写 ready：每次 SetCardField 都会重写名片，客户端看到 ready: true 时 readyAt 一定已经在了
		B.SetCardField(TEXT("readyAt"), MakeShared<FJsonValueString>(ReadyAt));
		B.SetCardField(TEXT("ready"), MakeShared<FJsonValueBoolean>(true));
		TSharedRef<FJsonObject> Ev = MakeShared<FJsonObject>();
		Ev->SetBoolField(TEXT("ready"), true);
		Ev->SetStringField(TEXT("readyAt"), ReadyAt);
		Ev->SetNumberField(TEXT("seconds"), FMath::RoundToInt(ReadySeconds));
		B.PublishEvent(TEXT("uelink.ready"), Ev);
		UE_LOG(LogTemp, Display, TEXT("UELink：编辑器已就绪（启动 %d 秒）"), FMath::RoundToInt(ReadySeconds));
	}

	bool OnTick(float)
	{
		if (bReady)
		{
			return false;
		}
		const FState S = Read();
		Stable = WaitingFor(S).IsEmpty() ? Stable + 1 : 0;
		if (Stable >= 2)
		{
			MarkReady();
			Tick.Reset();
			return false;
		}
		return true;
	}
}

void AgentPanelEd::PresetEditorReady()
{
	// 在引擎初始化之前（模块启动时）记下 ready: false：HTTP 服务起来第一次写名片就带上它，
	// 客户端看到没有 ready 字段的名片就知道是 2.7 以前的 UELink，按旧办法（名片出现即可用）处理
	if (UELinkEditorReady::Applies())
	{
		FAgentPanelBridge::Get().PresetCardField(TEXT("ready"), MakeShared<FJsonValueBoolean>(false));
	}
}

void AgentPanelEd::StartEditorReady()
{
	if (!UELinkEditorReady::Applies() || UELinkEditorReady::bReady || UELinkEditorReady::Tick.IsValid())
	{
		return;
	}
	UELinkEditorReady::Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&UELinkEditorReady::OnTick), 0.5f);
}

void AgentPanelEd::StopEditorReady()
{
	if (UELinkEditorReady::Tick.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(UELinkEditorReady::Tick);
		UELinkEditorReady::Tick.Reset();
	}
}

void AgentPanelEd::RegisterEditorReadyOps()
{
	FAgentPanelBridge::Get().AddOp(TEXT("editor.ready"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		if (!UELinkEditorReady::Applies())
		{
			Error = TEXT("这个进程不是编辑器（后台编辑器、-game 进程名片出现就能用），不用等就绪");
			return false;
		}
		const UELinkEditorReady::FState S = UELinkEditorReady::Read();
		Out->SetBoolField(TEXT("ready"), UELinkEditorReady::bReady);
		if (UELinkEditorReady::bReady)
		{
			Out->SetStringField(TEXT("readyAt"), UELinkEditorReady::ReadyAt);
			Out->SetNumberField(TEXT("readySeconds"), FMath::RoundToInt(UELinkEditorReady::ReadySeconds));
		}
		else
		{
			Out->SetStringField(TEXT("waiting"), UELinkEditorReady::WaitingFor(S));
		}
		Out->SetNumberField(TEXT("seconds"), FMath::RoundToInt(UELinkEditorReady::SinceStart()));
		Out->SetBoolField(TEXT("mainFrame"), S.bMainFrame);
		Out->SetBoolField(TEXT("assetsLoading"), S.bAssetsLoading);
		Out->SetBoolField(TEXT("asyncLoading"), S.bAsyncLoading);
		Out->SetNumberField(TEXT("shadersLeft"), S.ShadersLeft);
		Out->SetNumberField(TEXT("assetsCompiling"), S.AssetsCompiling);
		return true;
	});
}
