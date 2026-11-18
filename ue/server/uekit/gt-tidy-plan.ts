/**
 * GameTest「AI 整理」的整理方案（AI 分析对话回复里的 ```gametest-tidy 代码块）：以原步骤为基准的改动列表，
 * 每条能单独勾选（用户 2026-11-17：优化要用户确认，在分析对话右侧的应用面板里应用）。
 * 纯计算，网页（预览差异）和服务端（写回场景）共用同一份，不 import node 模块。
 *
 * {
 *   "kind": "gametest-tidy",
 *   "scenario": { "root": 场景根绝对路径, "path": 相对场景根, "hash": 出题时场景文件的 sha1 },
 *   "summary": "一句话",
 *   "review": [{ "step": 3, "level": "warn", "text": "按代码看……" }],   只提示，不应用
 *   "changes": [
 *     { "what": "为什么", "op": "delete", "steps": [4, 5] },
 *     { "what": "…", "op": "replace", "steps": [7, 8], "with": [ {新步骤…} ] },
 *     { "what": "…", "op": "insert", "after": 3, "with": [ {新步骤…} ] },        after=0 插在最前面
 *     { "what": "…", "op": "edit", "step": 6, "set": { "timeoutMs": 5000, "via": null } }   null 是删掉这个字段
 *   ],
 *   "notes": { "1": "打开商店", "2": "…" }   每步说明，写进原步骤的 note
 * }
 * 步骤号都从 1 数、指原场景。一步只能被一条改动碰（删除 / 替换 / 改字段），互相打架的整份退回让 Agent 改。
 * 「整理成流程」另有 wrap（包成循环 / 如果 / 段）、guard（改成守护）、param（提成参数）三种，见 gt-tidy-flow.ts。
 */
import { applyFlowOp, FLOW_OPS, parseFlowOp, type FlowOp } from './gt-tidy-flow.ts'

export const TIDY_LANG = 'gametest-tidy'

type Step = Record<string, unknown>

export type TidyOp =
  | { what: string; op: 'delete'; steps: number[] }
  | { what: string; op: 'replace'; steps: number[]; with: Step[] }
  | { what: string; op: 'insert'; after: number; with: Step[] }
  | { what: string; op: 'edit'; step: number; set: Record<string, unknown> }
  | FlowOp

export interface TidyReview {
  step?: number
  level: 'warn' | 'info'
  text: string
}

