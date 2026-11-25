import type { PluginConfirm } from '../../sdk/server.ts'
import { t } from './util.ts'

/**
 * UE 插件确认卡的授权类型（用户 2026-11-25：执行 Lua 的确认卡只有「拒绝 / 允许」，要加「本对话不再询问」，
 * 其余漏接的确认卡一并接上）。每张确认卡带一个规则键（插件接口 17 的 rule）：面板加上 `plugin:ue:` 前缀记进对话的
 * 放行规则，用户点过「本对话不再询问」后同一个键直接允许、对话里留一行记录。设置 →「授权卡」里「插件操作」一类能整体关掉。
 *
 * 键按「同一类操作」分，不带具体参数（同一个对话里放行过执行 Lua，下一段 Lua 不再问）；危险控制台命令按命中的那条规则分，
 * 放行了 `quit` 不等于放行了 `obj gc*`。新加确认卡在这里加一项，不在调用处各写一份键和说法；
 * 游戏内测试的授权卡（self-test-gate.ts）是工作流能预设的那一类，键单独定在那边
 */
export type UeGrant =
  | 'lua-exec'
  | 'runtime-write'
  | 'call-any'
  | 'struct'
  | 'editor-level'
  | 'map-discard'
  | 'delete'
  | 'python'
  | 'save'
  | 'p4-stale'
  | 'perf-capture'
  | 'perf-delete'
  | 'vs-kill'
  | `readonly:${'runtime' | 'asset' | 'struct' | 'delete' | 'python' | 'save'}`

const LABELS: Record<UeGrant, () => string> = {
  'lua-exec': () => t('在 UE 里执行 Lua 代码'),
  'runtime-write': () => t('改正在运行的 UE'),
  'call-any': () => t('调用没有对蓝图开放的函数'),
  struct: () => t('新建 / 复制 / 改名 UE 资源'),
  'editor-level': () => t('改编辑器里打开的关卡'),
  'map-discard': () => t('换地图时丢掉关卡里没保存的改动'),
  delete: () => t('删除 UE 资源'),
  python: () => t('在 UE 编辑器里执行 Python'),
  save: () => t('保存 UE 资源'),
  'p4-stale': () => t('不更新直接改本地版本落后的资源'),
  'perf-capture': () => t('性能抓取（CSV、trace、内存报告）'),
  'perf-delete': () => t('删除性能抓取文件'),
  'vs-kill': () => t('结束 VS 启动的 UE 进程'),
  'readonly:runtime': () => t('越过只读设置改运行中的 UE'),
  'readonly:asset': () => t('越过只读设置改 UE 资源'),
  'readonly:struct': () => t('越过设置新建 / 复制 / 改名资源'),
  'readonly:delete': () => t('越过设置删除资源'),
  'readonly:python': () => t('越过设置执行 Python'),
  'readonly:save': () => t('越过只读设置保存资源'),
}

/** 给确认卡补上规则键和说法 */
export const withGrant = (grant: UeGrant, req: PluginConfirm): PluginConfirm => ({
  ...req,
  rule: grant,
  ruleLabel: LABELS[grant](),
})

/** 危险控制台命令：按命中的那条规则分 */
export const dangerGrant = (hit: string, req: PluginConfirm): PluginConfirm => ({
  ...req,
  rule: `console-danger:${hit}`,
  ruleLabel: t('执行匹配「{rule}」的危险命令', { rule: hit }),
})
