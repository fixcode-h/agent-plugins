/**
 * 脚本的三段（执行前 setup / 执行 steps / 执行后 teardown，GameTest 2.8.0）和运行记录的分级：
 * 对话卡片、报告、运行记录共用这一份，不依赖 React，单测直接跑（phases.test.ts）。
 *
 * 用户 2026-11-27 定：三段在每个脚本里都在（空的运行时跳过）；执行前没通过算「前置不满足」不算失败；
 * call 进去的子脚本步骤缩进挂在调用那一步下面，不和主脚本的步骤排在同一级。
 */

import { t } from '../../../host.ts'

export type PhaseKey = 'setup' | 'steps' | 'teardown'
export const PHASE_ORDER: readonly PhaseKey[] = ['setup', 'steps', 'teardown']

/** 段名（界面上的叫法；脚本字段名 setup / steps / teardown 不变） */
export const PHASE_TITLE: Record<PhaseKey, () => string> = {
  setup: () => t('执行前'),
  steps: () => t('执行'),
  teardown: () => t('执行后'),
}

/** 运行记录里分段、分级用到的字段 */
export interface PhaseRecord {
  index?: number
  action?: string
  status: string
  path?: string
  id?: string
  setup?: boolean
  teardown?: boolean
  block?: boolean
  warn?: boolean
  /** 在哪个 call 里跑的：外层到内层每个 call 步骤的 id（GameTest 2.8.0） */
  calls?: string[]
}

export const phaseOf = (r: Pick<PhaseRecord, 'setup' | 'teardown' | 'path'>): PhaseKey =>
  r.setup ? 'setup' : r.teardown || r.path?.startsWith('teardown') ? 'teardown' : 'steps'

/** 一条记录的唯一键：不同段、不同子脚本里的 index / path 会重，合起来才不撞 */
export const recordKey = (r: PhaseRecord) =>
  [phaseOf(r), ...(r.calls ?? []), r.path ?? `#${r.index}`, r.block ? 'block' : ''].join('|')

/** 分级后的一行：step 为空是还没收到记录的调用（子脚本正在跑，调用那一步的记录要等它跑完才有） */
export interface TreeRow<S> {
  step?: S
  /** 调用占位行显示的名字（call 步骤的 id） */
  key: string
  depth: number
}

interface Node<S> {
  step?: S
  key: string
  children: Node<S>[]
}

const isCall = (r: PhaseRecord) => r.block === true && r.action === 'call'
const keyOf = (r: PhaseRecord) => r.id || r.path || `#${r.index}`

/**
 * 按调用层级排：调用那一步在前，子脚本的步骤缩进跟在下面（记录里调用那一步是子脚本跑完才记的，排在子步骤后面，这里挪到前面）。
 * 同一个调用跑了几次（循环里）各自成组：调用记录到了就把这一组收口，下一次的子步骤另起一个占位
 */
export function callTree<S extends PhaseRecord>(records: S[]): TreeRow<S>[] {
  const root: Node<S> = { key: '', children: [] }
  // 还开着（调用记录没到）的调用：链路 → 节点
  const open = new Map<string, Node<S>>()
  const ensure = (chain: string[]): Node<S> => {
    let parent = root
    for (let i = 0; i < chain.length; i++) {
      const id = chain.slice(0, i + 1).join('\u0001')
      let n = open.get(id)
      if (!n) {
        n = { key: chain[i], children: [] }
        parent.children.push(n)
        open.set(id, n)
      }
      parent = n
    }
    return parent
  }
  for (const r of records) {
    const chain = r.calls ?? []
    const parent = ensure(chain)
    if (isCall(r)) {
      const id = [...chain, keyOf(r)].join('\u0001')
      const n = open.get(id)
      if (n) {
        n.step = r
        open.delete(id)
        // 收口：它下面还开着的（理论上没有）一起关掉
        for (const k of [...open.keys()]) if (k.startsWith(id + '\u0001')) open.delete(k)
      } else parent.children.push({ step: r, key: keyOf(r), children: [] })
      continue
    }
    parent.children.push({ step: r, key: keyOf(r), children: [] })
  }
  const out: TreeRow<S>[] = []
  const walk = (n: Node<S>, depth: number) => {
    for (const c of n.children) {
      out.push({ step: c.step, key: c.key, depth })
      walk(c, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

export type PhaseState = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'warned' | 'empty' | 'skipped'

export interface PhaseGroup<S> {
  phase: PhaseKey
  rows: TreeRow<S>[]
  /** 这段顶层做了几步 / 共几步（gt.job 的 phases；旧 GameTest 没有时按记录数） */
  done: number
  total?: number
  state: PhaseState
}

export interface PhaseCounts {
  phase?: string
  phases?: Partial<Record<PhaseKey, { done: number; total: number }>>
  /** 没有 phases 时（看报告）每段共几步：按脚本各段的步数，没跑的段也能写出几步没跑 */
  totals?: Partial<Record<PhaseKey, number>>
}

const bad = (r: PhaseRecord) => r.status === 'failed' && !r.warn

/** 这次运行的结论：执行前有失败就是前置不满足（GameTest 2.8.0 报告的 outcome；旧版按记录推） */
export function outcomeOf(records: PhaseRecord[]): 'passed' | 'failed' | 'blocked' {
  const first = records.find(bad)
  if (first) return phaseOf(first) === 'setup' ? 'blocked' : 'failed'
  return records.some((r) => r.status === 'skipped' && phaseOf(r) !== 'teardown') ? 'failed' : 'passed'
}

/**
 * 三段各一组（空的段也给，界面显示「没有步骤，跳过」）。live：还在跑；job 给了 phase / phases 时按它定进度和当前段
 */
export function groupPhases<S extends PhaseRecord>(records: S[], o: PhaseCounts & { live: boolean }): PhaseGroup<S>[] {
  const outcome = outcomeOf(records)
  const current = o.live ? currentPhase(records, o) : undefined
  return PHASE_ORDER.map((phase, i) => {
    const mine = records.filter((r) => phaseOf(r) === phase)
    const count = o.phases?.[phase]
    const top = new Set(mine.filter((r) => !r.calls?.length && !/\.\w+\.\d+/.test(r.path ?? '')).map(recordKey))
    const done = count?.done ?? top.size
    const total = count?.total ?? o.totals?.[phase]
    let state: PhaseState
    if (total === 0) state = 'empty'
    else if (current === phase) state = 'running'
    else if (current && PHASE_ORDER.indexOf(current) < i) state = 'pending'
    else if (mine.some(bad)) state = phase === 'setup' ? 'blocked' : 'failed'
    else if (!mine.length)
      state = !o.live && outcome === 'blocked' && phase === 'steps' ? 'skipped' : o.live ? 'pending' : 'empty'
    else if (mine.every((r) => r.status === 'skipped')) state = 'skipped'
    else if (mine.some((r) => r.warn)) state = 'warned'
    else state = 'passed'
    return { phase, rows: callTree(mine), done, total, state }
  })
}

/** 正在跑哪段：job 给了就用；否则按最后一条记录，一条都没有时是第一个有步骤的段 */
function currentPhase(records: PhaseRecord[], o: PhaseCounts): PhaseKey {
  if (o.phase && (PHASE_ORDER as readonly string[]).includes(o.phase)) return o.phase as PhaseKey
  const last = records[records.length - 1]
  if (last) return phaseOf(last)
  return PHASE_ORDER.find((p) => (o.phases?.[p]?.total ?? 1) > 0) ?? 'steps'
}
