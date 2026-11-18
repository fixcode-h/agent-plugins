/**
 * 「整理成流程」（定稿 9.7）在整理方案里加的三种改动，和 gt-tidy-plan.ts 的 delete / replace / insert / edit 同一套勾选、同一次写回：
 *
 *   { "what": "…", "op": "wrap", "steps": [3, 4, 5], "block": { "action": "loop", "until": {…}, "max": 30 } }
 *       连续几步包成块：loop / group 放进 do，if 放进 then；原步骤（连同 id、说明）原样搬进去，不复制不改写
 *   { "what": "…", "op": "guard", "steps": [7, 8], "guard": { "name": "关公告", "when": {…}, "do"?: […] }, "global"?: true }
 *       中途弹出又被关掉的界面：这几步从主流程拿掉，变成守护（do 不写就用这几步）；global 时写进场景根 _settings.json 的全局守护
 *   { "what": "…", "op": "param", "name": "account", "default": "qa_01", "note"?: "…", "uses": [ { "step": 2, "field": "text" } ] }
 *       录到的固定值提成脚本参数：这些步骤的字段改成 $account，顶层 params 加一项
 *
 * 纯计算，网页（预览）和服务端（写回）共用，不 import node 模块。发给 Agent 的报错不翻译。
 */
type Step = Record<string, unknown>

export type FlowOp =
  | { what: string; op: 'wrap'; steps: number[]; block: Step }
  | { what: string; op: 'guard'; steps: number[]; guard: Step; global?: boolean }
  | {
      what: string
      op: 'param'
      name: string
      default: unknown
      note?: string
      uses: { step: number; field: string }[]
    }

export const FLOW_OPS = new Set(['wrap', 'guard', 'param'])

/** 能包的块和放子步骤的槽；其余块（call、invoke…）没有子步骤，不能包 */
const WRAP_SLOT: Record<string, string> = { loop: 'do', group: 'do', if: 'then' }

const isObj = (v: unknown): v is Step => !!v && typeof v === 'object' && !Array.isArray(v)

interface ParseCtx {
  where: string
  /** 校验步骤号数组并去重排序 */
  nums: (v: unknown) => number[]
  /** 登记这条改动碰了哪一步（两条改动碰同一步时抛错；param 不登记） */
  touch: (n: number) => void
  isStepNo: (n: unknown) => n is number
}

export function parseFlowOp(c: Step, what: string, x: ParseCtx): FlowOp {
  const { where } = x
  if (c.op === 'wrap') {
    const steps = x.nums(c.steps)
    if (steps.some((n, i) => i > 0 && n !== steps[i - 1] + 1)) throw new Error(`${where}：wrap 的 steps 要是连续的几步`)
    const block = c.block
    if (!isObj(block) || typeof block.action !== 'string' || !WRAP_SLOT[block.action])
      throw new Error(`${where}：block.action 只能是 loop / group / if`)
    const slot = WRAP_SLOT[block.action]
    if (slot in block) throw new Error(`${where}：block 里不要写 ${slot}，包进去的就是 steps 那几步`)
    if (block.action === 'loop' && block.times === undefined && block.max === undefined)
      throw new Error(`${where}：loop 要写 max（最多几轮）`)
    if (block.action === 'if' && !block.cond) throw new Error(`${where}：if 要写 cond`)
    steps.forEach(x.touch)
    return { what, op: 'wrap', steps, block }
  }
  if (c.op === 'guard') {
    const steps = x.nums(c.steps)
    const g = c.guard
    if (!isObj(g) || !g.when) throw new Error(`${where}：guard 要写 when（统一条件）`)
    if (g.do !== undefined && (!Array.isArray(g.do) || !g.do.length))
      throw new Error(`${where}：guard.do 要是非空步骤数组，或者不写（用 steps 那几步）`)
    steps.forEach(x.touch)
    return { what, op: 'guard', steps, guard: g, ...(c.global === true ? { global: true } : {}) }
  }
  // param
  const name = typeof c.name === 'string' ? c.name.trim() : ''
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error(`${where}：name 要是字母数字下划线的参数名`)
  if (c.default === undefined) throw new Error(`${where}：param 要写 default（录到的那个值）`)
  const uses = Array.isArray(c.uses) ? c.uses : []
  if (!uses.length) throw new Error(`${where}：uses 要列出哪些步骤的哪个字段改成 $${name}`)
  const list = uses.map((u, i) => {
    if (!isObj(u) || !x.isStepNo(u.step) || typeof u.field !== 'string' || !u.field)
      throw new Error(`${where}：uses 第 ${i + 1} 项要写 step（步骤号）和 field（字段名）`)
    return { step: u.step, field: u.field }
  })
  // 参数只改一个字段，不占步骤：同一步还可以被包进循环、改成守护或别的 edit 改别的字段
  return {
    what,
    op: 'param',
    name,
    default: c.default,
    ...(typeof c.note === 'string' && c.note.trim() ? { note: c.note.trim() } : {}),
    uses: list,
  }
}

/** 应用时的公共状态（gt-tidy-plan.ts 的 applyTidyDoc 建好传进来） */
export interface ApplyCtx {
  removed: Set<number>
  replaceAt: Map<number, Step[]>
  edits: Map<number, Record<string, unknown>>
  /** 原第 n 步应用了改字段和说明之后的样子 */
  materialize: (n: number) => Step
  guards: Step[]
  globalGuards: Step[]
  params: Record<string, Step>
}

export function applyFlowOp(c: FlowOp, x: ApplyCtx) {
  if (c.op === 'wrap') {
    const slot = WRAP_SLOT[String(c.block.action)]
    c.steps.forEach((n) => x.removed.add(n))
    x.replaceAt.set(c.steps[0], [{ ...c.block, [slot]: c.steps.map(x.materialize) }])
  } else if (c.op === 'guard') {
    c.steps.forEach((n) => x.removed.add(n))
    const g = { ...c.guard, do: Array.isArray(c.guard.do) ? c.guard.do : c.steps.map(x.materialize) }
    ;(c.global ? x.globalGuards : x.guards).push(g)
  } else {
    for (const u of c.uses) x.edits.set(u.step, { ...(x.edits.get(u.step) ?? {}), [u.field]: `$${c.name}` })
    x.params[c.name] = { default: c.default, ...(c.note ? { note: c.note } : {}) }
  }
}

export function flowOpLabel(c: FlowOp, t: (zh: string, v?: Record<string, string | number>) => string) {
  if (c.op === 'wrap')
    return t('第 {s} 步包成{b}', {
      s: c.steps.join('、'),
      b: c.block.action === 'loop' ? t('循环') : c.block.action === 'if' ? t('如果') : t('段'),
    })
  if (c.op === 'guard')
    return c.global
      ? t('第 {s} 步改成全局守护', { s: c.steps.join('、') })
      : t('第 {s} 步改成守护', { s: c.steps.join('、') })
  return t('提成参数 ${n}（{k} 处）', { n: c.name, k: c.uses.length })
}
