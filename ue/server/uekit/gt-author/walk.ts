import { pathStr, walk, type GtScript } from '../../../shared/gt-script/index.ts'
import type { StepRef } from './checks/types.ts'

/**
 * 把脚本里的每一步（含块里、守护里的）按深度优先摊平，带上路径（steps.3.do.0）。
 * 结构操作（插入、移动、包块）在 shared/gt-script，这里只读。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 遍历用数据层（shared/gt-script）的 walk：子槽由块注册表决定，新加的块不用改这里 */
export function flatSteps(doc: Obj): StepRef[] {
  const out: StepRef[] = []
  walk(doc as GtScript, (e) => {
    out.push({ step: e.step as Obj, path: pathStr(e.path), inGuard: e.inGuard })
  })
  return out
}

/** 一个值里所有的字符串（深度遍历），给找 $变量、表达式、@来源用 */
export function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (isObj(v)) Object.values(v).forEach((x) => strings(x, out))
  return out
}

/** 一步自己的字段（不含子槽里的步骤）：查这一步里的引用时不把块里的步骤算进来 */
export function ownFields(step: Obj): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(step)) if (!['do', 'then', 'else', 'elif', 'guards'].includes(k)) out[k] = v
  if (Array.isArray(step.elif)) out.elif = step.elif.map((e) => (isObj(e) ? { cond: e.cond } : e))
  return out
}
