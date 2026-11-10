// 引擎版本差异集中在这里（5.4 起），各操作里不写版本判断。
#pragma once

#include "Misc/EngineVersionComparison.h"
#include "Runtime/Launch/Resources/Version.h"

// 5.6 起图表节点的坐标接口从 FVector2D 换成了 FVector2f 系列（旧写法还能隐式转换，但会报弃用）
#if ENGINE_MAJOR_VERSION > 5 || (ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 6)
#define AGENT_PANEL_GRAPH_POS(X, Y) FVector2f(static_cast<float>(X), static_cast<float>(Y))
#else
#define AGENT_PANEL_GRAPH_POS(X, Y) FVector2D(static_cast<double>(X), static_cast<double>(Y))
#endif
