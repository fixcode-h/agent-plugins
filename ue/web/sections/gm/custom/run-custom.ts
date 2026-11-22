import { callStep, getQuery, invokesOf, stepOk, type InvokeReport } from '../../../../shared/gm/custom.ts'
import type { GmCustom } from '../../../../shared/gm/schema.ts'
import type { Target } from '../../../../server/types.ts'
import { op } from '../../../api.ts'

/**
 * 调一次对象函数 / 取一次对象（GM 页的自定义 GM、对象调用工作台共用）。拼参数用 shared/gm/custom.ts，和 ue_gm 同一份；
 * 成功与否只看 gt.step 的 ok / status，返回值看 payload.invoke（规格第 7 节）；出错原样显示，不重试
 */
export interface CallOut {
  ok: boolean
  error?: string
  /** obj.call 的报告（each 时每个对象一条） */
  invoke: InvokeReport[]
  /** 取对象：命中的每个实例和属性此刻的值 */
  found?: { count: number; items: FoundItem[] }
  ms: number
  at: string
}

/** 取对象命中的一个实例：match=false 是同类但匹配规则没对上的（gt.resolve 一起回来，给「排除：因为哪条」用） */
export interface FoundItem {
  name: string
  path?: string
  match?: boolean
  ident?: { prop: string; actual: unknown }[]
}

type Def = Pick<GmCustom, 'kind' | 'obj' | 'objects' | 'function' | 'part' | 'args' | 'many' | 'props'>

export async function runCall(
  projectId: string,
  def: Def,
  args: Record<string, unknown>,
  target?: Target,
): Promise<CallOut> {
  const t0 = Date.now()
  const at = new Date().toISOString()
  try {
    if (def.kind === 'get') {
      const r = await op<{ refs?: { count?: number; candidates?: FoundItem[]; error?: string }[] }>(
        projectId,
        'gt.resolve',
        getQuery(def),
        target,
      )
      const it = r.refs?.[0]
      if (it?.error) return { ok: false, error: it.error, invoke: [], ms: Date.now() - t0, at }
      return {
        ok: true,
        invoke: [],
        found: { count: it?.count ?? 0, items: it?.candidates ?? [] },
        ms: Date.now() - t0,
        at,
      }
    }
    const { step, objects } = callStep(def, args)
    const r = await op<Record<string, unknown>>(projectId, 'gt.step', { step, objects }, target, 60000)
    const invoke = invokesOf(r)
    if (!stepOk(r)) return { ok: false, error: String(r.message || r.status || ''), invoke, ms: Date.now() - t0, at }
    return { ok: true, invoke, ms: Date.now() - t0, at }
  } catch (e) {
    return { ok: false, error: (e as Error).message, invoke: [], ms: Date.now() - t0, at }
  }
}

/** 一次调用的一行摘要（最近执行、输出头一行） */
export function outLine(o: CallOut) {
  if (!o.ok) return o.error ?? ''
  if (o.found) return `${o.found.count}`
  const rets = o.invoke.map((x) => (typeof x.returned === 'string' ? x.returned : JSON.stringify(x.returned ?? null)))
  return rets.join(', ')
}

/** 表单里改过的值按存的值的类型转回去（自定义 GM 不存参数类型：存的是数字就还给数字） */
export function coerceLike(orig: unknown, v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (typeof orig === 'number' && s !== '' && !isNaN(Number(s))) return Number(s)
  if (typeof orig === 'boolean') return s === 'true'
  if (orig && typeof orig === 'object' && /^[[{]/.test(s)) {
    try {
      return JSON.parse(s)
    } catch {
      // 不是 JSON：原样交给 UE，由它报类型不对
    }
  }
  return v
}

/** 这次执行实际要改的参数：只挑 editable 里、和存的不一样的 */
export function overrides(c: Pick<GmCustom, 'args' | 'editable'>, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of c.editable)
    if (k in values) {
      const v = coerceLike(c.args[k], values[k])
      if (JSON.stringify(v) !== JSON.stringify(c.args[k])) out[k] = v
    }
  return out
}
