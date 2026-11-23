import { closeBackground } from '../editor.ts'
import { liveCards } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { alive, run, t } from '../util.ts'
import { checkReused } from './proc-start.ts'

/**
 * 关掉一个 UE 进程（目标下拉、目标小块右键「关闭编辑器」，用户 2026-11-20）。
 *
 * 先优雅退出：Windows 上 taskkill 不带 /F 是给它的窗口发关闭消息，和点窗口右上角的叉一样，
 * 有没保存的改动 UE 会弹窗问要不要保存；等一会儿还没退就告诉网页，让人决定去编辑器里点还是强制结束。
 * 强制结束用 taskkill /T /F（连 Live Coding 控制台这类子进程一起），没保存的改动会丢，网页上先确认过。
 * 只结束这个项目名片上的 PID，而且先核对 PID 没被别的进程顶替（proc-start.ts），免得结束不相干的程序。
 * 不做成 Agent 工具：Agent 要关后台编辑器有 ue_editor background_stop，关用户开着的编辑器得人来点
 */
export interface CloseResult {
  /** 进程已经退出 */
  closed: boolean
  /** 名片是失效的旧名片（PID 被别的进程用了）：只清了名片，没有结束任何进程 */
  stale?: boolean
  /** 没退出的原因（优雅退出时在等保存弹窗或卡住了），网页据此提示能不能强制结束 */
  reason?: string
}

const GRACE_MS = 10000
const FORCE_MS = 15000

async function waitExit(pid: number, ms: number) {
  const until = Date.now() + ms
  while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 300))
  return !alive(pid)
}

export async function closeInstance(p: UeProject, pid: number, force: boolean): Promise<CloseResult> {
  const card = (await liveCards(p.root)).find((c) => c.pid === pid)
  if (!card) return { closed: true }
  if (await checkReused(card.pid, card.startedAt)) {
    // 下一次 liveCards 会把这张名片删掉（knownReused），这里不碰进程
    await liveCards(p.root)
    return { closed: true, stale: true }
  }
  // 后台编辑器正常关走 closeBackground（顺带取消启动中的那次）；强制结束和前台一样走下面的 taskkill /F
  if (card.kind === 'background' && !force) {
    await closeBackground(p, 'user')
    return alive(pid) ? { closed: false, reason: t('后台编辑器 15 秒内没有退出') } : { closed: true }
  }
  const win = process.platform === 'win32'
  if (force) {
    // 连 Live Coding 控制台这类子进程一起结束，等真的退出：走面板的外部进程入口（ADR 0076）
    const { stopTree } = await import('@panel/server/exec/tracked')
    const r = await stopTree(pid, { waitMs: FORCE_MS })
    if (r.ok) return { closed: true }
    throw new Error(
      t('强制结束 PID {pid} 失败：{msg}（编辑器是用管理员权限打开的话，面板也要用管理员权限运行）', {
        pid,
        msg: r.error ?? '',
      }),
    )
  }
  let note = ''
  if (win) {
    const r = await run('taskkill.exe', ['/PID', String(pid)], { timeout: FORCE_MS })
    // 没有窗口能收关闭消息（卡死、无窗口启动）时 taskkill 直接说只能强制结束
    if (r.code !== 0 && alive(pid)) note = (r.err || r.out).trim()
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return { closed: true }
    }
  }
  if (!note && (await waitExit(pid, GRACE_MS))) return { closed: true }
  return {
    closed: false,
    reason: note
      ? t('没法正常关闭：{msg}', { msg: note })
      : t('{s} 秒内没有退出：可能在弹窗问要不要保存（到编辑器里点一下），也可能卡住了', { s: GRACE_MS / 1000 }),
  }
}
