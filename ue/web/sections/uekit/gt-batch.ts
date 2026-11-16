import { op, ppost } from '../../api.ts'
import type { GtBatch } from './GtBatch.tsx'
import type { GtJob } from './GtRun.tsx'
import type { Scenario } from './GtMenus.tsx'

/**
 * GameTest 页的批量运行和历史（GameTest 1.2）：从 GameTest.tsx 拆出来的纯数据部分，页面只管接线。
 */

/** gt.job 事件 → 页面的作业状态：事件不带全部步骤，只带最新一步，接到同一次 run 已有的列表后面 */
export function mergeJobEvent(old: GtJob | undefined, j: GtJob & { lastStep?: GtJob['steps'][number] }): GtJob {
  const steps = old?.runId === j.runId ? [...(old?.steps ?? [])] : []
  if (j.lastStep && !steps.some((s) => s.index === j.lastStep!.index)) steps.push(j.lastStep)
  // 单独跑一个场景时 UE 会清掉上一份批量：事件里没有 batch 就是没有
  return { ...j, steps }
}

/** 批量里已经有结论的场景个数 */
export const batchDone = (b?: GtBatch) =>
  (b?.items ?? []).filter((x) => x.status !== 'pending' && x.status !== 'running').length

/** 场景里出现过的标签和各自的场景数（解析失败的不算），按名字排 */
export function batchTags(scenarios: Scenario[]): [string, number][] {
  const m = new Map<string, number>()
  for (const s of scenarios) if (!s.parseError) for (const tag of s.tags ?? []) m.set(tag, (m.get(tag) ?? 0) + 1)
  return [...m].sort((a, b) => a[0].localeCompare(b[0]))
}

/**
 * 每个场景最近 10 次的通过 / 失败串（gt.history 不带 scenario）。几百个场景超过返回上限时 UE 写成文件只回 file，
 * 这时由面板读文件；旧 GameTest 没有这个操作，返回空的，列表退回只看最近一次
 */
export async function loadHistory(project: string): Promise<Record<string, string>> {
  try {
    const r = await op<{ scenarios?: Record<string, string>; file?: string }>(project, 'gt.history')
    if (r.scenarios) return r.scenarios
    if (r.file) {
      const full =
        (await ppost<{ scenarios?: Record<string, string> }>(project, 'ext/gt/report', { file: r.file })) ?? {}
      return full.scenarios ?? {}
    }
  } catch {
    // 旧版 GameTest 没有 gt.history：不报错，列表照旧
  }
  return {}
}
