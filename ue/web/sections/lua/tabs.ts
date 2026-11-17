import type { ComponentType } from 'react'
import { t } from '../../host.ts'
import { LuaBuild } from './Build.tsx'
import { LuaBuildHead } from './BuildParts.tsx'
import { useBuildBadge } from './build-store.ts'
import { LuaDebug } from './Debug.tsx'
import { LuaErrors, useErrorsBadge } from './Errors.tsx'
import { LuaExec } from './Exec.tsx'
import { CheckSyntax, ReloadChanged } from './HeadActions.tsx'
import { LuaModules } from './Modules.tsx'
import { LuaObjects } from './Objects.tsx'

/**
 * Lua 页的页签登记（设计稿 designs/UE插件优化与扩展-设计稿.md 第四节）：最终是 对象 / GM / 模块 / 报错 / 编译 / 执行。
 * 各页签由不同的工作包做，每个包只在这里加一行，组件放 sections/lua/ 下自己的文件，免得几个人同时改 LuaPage。
 * 还没做的页签不登记（不显示空页签）。order 决定顺序，留空号给后加的
 */
export interface LuaTab {
  id: string
  order: number
  label: () => string
  View: ComponentType
  /** 页签上的数字（报错数、GM 条数），没有返回 undefined；tone=danger 时页签上加提示点，hint 是悬停文字 */
  useBadge?: () => { text: string; tone?: 'danger'; hint?: string } | undefined
  /** 不需要 UE 在运行（GM 扫描、编译只读本机文件；执行页的片段存在本机，执行按钮自己判断） */
  offline?: boolean
}

export const LUA_TABS: LuaTab[] = [
  { id: 'objects', order: 10, label: () => t('对象'), View: LuaObjects },
  // order 20 GM
  { id: 'modules', order: 30, label: () => t('模块'), View: LuaModules },
  { id: 'errors', order: 40, label: () => t('报错'), View: LuaErrors, useBadge: useErrorsBadge },
  { id: 'build', order: 50, label: () => t('编译'), View: LuaBuild, useBadge: useBuildBadge, offline: true },
  // 快照点、持有的已销毁对象（设计稿四.4，要 UELink 2.4），性能采样换成去性能页录含 Lua 的 trace 的入口
  { id: 'debug', order: 55, label: () => t('调试'), View: LuaDebug },
  // 片段存在本机：UE 没运行时也能看、能改，只是不能执行
  { id: 'exec', order: 60, label: () => t('执行'), View: LuaExec, offline: true },
].sort((a, b) => a.order - b.order)

/**
 * 页头右边的按钮（检查语法、增量编译、全编译、重载改过的模块）：各工作包做好了在这里加一个组件。
 * 组件自己判断能不能用（例如桥接没有 lua.reload 时不显示），不能用时返回 null
 */
export const LUA_HEAD_ACTIONS: { id: string; order: number; View: ComponentType }[] = [
  { id: 'check', order: 10, View: CheckSyntax },
  // 20 增量编译、30 全编译（一个组件出两个按钮）
  { id: 'build', order: 20, View: LuaBuildHead },
  { id: 'reload', order: 40, View: ReloadChanged },
].sort((a, b) => a.order - b.order)
