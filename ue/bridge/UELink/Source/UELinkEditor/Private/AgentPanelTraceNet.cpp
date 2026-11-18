// trace.query 的网络（2.11，面板「UE 性能分析 MCP 接口」设计稿 3 节）：net 通道录下的收发包，
// 按游戏实例（服务器 / 客户端）和连接分组，给范围内每个方向的包数、总字节、最大包、每秒字节。
// 包里具体是哪些对象和 RPC 要看 Unreal Insights 的 Networking Insights；这里先回答「哪个连接、哪个方向、哪段时间流量大」。
// 和其他查询一样在后台线程、会话读锁里跑。引擎版本差异只在 UELinkCompat.h 的宏里；编不过就把 UELINK_TRACE_NET 改成 0。
#include "AgentPanelBridgeUtil.h"
#include "UELinkCompat.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "TraceServices/Model/AnalysisSession.h"
#include "TraceServices/Model/TimingProfiler.h"
#if UELINK_TRACE_NET
#include "TraceServices/Model/NetProfiler.h"
#endif

#include "AgentPanelTraceShared.h"

namespace UELinkTrace
{
	bool HasNet(const IAnalysisSession& S)
	{
#if UELINK_TRACE_NET
		const INetProfilerProvider* NP = ReadNetProfilerProvider(S);
		return NP && NP->GetGameInstanceCount() > 0;
#else
		return false;
#endif
	}

	bool QueryNet(const IAnalysisSession& S, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
#if UELINK_TRACE_NET
		const INetProfilerProvider* NP = ReadNetProfilerProvider(S);
		if (!NP || NP->GetGameInstanceCount() == 0)
		{
			Error = NoData(TEXT("网络数据"), TEXT("net"), TEXT("（或用 preset=net）"));
			return false;
		}
		const double T0 = Num(A, TEXT("t0"), 0);
		const double T1 = Num(A, TEXT("t1"), S.GetDurationSeconds());
		const double Span = FMath::Max(1e-6, T1 - T0);
		TArray<TSharedPtr<FJsonValue>> Instances;
		NP->ReadGameInstances([&](const TraceServices::FNetProfilerGameInstance& G)
		{
			TArray<TSharedPtr<FJsonValue>> Conns;
			NP->ReadConnections(G.GameInstanceIndex, [&](const TraceServices::FNetProfilerConnection& C)
			{
				TSharedPtr<FJsonObject> CO = MakeShared<FJsonObject>();
				CO->SetStringField(TEXT("name"), C.Name ? C.Name : TEXT(""));
				CO->SetStringField(TEXT("address"), C.AddressString ? C.AddressString : TEXT(""));
				const TraceServices::ENetProfilerConnectionMode Modes[] = { TraceServices::ENetProfilerConnectionMode::Outgoing, TraceServices::ENetProfilerConnectionMode::Incoming };
				for (TraceServices::ENetProfilerConnectionMode Mode : Modes)
				{
					const uint32 Count = NP->GetPacketCount(C.ConnectionIndex, Mode);
					if (Count == 0 || OverBudget())
					{
						continue;
					}
					int64 Packets = 0;
					uint64 Bytes = 0;
					uint32 MaxBytes = 0;
					NP->EnumeratePackets(C.ConnectionIndex, Mode, 0, Count - 1, [&](const TraceServices::FNetProfilerPacket& P)
					{
						if (P.TimeStamp < T0 || P.TimeStamp > T1)
						{
							return;
						}
						++Packets;
						Bytes += P.TotalPacketSizeInBytes;
						MaxBytes = FMath::Max(MaxBytes, P.TotalPacketSizeInBytes);
					});
					TSharedPtr<FJsonObject> D = MakeShared<FJsonObject>();
					D->SetNumberField(TEXT("packets"), static_cast<double>(Packets));
					D->SetNumberField(TEXT("kb"), Fin(FMath::RoundToDouble(static_cast<double>(Bytes) / 102.4) / 10.0));
					D->SetNumberField(TEXT("maxBytes"), MaxBytes);
					D->SetNumberField(TEXT("kbPerSec"), Fin(FMath::RoundToDouble(static_cast<double>(Bytes) / 1024.0 / Span * 10.0) / 10.0));
					CO->SetObjectField(Mode == TraceServices::ENetProfilerConnectionMode::Outgoing ? TEXT("out") : TEXT("in"), D);
				}
				Conns.Add(MakeShared<FJsonValueObject>(CO));
			});
			TSharedPtr<FJsonObject> GO = MakeShared<FJsonObject>();
			GO->SetNumberField(TEXT("instance"), G.GameInstanceIndex);
			GO->SetBoolField(TEXT("server"), G.bIsServer);
			GO->SetArrayField(TEXT("connections"), Conns);
			Instances.Add(MakeShared<FJsonValueObject>(GO));
		});
		Out->SetArrayField(TEXT("instances"), Instances);
		return true;
#else
		Error = Disabled(TEXT("网络"));
		return false;
#endif
	}
}
