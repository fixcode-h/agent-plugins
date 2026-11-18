import { applyKey, condFromCands, keyOf, listIdOf, type StepKey } from './gt-key.ts'
import { placeRows } from './gt-rows/rows.ts'

/**
 * 录完以后「同一列表的其他步骤一起改」（GameTest 1.5.0 那批）：只看场景文件，不用开游戏。
 * 每一步用自己录制时存下的候选（hint.key.cands）拼条件；拼不出（候选里没这个字段）或单个字段在那一步不唯一的跳过，
 * 交给用户一步步看。录制中改的话由 GameTest 当场读值核对（gt.record.key all），比这里准。
 */

export type MatchChoice = { mode: 'key'; fields: string[] } | { mode: 'text' | 'index' }

export interface StepEdit {
  /** 步骤的完整路径（steps.3、录制段里的 steps.1.do.0），ext/gt/file replaceMany 按它改 */
  path: string
  expect: Record<string, unknown>
  step: Record<string, unknown>
}

/** 改一步：target 换前缀，hint.key 跟着改；只按第几个时写 hint.byIndex */
export function editStep(def: Record<string, unknown>, key: StepKey, choice: MatchChoice, cond: string | undefined) {
  const target = typeof def.target === 'string' ? def.target : ''
  const next = applyKey(target, key, cond)
  if (!next) return undefined
  const hint: Record<string, unknown> = { ...((def.hint as Record<string, unknown> | undefined) ?? {}) }
  delete hint.byIndex
  const nextKey: StepKey = { ...key, from: next.from, cond, by: choice.mode === 'key' ? 'user' : choice.mode }
  if (!cond) delete nextKey.cond
  return {
    ...def,
    target: next.target,
    hint: { ...hint, key: nextKey, ...(choice.mode === 'index' ? { byIndex: true } : {}) },
  }
}

/**
 * 同一列表（条目类 + 容器）的其他步骤要怎么改；self 是正在改的那一步的路径。
 * 录制段、如果、循环里的步骤也算（按路径摊开整份场景）；skipped 是跳过的步骤的显示序号（2.3）
 */
export function planListEdits(steps: Record<string, unknown>[], self: string, key: StepKey, choice: MatchChoice) {
  const id = listIdOf(key)
  const edits: StepEdit[] = []
  const skipped: string[] = []
  if (!id) return { edits, skipped }
  for (const row of placeRows(steps)) {
    const { def, key: path, no } = row
    if (path === self) continue
    const hint = def.hint && typeof def.hint === 'object' ? (def.hint as Record<string, unknown>) : undefined
    const k = keyOf(hint)
    if (!k || listIdOf(k) !== id) continue
    let cond: string | undefined
    if (choice.mode === 'key') {
      cond = condFromCands(k, choice.fields)
      // 单个字段要在那一步也唯一（录制时算好的 unique）；组合的没法离线核对，照写，回放认不出会报错并列出现有的值
      const single = choice.fields.length === 1 && (k.cands ?? []).find((c) => !c.combo && c.cond === cond)
      // 那一步这个字段点一下就变（最近用过的列表、数量）：不能当它的标识，留给用户自己看
      const changed = choice.fields.some(
        (f) => (k.cands ?? []).find((c) => !c.combo && c.by.toLowerCase() === f.toLowerCase())?.changed,
      )
      if (!cond || changed || (single && !single.unique)) {
        skipped.push(no)
        continue
      }
    }
    const step = editStep(def, k, choice, cond)
    if (!step) skipped.push(no)
    else edits.push({ path, expect: def, step })
  }
  return { edits, skipped }
}
