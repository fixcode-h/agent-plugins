import { op, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useTargetInfo } from '../../ui.tsx'
import { useExtEvents } from '../uekit/ListCol.tsx'

/** UELink 2.4 的 lua.modules / lua.errors 回包（UEKit docs/protocol.md） */
export interface LuaModule {
  name: string
  file?: string
  objects: number
  loadedAt?: string
  loadedAtGuess?: boolean
  modifiedAt?: string
  stale: boolean
}
export interface ModulesRes {
  items: LuaModule[]
  total: number
  stale: number
  root: string
  reloader?: boolean
}
export interface LuaError {
  id: string
  message: string
  where?: string
  count: number
  first: string
  last: string
  stack: string[]
  locals?: { name: string; t: string; v?: unknown; n?: number; obj?: string }[]
  source: 'capture' | 'log'
  seq: number
}
export interface ErrorsRes {
  items: LuaError[]
  seq: number
  total: number
}

/** 目标进程认不认某个 2.4 的 Lua 操作（旧 UELink 不认：对应页签、按钮整块不出现） */
export function useLuaOp(name: string) {
  const { inst } = useTargetInfo()
  return !!inst?.lua && !!inst.ops?.includes(name)
}

/** 模块表：重载后、报错页里「重载」后都调 reload */
export function useModules() {
  const { project, target } = useUe()
  const ok = useLuaOp('lua.modules')
  const res = useLoad(
    () => (ok ? op<ModulesRes>(project.id, 'lua.modules', { limit: 2000 }, target) : Promise.resolve(undefined)),
    [project.id, target.instance, target.world, ok],
    0,
    `${project.id}/lua/modules`,
  )
  return { ...res, ok }
}

/**
 * 归并后的 Lua 报错：先读一次，UELink 推 uelink.luaErrors 时重读（游戏进程没有推送通道，点「刷新」），不轮询
 */
export function useLuaErrors() {
  const { project, target } = useUe()
  const ok = useLuaOp('lua.errors')
  const res = useLoad(
    () => (ok ? op<ErrorsRes>(project.id, 'lua.errors', { limit: 200 }, target) : Promise.resolve(undefined)),
    [project.id, target.instance, target.world, ok],
    0,
    `${project.id}/lua/errors`,
  )
  useExtEvents(project.id, (e) => {
    if (e.event === 'uelink.luaErrors' && ok) void res.reload()
  })
  return { ...res, ok }
}

/** 用系统默认程序打开 .lua（服务端 lua/api.ts）；位置是相对脚本根目录的时候带上 root */
export function useOpenLua() {
  const { project } = useUe()
  const { toast } = h()
  return (file: string, root?: string) =>
    void ppost(project.id, 'lua/file', { file, root, action: 'open' }).catch((e: Error) => toast.error(e.message))
}

/** 报错位置「UI/BagPanel.lua:88」拆成文件和行 */
export function splitWhere(where?: string) {
  const m = /^(.*\.lua):(\d+)$/.exec(where ?? '')
  return m ? { file: m[1], line: Number(m[2]) } : undefined
}

/** ISO 时间 → 本地时:分:秒 */
export const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString() : '')

export const sourceLabel = (s: string) => (s === 'capture' ? t('项目上报') : t('日志'))
