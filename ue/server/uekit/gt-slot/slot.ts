import { getAt, parsePath } from '../../../shared/gt-script/index.ts'
import { BridgeError } from '../../instances.ts'
import { t } from '../../util.ts'

/**
 * 场景详情页的逐步工具改的不只是顶层的步骤：录完装成录制段（GameTest 1.10.0 group）后，步骤在 steps.N.do 里。
 * 请求里的 slot 是所在槽（数组）的路径（`steps`、`steps.1.do`），path 是一步的完整路径（`steps.1.do.3`）；
 * 都没给时按顶层 steps，旧网页的请求照旧能用
 */

/** 取一个槽（数组）：路径不指向数组时报错，不沿路建（只改已有的步骤） */
export function slotOf(doc: Record<string, unknown>, slot: unknown): Record<string, unknown>[] {
  const s = typeof slot === 'string' && slot ? slot : 'steps'
  const p = parsePath(s)
  const arr = getAt(doc, p)
  if (p[0] !== 'steps' || !Array.isArray(arr))
    throw new BridgeError(t('场景里找不到这一段步骤（{s}）：文件可能刚被改过，刷新后再试', { s }))
  return arr as Record<string, unknown>[]
}

/** 一步的完整路径 → 所在槽和序号；给的是顶层序号 index 时当 steps.index */
export function placeOfEdit(e: { path?: unknown; index?: unknown }): { slot: string; index: number } {
  if (typeof e.path === 'string' && e.path) {
    const p = parsePath(e.path)
    const last = p[p.length - 1]
    if (typeof last !== 'number') throw new BridgeError(t('步骤路径不对：{p}', { p: e.path }))
    return { slot: p.slice(0, -1).join('.'), index: last }
  }
  return { slot: 'steps', index: Number(e.index) }
}

/** 深拷贝一份再改：同一份 doc 里几处槽一起改时，失败了不留半截 */
export const cloneDoc = (doc: Record<string, unknown>) => structuredClone(doc)
