import { allSteps, type GtRef, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { stepKey } from '../gt-flow/layout.ts'

/**
 * 「核对所有对象」要问 gt.resolve 的引用（测试页梳理 F2）：脚本「对象」里的每一项，加上步骤里内联写的引用。
 * 一个引用对应用到它的步骤（画布节点的 key：id 或路径），找不到时这些节点标黄。$变量 是运行时才有的，不核对
 */
export interface ObjCheckPlan {
  refs: { id: string; ref: GtRef }[]
  /** 引用 id → 用到它的步骤 key */
  users: Map<string, string[]>
}

const isRef = (v: unknown): v is GtRef =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { class?: unknown }).class === 'string'

/** 一步指向的对象：obj，或 target 里的 obj（{obj, part}） */
function objOf(s: GtStep): unknown {
  if (s.obj !== undefined) return s.obj
  const tg = s.target
  return tg && typeof tg === 'object' && !Array.isArray(tg) ? (tg as { obj?: unknown }).obj : undefined
}

export function objCheckPlan(doc: GtScript): ObjCheckPlan {
  const objects = (doc.objects ?? {}) as Record<string, unknown>
  const refs: ObjCheckPlan['refs'] = Object.entries(objects)
    .filter(([, v]) => isRef(v))
    .map(([id, v]) => ({ id, ref: v as GtRef }))
  const users = new Map<string, string[]>(refs.map((r) => [r.id, []]))
  for (const e of allSteps(doc)) {
    const o = objOf(e.step)
    const key = stepKey(e.step, e.path)
    if (typeof o === 'string' && users.has(o)) users.get(o)!.push(key)
    else if (isRef(o)) {
      const id = `#${key}`
      refs.push({ id, ref: o })
      users.set(id, [key])
    }
  }
  return { refs, users }
}

/** gt.resolve 的回包 → 找不到的引用 id 和对应的步骤 key */
export function objCheckResult(plan: ObjCheckPlan, res: { id?: string; count?: number; error?: string }[]) {
  const missing = res.filter((r) => r.id && (r.error || !r.count)).map((r) => r.id!)
  const steps = new Set(missing.flatMap((id) => plan.users.get(id) ?? []))
  return { found: res.length - missing.length, missing, steps }
}
