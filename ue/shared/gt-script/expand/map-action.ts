import type { GtScript, GtStep } from '../types.ts'

/**
 * 把脚本里某一种动作的每一步换掉（存盘、运行前的展开共用：执行 GM、对象调用、脚本函数的函数库）：
 * 主流程、前置、收尾、守护的 do、块里的槽、附带 GM 都找；这种动作自己的 run 是生成的，不往里找。
 * visit 拿到这一步（at 是它的 id，没有 id 时是位置）返回新的一步；什么都没变时返回同一个脚本对象
 */
export function mapAction(doc: GtScript, action: string, visit: (s: GtStep, at: string) => GtStep): GtScript {
  let changed = false
  const walk = (v: unknown, at: string): unknown => {
    if (Array.isArray(v)) {
      const arr = v.map((x, i) => walk(x, `${at}.${i}`))
      return arr.some((x, i) => x !== v[i]) ? arr : v
    }
    if (!v || typeof v !== 'object') return v
    const o = v as Record<string, unknown>
    const mine = o.action === action
    let next: Record<string, unknown> = o
    for (const [k, x] of Object.entries(o)) {
      if (mine && k === 'run') continue
      const y = walk(x, `${at}.${k}`)
      if (y !== x) next = { ...(next === o ? o : next), [k]: y }
    }
    if (!mine) return next
    const out = visit(next as GtStep, typeof o.id === 'string' ? o.id : at)
    if (out !== o) changed = true
    return out
  }
  const out: GtScript = { ...doc }
  for (const k of ['setup', 'steps', 'teardown', 'guards'] as const) {
    if (doc[k] === undefined) continue
    const y = walk(doc[k], k)
    if (y !== doc[k]) {
      out[k] = y as never
      changed = true
    }
  }
  return changed ? out : doc
}

/** 脚本里有没有这种动作（展开前先看一眼，没有的脚本原样放过） */
export const hasAction = (text: string, action: string) => text.includes(`"${action}"`)
