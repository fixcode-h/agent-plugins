// 引擎版本差异集中在这里，各操作里不写版本判断。
// 插件以 UE 5.4 为基准开发：默认分支（#else）写 5.4 的写法，5.5+ / 5.8+ 才有的接口用版本判断包住。
// 2.2 起放在 UELinkCore/Public：UEKit 里的扩展插件（AssetForge、GameTest）直接 include，不各抄一份。
#pragma once

#include "Misc/EngineVersionComparison.h"
#include "Runtime/Launch/Resources/Version.h"

#include <type_traits>
#include <utility>

// 5.6 起部分图表节点的坐标接口（如 FEdGraphSchemaAction::PerformAction）换成了 FVector2f 系列。
// 注意不是全部：UBlueprintNodeSpawner::Invoke 到 5.8 仍收 FVector2D，而 FVector2f 不能隐式转 FVector2D，
// 用这个宏前先对照目标版本的函数签名。
#if ENGINE_MAJOR_VERSION > 5 || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 6)
#define UELINK_GRAPH_POS(X, Y) FVector2f(static_cast<float>(X), static_cast<float>(Y))
#else
#define UELINK_GRAPH_POS(X, Y) FVector2D(static_cast<double>(X), static_cast<double>(Y))
#endif

// 5.8 起 FJsonObject::Values 的键从 FString 换成了 UE::FSharedString，不能隐式转 FString。
// 两者的 operator* 都返回 const TCHAR*，按这个取键在各版本都能编过。
#define UELINK_JSON_KEY(Key) FString(*(Key))

// 5.8 起 GetObjectsWithOuter 的 bool bIncludeNestedObjects 弃用，改收 EGetObjectsFlags（UObject/FindObjectFlags.h）
#if ENGINE_MAJOR_VERSION > 5 || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8)
#include "UObject/FindObjectFlags.h"
#define UELINK_OUTER_NESTED(bNested) ((bNested) ? EGetObjectsFlags::IncludeNestedObjects : EGetObjectsFlags::None)
#else
#define UELINK_OUTER_NESTED(bNested) (bNested)
#endif

// 是否 5.8 及以上：下面几条 5.8 差异共用这一个判断
#if ENGINE_MAJOR_VERSION > 5 || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8)
#define UELINK_UE58 1
#else
#define UELINK_UE58 0
#endif

// 5.8 起 FCoreDelegates::OnPostEngineInit 弃用，改用 GetOnPostEngineInit()；5.4 只有前者
#if UELINK_UE58
#define UELINK_POST_ENGINE_INIT FCoreDelegates::GetOnPostEngineInit()
#else
#define UELINK_POST_ENGINE_INIT FCoreDelegates::OnPostEngineInit
#endif

// 5.8 起 ITimingProfilerProvider::ReadTimers 弃用，改 GetTimerReader()（AgentPanelTrace.cpp）
#define UELINK_TRACE_TIMER_READER UELINK_UE58

// Draw Calls / 图元数的全局数组在 5.4–5.6 一直在；之后的版本 RHI 统计在改，没在真实引擎验证过的版本先不读，网页显示「—」
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION <= 6
#define UELINK_DRAW_STATS 1
#else
#define UELINK_DRAW_STATS 0
#endif

// ---------- Lua 函数进 Unreal Insights trace（2.9.0，AgentPanelLuaTrace.cpp / AgentPanelTraceLua.cpp） ----------
// 下面这些在 5.4 上按引擎源码写，5.8 还没在本地编过；签名对不上时只改这里。
// 用的文件：ProfilingDebugging/CpuProfilerTrace.h、CountersTrace.h、TraceAuxiliary.h，Trace/Trace.h（都在 Core / TraceLog）。

// 注册一个 CPU 计时器（名字、文件、行号），返回 spec id：Name 是 TCHAR*，File 是 ANSICHAR*（引擎原样写进 trace），Line 是 uint32
#define UELINK_CPU_EVENT_TYPE(Name, File, Line) FCpuProfilerTrace::OutputEventType((Name), (File), static_cast<uint32>(Line))
#define UELINK_CPU_BEGIN(SpecId) FCpuProfilerTrace::OutputBeginEvent(SpecId)
#define UELINK_CPU_END() FCpuProfilerTrace::OutputEndEvent()
// 通道开没开（通道开关没有回调，只能读这个布尔）
#define UELINK_TRACE_CHANNEL_ON(Channel) UE_TRACE_CHANNELEXPR_IS_ENABLED(Channel)
// 开始 / 停止录制的委托（多播；参数个数各版本不一样，绑定处用不看参数的泛型 lambda）和「现在是不是在录」
#define UELINK_TRACE_ON_STARTED FTraceAuxiliary::OnTraceStarted
#define UELINK_TRACE_ON_STOPPED FTraceAuxiliary::OnTraceStopped
#define UELINK_TRACE_IS_RECORDING() FTraceAuxiliary::IsConnected()
// 每帧计数器：名字是固定的字符串，声明一次（命名空间作用域），每帧 Set 一次；只有 counters 通道开着时引擎才写进 trace
#define UELINK_TRACE_FLOAT_COUNTER(Var, DisplayName) TRACE_DECLARE_FLOAT_COUNTER(Var, DisplayName)
#define UELINK_TRACE_INT_COUNTER(Var, DisplayName) TRACE_DECLARE_INT_COUNTER(Var, DisplayName)
#define UELINK_TRACE_COUNTER_SET(Var, Value) TRACE_COUNTER_SET(Var, Value)
// 分析端（编辑器模块）：TraceServices 计时器结构上的源文件和行号（OutputEventType 写进去的那两个）
#define UELINK_TIMER_FILE(TimerPtr) ((TimerPtr)->File)
#define UELINK_TIMER_LINE(TimerPtr) ((TimerPtr)->Line)
// 计时器总数（luainfo 遍历全部计时器用）
#define UELINK_TIMER_COUNT(ReaderPtr) ((ReaderPtr)->GetTimerCount())