export interface TidyPlan {
  scenario: { root: string; path: string; hash?: string }
  summary: string
  review: TidyReview[]
  changes: TidyOp[]
  notes: Record<number, string>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStepNo = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max

/** 新步骤：要有 action；新步骤里的 note 照写 */
function newSteps(v: unknown, where: string): Step[] {
  if (!Array.isArray(v) || !v.length) throw new Error(`${where}：with 要是非空的步骤数组`)
  return v.map((s, i) => {
    if (!isObj(s) || typeof s.action !== 'string' || !s.action)
      throw new Error(`${where}：with 第 ${i + 1} 项没有 action`)
    return s
  })
}

/**
 * 校验整理方案（steps 是原场景的步数）：形状不对、步骤号越界、两条改动碰同一步都抛错，
 * 错误写给 Agent 看（AI 分析对话会把它交回去让 Agent 自己改一次）。发给 Agent 的话不翻译
 */
type TouchKind = 'gone' | 'move' | 'edit'

export function parseTidyPlan(raw: unknown, steps: number): TidyPlan {
  if (!isObj(raw)) throw new Error('gametest-tidy 代码块要是一个 JSON 对象')
  const sc = raw.scenario
  if (!isObj(sc) || typeof sc.root !== 'string' || typeof sc.path !== 'string')
    throw new Error('缺 scenario.root / scenario.path：照提示词里给的原样抄回来')
  // 一步只能被一条改动「拿走」（delete / replace）或「搬走」（wrap / guard），也只能被一条 edit 改；
  // edit 和 wrap / guard 可以叠加：先改字段再整步搬进块或守护里
  const touched = new Map<number, { ci: number; kind: TouchKind }[]>()
  const touch = (n: number, ci: number, kind: TouchKind) => {
    const prev = (touched.get(n) ?? []).find((p) => p.kind === kind || p.kind === 'gone' || kind === 'gone')
    if (prev) throw new Error(`第 ${prev.ci + 1} 条和第 ${ci + 1} 条改动都改了原第 ${n} 步：合成一条`)
    touched.set(n, [...(touched.get(n) ?? []), { ci, kind }])
  }
  const changes: TidyOp[] = []
  const list = Array.isArray(raw.changes) ? raw.changes : []
  list.forEach((c, ci) => {
    const where = `changes 第 ${ci + 1} 条`
    if (!isObj(c)) throw new Error(`${where} 不是对象`)
    const what = typeof c.what === 'string' ? c.what.trim() : ''
    if (!what) throw new Error(`${where} 缺 what（为什么这样改）`)
    const nums = (v: unknown) => {
      if (!Array.isArray(v) || !v.length || !v.every((n) => isStepNo(n, steps)))
        throw new Error(`${where}：steps 要是 1–${steps} 之间的步骤号数组`)
      return [...new Set(v as number[])].sort((a, b) => a - b)
    }
    if (c.op === 'delete') {
      const s = nums(c.steps)
      s.forEach((n) => touch(n, ci, 'gone'))
      changes.push({ what, op: 'delete', steps: s })
    } else if (c.op === 'replace') {
      const s = nums(c.steps)
      s.forEach((n) => touch(n, ci, 'gone'))
      changes.push({ what, op: 'replace', steps: s, with: newSteps(c.with, where) })
    } else if (c.op === 'insert') {
      if (!(c.after === 0 || isStepNo(c.after, steps))) throw new Error(`${where}：after 要是 0–${steps}`)
      changes.push({ what, op: 'insert', after: c.after as number, with: newSteps(c.with, where) })
    } else if (c.op === 'edit') {
      if (!isStepNo(c.step, steps)) throw new Error(`${where}：step 要是 1–${steps}`)
      if (!isObj(c.set) || !Object.keys(c.set).length) throw new Error(`${where}：set 要写改哪些字段`)
      if ('action' in c.set) throw new Error(`${where}：换动作用 replace，不用 edit`)
      touch(c.step, ci, 'edit')
      changes.push({ what, op: 'edit', step: c.step, set: c.set })
    } else if (typeof c.op === 'string' && FLOW_OPS.has(c.op))
      changes.push(parseFlowOp(c, what, { where, nums, touch: (n) => touch(n, ci, 'move'), isStepNo: (n): n is number => isStepNo(n, steps) }))
    else throw new Error(`${where}：op 只能是 delete / replace / insert / edit / wrap / guard / param`)
  })
  const notes: Record<number, string> = {}
  if (isObj(raw.notes))
    for (const [k, v] of Object.entries(raw.notes)) {
      const n = Number(k)
      if (isStepNo(n, steps) && typeof v === 'string' && v.trim()) notes[n] = v.trim()
    }
  const review: TidyReview[] = (Array.isArray(raw.review) ? raw.review : []).filter(isObj).flatMap((r) =>
    typeof r.text === 'string' && r.text.trim()
      ? [
          {
            ...(isStepNo(r.step, steps) ? { step: r.step } : {}),
            level: r.level === 'info' ? ('info' as const) : ('warn' as const),
            text: r.text.trim(),
          },
        ]
      : [],
  )
  if (!changes.length && !Object.keys(notes).length && !review.length)
    throw new Error('changes、notes、review 都是空的：至少给出一项，或者说明为什么不用改')
  return {
    scenario: { root: sc.root, path: sc.path, ...(typeof sc.hash === 'string' ? { hash: sc.hash } : {}) },
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    review,
    changes,
    notes,
  }
}

/** 应用后的整份结果：新的步骤，加上「整理成流程」带出的守护、全局守护和参数 */
export interface TidyResult {
  steps: Step[]
  guards: Step[]
  globalGuards: Step[]
  params: Record<string, Step>
  /** 用到了 v3 的写法（块、守护、参数）：写回时 schemaVersion 要升到 3 */
  v3: boolean
}

/** 应用勾上的改动（下标是 plan.changes 的位置）和说明；原步骤不改 */
export function applyTidyDoc(original: Step[], plan: TidyPlan, picked: Iterable<number>, withNotes: boolean): TidyResult {
  const on = new Set(picked)
  const removed = new Set<number>()
  const replaceAt = new Map<number, Step[]>()
  const edits = new Map<number, Record<string, unknown>>()
  const inserts = new Map<number, Step[]>()
  const materialize = (n: number): Step => {
    const next: Step = { ...original[n - 1] }
    for (const [k, v] of Object.entries(edits.get(n) ?? {})) {
      if (v === null) delete next[k]
      else next[k] = v
    }
    if (withNotes && plan.notes[n]) next.note = plan.notes[n]
    return next
  }
  const flow = { removed, replaceAt, edits, materialize, guards: [] as Step[], globalGuards: [] as Step[], params: {} }
  // 先记下改字段（含参数），再做包块和守护：包进块里的步骤要带上这些改动
  const ordered = plan.changes
    .map((c, i) => ({ c, i }))
    .filter((x) => on.has(x.i))
    .sort((a, b) => Number(a.c.op === 'wrap' || a.c.op === 'guard') - Number(b.c.op === 'wrap' || b.c.op === 'guard'))
  let v3 = false
  for (const { c } of ordered) {
    if (c.op === 'delete') c.steps.forEach((n) => removed.add(n))
    else if (c.op === 'replace') {
      c.steps.forEach((n) => removed.add(n))
      replaceAt.set(c.steps[0], c.with)
    } else if (c.op === 'insert') inserts.set(c.after, [...(inserts.get(c.after) ?? []), ...c.with])
    else if (c.op === 'edit') edits.set(c.step, { ...(edits.get(c.step) ?? {}), ...c.set })
    else {
      applyFlowOp(c, flow)
      v3 = true
    }
  }
  const out: Step[] = [...(inserts.get(0) ?? [])]
  original.forEach((_, i) => {
    const n = i + 1
    const rep = replaceAt.get(n)
    if (rep) out.push(...rep.map((x) => ({ ...x })))
    if (!removed.has(n)) out.push(materialize(n))
    out.push(...(inserts.get(n) ?? []))
  })
  return { steps: out, guards: flow.guards, globalGuards: flow.globalGuards, params: flow.params, v3 }
}

/** 只要新的步骤列表（差异预览用） */
export function applyTidyPlan(original: Step[], plan: TidyPlan, picked: Iterable<number>, withNotes: boolean): Step[] {
  return applyTidyDoc(original, plan, picked, withNotes).steps
}

/** 从一条回复里取 ```gametest-tidy 代码块（取最后一个：Agent 改过一次时以改后的为准） */
export function tidyBlockOf(text: string): string | undefined {
  const re = /```gametest-tidy[^\n]*\n([\s\S]*?)```/g
  let last: string | undefined
  for (let m = re.exec(text); m; m = re.exec(text)) last = m[1]
  return last
}
