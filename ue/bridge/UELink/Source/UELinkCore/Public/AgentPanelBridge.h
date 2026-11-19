// 桥接服务的对外接口：编辑器模块、后台编辑器（commandlet）通过它登记自己的操作、启动服务。
// 协议：POST /rpc，请求头 X-AgentPanel-Token，正文 {"op": "...", "args": {...}}，回 {"ok": true, ...} 或 {"ok": false, "error": "..."}；
// GET /info 回进程和世界列表。只监听 127.0.0.1，令牌每次启动随机生成、写在 Saved/UELink/instances/<PID>.json 的名片里（兼容旧面板，Saved/AgentPanel/instances 下也写一份）。
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

#include <atomic>

class UWorld;
struct FHttpServerResponse;

/** 一个操作：args 是请求里的 args，往 Out 里写结果字段；出错时返回 false 并写 Error（原样显示给用户和 Agent） */
using FAgentPanelOp = TFunction<bool(const TSharedPtr<FJsonObject>& Args, TSharedPtr<FJsonObject>& Out, FString& Error)>;

/**
 * 异步操作的回复（2.11）：任意线程都可以调，只能调一次；桥接把它转回游戏线程再发 HTTP 回复。
 * bOk 为 false 时 Error 原样显示给用户和 Agent
 */
using FAgentPanelReply = TFunction<void(bool bOk, TSharedPtr<FJsonObject> Out, const FString& Error)>;
/**
 * 异步操作（2.11）：在游戏线程上被调用，可以把重活交给后台线程，做完再调 Reply。
 * 给耗时长、又不碰 UObject 的读操作用（trace 分析）：查询期间编辑器不卡，多个客户端的查询也能同时跑
 */
using FAgentPanelAsyncOp = TFunction<void(const TSharedPtr<FJsonObject>& Args, FAgentPanelReply Reply)>;

/**
 * 批量（2.14）：登记了的操作在参数里给 paths（路径数组）或 items（[{path, ...这一项自己的参数}]）时，
 * 不直接执行，而是展开成一个作业逐个执行（UELinkBatch.cpp，协议文档「批量」一节）
 */
struct FAgentPanelBatchInfo
{
	/** 会改资源：先整批演练（操作支持 dryRun 时）、失败默认回滚 */
	bool bWrite = false;
	/** 操作认 dryRun 参数：真实执行后撤销，不留改动 */
	bool bDryRun = false;
	/** 操作认 compile 参数（bp.edit）：compile = "end" 时逐个改完不编译，整批改完再逐个 bp.compile */
	bool bCompile = false;
	/** 同一个资源可以在一批里出现多次（datatable.set：同一张表改不同的行和列）；默认不行，免得第二次改的是第一次的结果 */
	bool bRepeatPaths = false;
	/** 回滚怎么做：tx（结果里的 tx 交给 asset.undo）、prev（同一个操作把 value 设回结果里的 prev）、空表示不能回滚 */
	FString Undo;
};

/** 扩展发出的推送事件：主题（forge.job、gt.record……）和事件内容。推送通道收到后转给订阅了这个主题的客户端 */
DECLARE_MULTICAST_DELEGATE_TwoParams(FOnAgentPanelEvent, const FString& /*Topic*/, const TSharedRef<FJsonObject>& /*Event*/);

class UELINKCORE_API FAgentPanelBridge
{
public:
	static FAgentPanelBridge& Get();

	/** 登记操作（同名的后登记的覆盖前面的：编辑器模块用它接管编辑器世界的截图等） */
	void AddOp(const FString& Name, FAgentPanelOp Op);
	/** 登记异步操作（2.11，见 FAgentPanelAsyncOp）；和同名的同步操作并存时异步的优先 */
	void AddAsyncOp(const FString& Name, FAgentPanelAsyncOp Op);

	/**
	 * UEKit 扩展插件（AssetForge、GameTest……）登记自己：名片和 /info 的 extensions 里列出名字和版本，
	 * 客户端据此知道这个进程里装了哪些扩展、什么版本（装了没重编时磁盘上的版本和这里不同）。
	 * 同名的再登记一次只更新版本。扩展模块在 StartupModule 里调。
	 */
	void RegisterExtension(const FString& Name, const FString& Version);
	void UnregisterExtension(const FString& Name);

	/**
	 * 扩展登记操作：名字必须带「前缀.」（forge.import、gt.run），和已有操作重名时拒绝并返回 false，
	 * 不覆盖 UELink 自己的操作（AddOp 是给 UELink 内部模块接管用的，扩展不要用它）。
	 */
	bool AddExtensionOp(const FString& Name, FAgentPanelOp Op);
	void RemoveOp(const FString& Name);

