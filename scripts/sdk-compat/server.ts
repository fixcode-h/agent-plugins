/**
 * sdk/server.ts（副本）和面板 server/plugins/sdk.ts 的类型要一样：只在 .panel 在时由 scripts/check-sdk.mjs 跑 tsc 检查。
 * 每一项两边严格相等才算一样：面板加了字段副本没加（插件用不上新能力）、副本写错（插件按错的形状写）都会在这里报错，
 * 报错的那一行就是要同步的类型
 */
import type * as Copy from '../../sdk/server.ts'
import type * as Panel from '../../.panel/server/plugins/sdk.ts'

// 严格相等（可选字段多一个、少一个也算不一样）：互相可赋值认不出可选字段的差别
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const ok = <T extends true>(_: T) => _

ok<Same<Copy.McpContent, Panel.McpContent>>(true)
ok<Same<Copy.McpResult, Panel.McpResult>>(true)
ok<Same<Copy.McpToolEffect, Panel.McpToolEffect>>(true)
ok<Same<Copy.PluginConfirm, Panel.PluginConfirm>>(true)
ok<Same<Copy.McpCallContext, Panel.McpCallContext>>(true)
ok<Same<Copy.BackgroundJob, Panel.BackgroundJob>>(true)
ok<Same<Copy.McpTool, Panel.McpTool>>(true)
ok<Same<Copy.PluginRun, Panel.PluginRun>>(true)
ok<Same<Copy.PluginRunTools, Panel.PluginRunTools>>(true)
ok<Same<Copy.PluginServerContext, Panel.PluginServerContext>>(true)
ok<Same<Copy.Textifier, Panel.Textifier>>(true)
ok<Same<Copy.ServerPlugin, Panel.ServerPlugin>>(true)
