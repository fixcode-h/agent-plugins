/**
 * 「整理成流程」整理哪些步骤（2026-11-18）：录完默认装成一个录制段后，新录的场景顶层只有 [pie.start, 录制段]，
 * 对着顶层整理会把整段当成一步。所以：
 * - 指定了 segment（步骤 id，编辑页录制段节点上的入口）就整理那一段的 do；
 * - 没指定时，顶层除了 pie.start 只有一个录制段（recorded: true 的 group），自动整理这一段；
 * - 其余照旧整理顶层 steps。
 * 方案里的步骤号都从 1 数、指这一组步骤；写回时只换这一段的 do，段外的步骤和段的名字、标记原样保留。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isSegment = (s: unknown): s is Obj => isObj(s) && s.action === 'group' && s.recorded === true

export interface TidyScope {
  steps: Obj[]
  /** 整理的是哪个录制段（步骤 id）；整理顶层时为空 */
  segment?: string
  /** 把整理后的步骤放回去，返回新的 steps（顶层）；不改原对象 */
  put: (steps: Obj[]) => Obj[]
}

/** 在步骤树里按 id 找段：返回从顶层到它的路径（每层是数组下标 + 子槽名） */
function findById(steps: unknown[], id: string): Obj | undefined {
  for (const s of steps) {
    if (!isObj(s)) continue
    if (s.id === id) return s
    for (const v of Object.values(s)) {
      if (Array.isArray(v)) {
        const hit = findById(v, id)
        if (hit) return hit
      }
    }
  }
  return undefined
}

/** 深拷贝一份 steps，把 id 对上的那一步的 do 换掉 */
function replaceDo(steps: unknown[], id: string, next: Obj[]): Obj[] {
  return steps.map((s) => {
    if (!isObj(s)) return s as Obj
    if (s.id === id) return { ...s, do: next }
    const out: Obj = { ...s }
    for (const [k, v] of Object.entries(s)) if (Array.isArray(v)) out[k] = replaceDo(v, id, next)
    return out
  })
}

export function tidyScope(doc: Obj, segment?: string): TidyScope {
  const top = Array.isArray(doc.steps) ? (doc.steps as Obj[]) : []
  let id = segment || undefined
  if (!id) {
    const segs = top.filter(isSegment)
    const others = top.filter((s) => !isSegment(s))
    if (
      segs.length === 1 &&
      others.every((s: unknown) => isObj(s) && s.action === 'pie.start') &&
      typeof segs[0].id === 'string'
    )
      id = segs[0].id
  }
  if (!id) return { steps: top, put: (steps) => steps }
  const seg = findById(top, id)
  if (!seg || !Array.isArray(seg.do)) throw new Error(`场景里没有步骤段 ${id}（可能已经改过）：重新点「整理成流程」`)
  const segId = id
  return { steps: seg.do as Obj[], segment: segId, put: (steps) => replaceDo(top, segId, steps) }
}