// ---------- trace 专项数据（2.11，AgentPanelTraceInfo / Memory / Load / Tasks / Net.cpp） ----------
// 先看引擎里有没有对应的 TraceServices 头文件（__has_include），没有就整类关掉（查询会回「编译时关掉了」），不让编译失败：
// 5.4 没有 TraceServices/Model/FileActivity.h（用户 2026-11-18 在 5.4 上编出 C1083）。
// 区域、LLM 标签集合、内存分配的查询接口在 5.5 之后才是现在这套写法，5.4 上也一并关掉，只在 5.8 上开。
// 哪一类在某个引擎版本上还编不过，把对应的开关改成 0 即可，各开关互不影响。
// 这个头文件 UELinkCore 也会包含，那里没有 TraceServices 的包含路径，开关都算 0，但 UELinkCore 不用它们。
#if __has_include("TraceServices/Model/Diagnostics.h")
#define UELINK_TRACE_SESSION 1
#else
#define UELINK_TRACE_SESSION 0
#endif
#if UELINK_UE58 && __has_include("TraceServices/Model/Regions.h")
#define UELINK_TRACE_REGIONS 1
#else
#define UELINK_TRACE_REGIONS 0
#endif
#if UELINK_UE58 && __has_include("TraceServices/Model/Memory.h")
#define UELINK_TRACE_MEMTAGS 1
#else
#define UELINK_TRACE_MEMTAGS 0
#endif
#if UELINK_UE58 && __has_include("TraceServices/Model/AllocationsProvider.h") && __has_include("TraceServices/Model/Callstack.h")
#define UELINK_TRACE_ALLOCS 1
#else
#define UELINK_TRACE_ALLOCS 0
#endif
#if __has_include("TraceServices/Model/LoadTimeProfiler.h") && __has_include("TraceServices/Containers/Tables.h")
#define UELINK_TRACE_LOADS 1
#else
#define UELINK_TRACE_LOADS 0
#endif
#if __has_include("TraceServices/Model/FileActivity.h") && __has_include("TraceServices/Containers/Tables.h")
#define UELINK_TRACE_FILES 1
#else
#define UELINK_TRACE_FILES 0
#endif
#if __has_include("TraceServices/Model/TasksProfiler.h")
#define UELINK_TRACE_TASKS 1
#else
#define UELINK_TRACE_TASKS 0
#endif
#if __has_include("TraceServices/Model/ContextSwitches.h")
#define UELINK_TRACE_SWITCHES 1
#else
#define UELINK_TRACE_SWITCHES 0
#endif
#if __has_include("TraceServices/Model/NetProfiler.h")
#define UELINK_TRACE_NET 1
#else
#define UELINK_TRACE_NET 0
#endif

// 区域（Timing Regions）：ReadRegionProvider 返回引用；回调返回 bool（false 停）
#define UELINK_REGION_PROVIDER(Session) (&TraceServices::ReadRegionProvider(Session))
// 枚举区域、区域名：5.8 起区域分成多条时间线（GetDefaultTimeline），名字从 FTimeRegion::Text 挪到 Timer->Name，
// 旧接口标了弃用。按「有没有这个成员」在编译期选（见下面 UELinkCompat 里的探测），不猜版本号
#define UELINK_REGION_ENUM(Provider, T0, T1, ...) UELinkCompat::EnumerateRegions(*(Provider), (T0), (T1), __VA_ARGS__)
#define UELINK_REGION_NAME(Region) UELinkCompat::RegionName(Region)
// LLM 标签：5.5 起多了标签集合，EnumerateTags 的形参在变，统一走这里。
// 回调是 lambda，里面的逗号会被当成宏参数分隔符，所以用可变参数宏原样转发
#define UELINK_MEM_ENUM_TAGS(Provider, ...) (Provider)->EnumerateTags(__VA_ARGS__)
// 内存分配查询的规则：某一时刻还活着的（a ≤ A < f）、A 到 B 之间分配且到 B 还没释放的（A ≤ a ≤ B < f）
#define UELINK_ALLOC_RULE_LIVE TraceServices::IAllocationsProvider::EQueryRule::aAf
#define UELINK_ALLOC_RULE_GROWTH TraceServices::IAllocationsProvider::EQueryRule::AaBf
// 分配的标签名
#define UELINK_ALLOC_TAG_NAME(Provider, Alloc) (Provider)->GetTagName((Alloc)->GetTag())
// 分配时的调用栈：FAllocation 上取调用栈的成员各版本不一样（GetCallstack / GetAllocCallstack / 只给编号再去
// ICallstacksProvider 查），所以不写死名字，在编译期探测有哪个就用哪个；一个都没有时返回空，
// UELINK_ALLOC_HAS_CALLSTACK 为 false，按调用栈分组直接报「取不到」（只在 5.8 开 ALLOCS，5.4 不走这里）
#define UELINK_ALLOC_CALLSTACK(Session, Alloc) UELinkCompat::AllocCallstack<TraceServices::FCallstack>(*(Alloc), (Session))
#define UELINK_ALLOC_HAS_CALLSTACK UELinkCompat::bAllocHasCallstack<TraceServices::IAllocationsProvider::FAllocation>
// 调用栈一帧的符号名（还没解析出来时是空）
#define UELINK_SYMBOL_NAME(Frame) ((Frame)->Symbol ? (Frame)->Symbol->Name : nullptr)
// 任务：按「这段时间里活着的任务」枚举
#define UELINK_TASK_ENUM_OPTION TraceServices::ETaskEnumerationOption::Alive

