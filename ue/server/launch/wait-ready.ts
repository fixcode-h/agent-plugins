import { busyFromLog } from '../busy/activity.ts'
import { lastLogOf } from '../busy/state.ts'
import { cardReady, liveCards } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { editorStartingWhy } from './bg-guard.ts'
import { launchProgress } from './track.ts'

/**
 * Agent 等编辑器可用（ue_editor action=wait_ready）：以前 Agent 启动编辑器（面板启动或 VS 里 F5）后只能干等一段时间，
 * 等短了调用卡住、等长了白耗时间（用户 2026-11-17）。现在看 UELink 名片：
 * - 编辑器名片 ready: true（UELink 2.7 起）→ 就绪；旧 UELink 没有 ready 字段，名片出现就算
 * - 名片还没有、或 ready: false → 接着等；进程活着就不算失败，卡在加载里一会儿很常见
 * 读的是本机文件（名片），每秒看一次，不连 UE。最多等 timeoutMs，到点返回现在卡在哪，Agent 可以再等
 */
export const WAIT_READY_MAX_MS = 600_000
const WAIT_READY_DEFAULT_MS = 180_000

export interface ReadyResult {
  ready: boolean
  pid?: number
  readyAt?: string
  /** 等了多少秒 */
  waited: number
  /** 没就绪时：还卡在哪（notRunning 没有编辑器在启动 / starting 名片还没出来 / loading 名片出来了在加载） */
  state?: 'notRunning' | 'starting' | 'loading'
  /** 面板启动时的阶段、或日志尾部认出的在忙什么 */
  detail?: string
  hint?: string
}

export async function waitEditorReady(p: UeProject, timeoutMs = WAIT_READY_DEFAULT_MS, signal?: AbortSignal) {
  const ms = Math.min(Math.max(Number(timeoutMs) || WAIT_READY_DEFAULT_MS, 1000), WAIT_READY_MAX_MS)
  const begin = Date.now()
  const waited = () => Math.round((Date.now() - begin) / 1000)
  // 查「有没有在启动」要问 VS、列进程，不便宜：5 秒查一次
  let nextStartCheck = begin + 20_000
  for (;;) {
    const card = (await liveCards(p.root)).find((x) => x.kind === 'editor')
    if (card && cardReady(card))
      return { ready: true, pid: card.pid, readyAt: card.readyAt, waited: waited() } as ReadyResult
    const lp = launchProgress(p.id)
    if (lp?.status === 'failed')
      return { ready: false, state: 'notRunning', detail: lp.error, waited: waited() } as ReadyResult
    // 没有名片、也看不到在启动（面板没在跟、VS 没在启动或编译、系统里没有这个项目的编辑器进程）：
    // 头 20 秒照样等（刚按 F5 时 VS 的状态可能还没变），之后说没在启动，不让 Agent 白等到超时
    let idle = false
    if (!card && Date.now() >= nextStartCheck) {
      nextStartCheck = Date.now() + 5000
      idle = !(await editorStartingWhy(p).catch(() => 'unknown'))
    }
    if (idle)
      return {
        ready: false,
        state: 'notRunning',
        waited: waited(),
        hint: '没有编辑器在启动：用 ue_editor action=start_editor 启动，或在 VS 里 start；VS 还在编译时等编译完再 wait_ready',
      } as ReadyResult
    if (Date.now() - begin >= ms || signal?.aborted) {
      const log = card ? lastLogOf(card.pid) : undefined
      const busy = log ? await busyFromLog(log).catch(() => undefined) : undefined
      return {
        ready: false,
        pid: card?.pid,
        state: card ? 'loading' : 'starting',
        detail: lp ? `${lp.stage} ${lp.percent}%` : busy?.line,
        waited: waited(),
        hint: '编辑器还在启动（进程活着，没有失败）：再调一次 wait_ready 接着等',
      } as ReadyResult
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}