	/**
	 * 2.12：在进程内直接调一个已登记的同步操作（不经 HTTP、不要令牌），在游戏线程调用。
	 * 给扩展复用 UELink 的能力用（GameTest 读 Lua 模块、调 Lua 函数、取 Lua 报错走 lua.get / lua.call / lua.errors），
	 * 参数和返回字段和客户端经 /rpc 调时完全一样，扩展不用再写一份 Lua 读写。
	 * 操作不存在、引擎在退出或回收垃圾时返回 false 并写 Error；Out 一定不为空。
	 */
	bool CallOp(const FString& Name, const TSharedPtr<FJsonObject>& Args, TSharedPtr<FJsonObject>& Out, FString& Error);
	/** 2.12：这个进程有没有登记这个操作（例如 lua.* 只在编进了 Lua 支持时有） */
	bool HasOp(const FString& Name) const { return Ops.Contains(Name); }

	/** 2.14：让一个已登记的同步操作支持批量（paths / items），见 FAgentPanelBatchInfo */
	void AddBatchOp(const FString& Name, const FAgentPanelBatchInfo& Info) { BatchOps.Add(Name, Info); }
	const FAgentPanelBatchInfo* FindBatchOp(const FString& Name) const { return BatchOps.Find(Name); }
	/** 能批量的操作名（/info 的 batchOps，客户端据此决定一次传多个还是逐个调） */
	TArray<FString> BatchOpNames() const;

	/**
	 * 扩展推一条事件（作业进度、录制到的一步……）：主题必须带「前缀.」，和操作名同一个前缀。
	 * 推送通道在编辑器里才有；没人订阅时什么都不做，所以每帧推也很便宜。
	 * 这样客户端拿实时状态不用轮询 *.job；作业的最终结果仍然能用 *.job 查（客户端可能中途才连上）。
	 */
	void PublishEvent(const FString& Topic, const TSharedRef<FJsonObject>& Event);
	FOnAgentPanelEvent& OnEvent() { return EventDelegate; }

	/** 起服务、写名片；Kind 是 editor / game / server / background。已经起过就什么都不做 */
	bool Start(const FString& Kind);
	void Stop();
	bool IsRunning() const { return Port != 0; }

	/** 最近一次收到请求的时间（后台编辑器按它判断闲置多久） */
	double LastRequestTime() const { return LastRequest; }

	/** 按世界 id 找世界：editor、pie0、pie1…、game；空表示默认（有 PIE 用 PIE 的服务器 / 单机世界，否则游戏世界，否则编辑器世界） */
	static UWorld* ResolveWorld(const FString& WorldId, FString& Error);
	static FString WorldId(const UWorld* World);

	/**
	 * 往名片里加一个字段（编辑器模块用它登记推送通道的端口 stream、features）并立刻重写名片。
	 * HTTP 服务没起来时（-NoAgentPanel、端口没拿到）也写名片，只是没有 port / http：推送通道的客户端（UEToVS）只认名片找端口和令牌
	 */
	void SetCardField(const FString& Name, const TSharedPtr<FJsonValue>& Value);

	/**
	 * 只记下名片字段、不写名片（2.7）：给引擎初始化前就要定下的字段用（编辑器的 ready: false），
	 * 等 Start 第一次写名片时一起带上。不在这里定进程类型，免得游戏进程被写成 editor
	 */
	void PresetCardField(const FString& Name, const TSharedPtr<FJsonValue>& Value) { CardExtra.Add(Name, Value); }

	/** 本次启动的令牌（推送通道用同一个令牌认新客户端） */
	const FString& GetToken() const { return Token; }

private:
	TMap<FString, FAgentPanelOp> Ops;
	TMap<FString, FAgentPanelAsyncOp> AsyncOps;
	TMap<FString, FAgentPanelBatchInfo> BatchOps;
	/** HTTP 服务还在：异步操作的回复晚到时（服务已停、引擎在退出）不再往已经拆掉的连接上写 */
	TSharedRef<std::atomic<bool>, ESPMode::ThreadSafe> Alive = MakeShared<std::atomic<bool>, ESPMode::ThreadSafe>(false);
	int32 Port = 0;
	FString Token;
	FString Kind;
	FString StartedAt;
	TArray<FString> CardFiles;
	TMap<FString, TSharedPtr<FJsonValue>> CardExtra;
	/** 扩展名 → 版本，按登记顺序 */
	TArray<TPair<FString, FString>> Extensions;
	TArray<TSharedPtr<FJsonValue>> ExtensionsJson() const;
	void UpdateExtensionsCard();
	double LastRequest = 0;
	FOnAgentPanelEvent EventDelegate;

	void WriteCard();
	/** 令牌、启动时间、进程类型：HTTP 服务和推送通道谁先起谁生成，之后不变（客户端读到的令牌一直有效） */
	void EnsureIdentity();
	TSharedPtr<FJsonObject> Info() const;
	TSharedPtr<FJsonObject> Dispatch(const TSharedPtr<FJsonObject>& Body);
	/** 请求的是异步操作时接手（返回 true，回复稍后经 Done 发出）；不是就返回 false 走 Dispatch */
	bool DispatchAsync(const TSharedPtr<FJsonObject>& Body, const TFunction<void(TUniquePtr<FHttpServerResponse>&& Response)>& Done);
	void RegisterRuntimeOps();
};