// ---------- 按成员探测的兼容层 ----------
// TraceServices 的接口每版都在改名，而云端没有引擎源码、没法逐版核对：这些地方不按版本号猜名字，
// 用 SFINAE 在编译期看类型上有哪个成员，选能编过的那条路；全都没有时退化成「取不到」，不让整个模块编不过。
namespace UELinkCompat
{
#define UELINK_DETECT_CALL(Trait, Member) \
	template <typename T, typename = void> struct Trait : std::false_type {}; \
	template <typename T> struct Trait<T, std::void_t<decltype(std::declval<const T&>().Member())>> : std::true_type {};
#define UELINK_DETECT_FIELD(Trait, Member) \
	template <typename T, typename = void> struct Trait : std::false_type {}; \
	template <typename T> struct Trait<T, std::void_t<decltype(std::declval<const T&>().Member)>> : std::true_type {};

	UELINK_DETECT_CALL(THasGetAllocCallstack, GetAllocCallstack)
	UELINK_DETECT_CALL(THasGetCallstack, GetCallstack)
	UELINK_DETECT_CALL(THasGetAllocCallstackId, GetAllocCallstackId)
	UELINK_DETECT_CALL(THasGetCallstackId, GetCallstackId)
	UELINK_DETECT_CALL(THasDefaultTimeline, GetDefaultTimeline)
	UELINK_DETECT_FIELD(THasRegionTimer, Timer)

#undef UELINK_DETECT_CALL
#undef UELINK_DETECT_FIELD

	template <typename AllocT>
	inline constexpr bool bAllocHasCallstack = THasGetAllocCallstack<AllocT>::value || THasGetCallstack<AllocT>::value
		|| THasGetAllocCallstackId<AllocT>::value || THasGetCallstackId<AllocT>::value;

	/** 按编号查调用栈。ReadCallstacksProvider 不带命名空间、参数是模板参数：到真用上时才按实参（ADL）去找，
	 *  分配上直接带调用栈指针的版本根本不会实例化这里 */
	template <typename CallstackT, typename SessionT, typename IdT>
	const CallstackT* CallstackById(const SessionT& Session, IdT Id)
	{
		const auto* Provider = ReadCallstacksProvider(Session);
		return Provider ? Provider->GetCallstack(Id) : nullptr;
	}

	template <typename CallstackT, typename AllocT, typename SessionT>
	const CallstackT* AllocCallstack(const AllocT& Alloc, const SessionT& Session)
	{
		if constexpr (THasGetAllocCallstack<AllocT>::value)
		{
			return Alloc.GetAllocCallstack();
		}
		else if constexpr (THasGetCallstack<AllocT>::value)
		{
			return Alloc.GetCallstack();
		}
		else if constexpr (THasGetAllocCallstackId<AllocT>::value)
		{
			return CallstackById<CallstackT>(Session, Alloc.GetAllocCallstackId());
		}
		else if constexpr (THasGetCallstackId<AllocT>::value)
		{
			return CallstackById<CallstackT>(Session, Alloc.GetCallstackId());
		}
		else
		{
			return nullptr;
		}
	}

	template <typename ProviderT, typename FnT>
	void EnumerateRegions(const ProviderT& Provider, double T0, double T1, FnT&& Fn)
	{
		if constexpr (THasDefaultTimeline<ProviderT>::value)
		{
			Provider.GetDefaultTimeline().EnumerateRegions(T0, T1, std::forward<FnT>(Fn));
		}
		else
		{
			Provider.EnumerateRegions(T0, T1, std::forward<FnT>(Fn));
		}
	}

	template <typename RegionT>
	FString RegionName(const RegionT& Region)
	{
		if constexpr (THasRegionTimer<RegionT>::value)
		{
			return Region.Timer ? FString(Region.Timer->Name) : FString();
		}
		else
		{
			return Region.Text ? FString(Region.Text) : FString();
		}
	}
}
