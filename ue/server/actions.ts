import { backgroundState } from './editor.ts'
import { markUndone, readHistory, record } from './history.ts'
import { BridgeError, bridgeVersionIn, info, liveCards } from './instances.ts'
import { bundledVersion } from './install.ts'
import { projectJobs } from './jobs.ts'
import { clearOfflineLog, logFile, logSize, searchFile, tailFile } from './logs.ts'
import { runOp, type OpCtx } from './ops.ts'
import { readGm } from './store.ts'
import type { ProjectState, UeProject } from './types.ts'
import { t } from './util.ts'

/** 比单个桥接操作大一点的动作（网页和 Agent 工具共用）：概况、撤回、日志、宏 */

export async function projectState(p: UeProject): Promise<ProjectState> {
  const cards = await liveCards(p.root)
  const [instances, bridge, bundled] = await Promise.all([
    Promise.all(cards.map(info)),
    bridgeVersionIn(p.root),
    bundledVersion(),
  ])
  return { project: p, instances, bridge, bundled, background: backgroundState(p.id, cards), jobs: projectJobs(p.id) }
}

export async function undo(ctx: OpCtx, id: string) {
  const items = await readHistory(ctx.project.id)
  const it = items.find((i) => i.id === id)
  if (!it) throw new BridgeError(t('操作记录里没有这一条（可能超过保留天数被清掉了）'))
  if (it.undone) throw new BridgeError(t('这一条已经撤回过了'))
  if (!it.undo) throw new BridgeError(it.noUndo || t('这一条不能撤回'))
  // 撤回发回原来那个进程：PIE 停了、进程退了就撤不回，原样报错
  const cards = await liveCards(ctx.project.root)
  if (!cards.some((x) => x.pid === it.pid))
    throw new BridgeError(t('当时的 UE 进程（{pid}）已经退出，运行时修改已经不在了，不用撤回', { pid: it.pid ?? '?' }))
  const res = await runOp({ ...ctx, target: { instance: it.pid, world: it.world } }, it.undo.op, it.undo.args)
  await markUndone(ctx.project.id, id, ctx.actor.kind === 'user' ? 'user' : ctx.actor.taskId)
  return res
}

export interface LogArgs {
  since?: number
  limit?: number
  category?: string
  verbosity?: string
  contains?: string
}

/** 日志：UE 在跑就从桥接取（带游标），没在跑读日志文件尾部 */
export async function logTail(ctx: OpCtx, a: LogArgs) {
  const cards = (await liveCards(ctx.project.root)).filter((x) => x.kind !== 'background')
  if (cards.length) {
    const r = await runOp(ctx, 'log.tail', { ...a, limit: a.limit ?? 300 })
    return { live: true, ...r, lines: withWallTime(r.lines as RawLine[], r.now as number | undefined) }
  }
  // UE 没在运行：没筛选时只读文件尾部；有筛选时流式搜索最后 64 MB（大文件不整个读进内存）
  const filtered = !!(a.category || a.verbosity || a.contains)
  const r = filtered
    ? await searchFile(logFile(ctx.project), a, a.limit ?? 300)
    : { ...(await tailFile(logFile(ctx.project), a.limit ?? 300)), truncated: false, matched: 0 }
  return {
    live: false,
    lines: r.lines.map((l) => ({ ...l, at: fileTime(l.time) })),
    cursor: 0,
    errors: r.lines.filter((l) => /error|fatal/i.test(l.verbosity)).length,
    warnings: r.lines.filter((l) => /warning/i.test(l.verbosity)).length,
    file: r.file,
    size: r.size,
    truncated: r.truncated,
  }
}

interface RawLine {
  time?: number | string
  [k: string]: unknown
}

/**
 * 进程里的日志行带的是 FPlatformTime::Seconds（开机后的秒数，不是钟表时间）。桥接 1.1.1 起回包里带上它自己的 now，
 * 用「现在 - (now - time)」换成钟表时间；旧桥接没有 now，就不给 at，网页按收到的时间显示
 */
function withWallTime(lines: RawLine[] = [], bridgeNow?: number) {
  const wall = Date.now()
  return lines.map((l) =>
    typeof bridgeNow === 'number' && typeof l.time === 'number'
      ? { ...l, at: Math.round(wall - (bridgeNow - l.time) * 1000) }
      : l,
  )
}

/** 日志文件里的时间 [2026.11.10-11.30.12:345]（UTC），换成毫秒时间戳 */
function fileTime(s?: string) {
  const m = /^(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{1,3})$/.exec(s ?? '')
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : undefined
}

/** 清空日志会影响到的进程（清空弹窗列出来，设计文档 3.5） */
export async function logTargets(p: UeProject) {
  const cards = (await liveCards(p.root)).filter((x) => x.kind !== 'background')
  const list = await Promise.all(cards.map(info))
  return {
    running: list.map((i) => ({ pid: i.pid, kind: i.kind, file: i.log ?? '', online: i.online })),
    offline: { file: logFile(p), size: await logSize(p) },
  }
}

/** 清空：在跑的进程由桥接自己清（只有它能动被占着的文件）；都没在跑就直接清文件 */
export async function clearLogs(ctx: OpCtx, pids: number[] | undefined, backup: boolean) {
  const cards = (await liveCards(ctx.project.root)).filter((x) => x.kind !== 'background')
  if (!cards.length) {
    await clearOfflineLog(ctx.project)
    await record(ctx.project.id, {
      actor: ctx.actor,
      op: 'log.clear',
      summary: logFile(ctx.project),
      ok: true,
      noUndo: t('清空日志不能撤回'),
    })
    return { cleared: [{ file: logFile(ctx.project), offline: true }] }
  }
  const pick = pids?.length ? cards.filter((x) => pids.includes(x.pid)) : cards.slice(0, 1)
  const cleared: unknown[] = []
  for (const card of pick) {
    const res = await runOp({ ...ctx, target: { instance: card.pid } }, 'log.clear', { backup })
    cleared.push({ pid: card.pid, kind: card.kind, file: res.file, size: res.size, backup: res.backup })
  }
  return { cleared }
}

/** 宏：按顺序执行，任何一步失败就停下并说是哪一步（设计文档 4.3） */
export async function runMacro(ctx: OpCtx, id: string) {
  const gm = await readGm(ctx.project)
  const m = gm.macros.find((x) => x.id === id || x.name === id)
  if (!m) throw new BridgeError(t('没有这个宏：{id}', { id }))
  const steps: { step: number; ok: boolean; output?: unknown; error?: string }[] = []
  for (const [i, s] of m.steps.entries()) {
    try {
      const res = s.console
        ? await runOp(ctx, 'console', { command: s.console })
        : await runOp(ctx, 'gm.run', { name: s.gm, args: s.args ?? [] })
      steps.push({ step: i + 1, ok: true, output: res.output })
    } catch (e) {
      steps.push({ step: i + 1, ok: false, error: (e as Error).message })
      return { ok: false, macro: m.name, failedAt: i + 1, steps }
    }
  }
  return { ok: true, macro: m.name, steps }
}

/** 截图：直接用桥接，结果给网页显示或回给 Agent */
export async function screenshot(ctx: OpCtx, maxWidth = 1280) {
  return runOp(ctx, 'screenshot', { maxWidth }, 20000)
}
