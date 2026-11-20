import { installedIn, KNOWN_EXTENSIONS } from './uekit/catalog.ts'
import { busyFromLog } from './busy/activity.ts'
import { lastLogOf } from './busy/state.ts'
import { backgroundState } from './editor.ts'
import { launchProgress } from './launch/track.ts'
import { markUndone, readHistory, record } from './history.ts'
import { BridgeError, bridgeVersionIn, info, liveCards } from './instances.ts'
import { availableVersion } from './uelink.ts'
import { projectJobs } from './jobs.ts'
import { clearOfflineLog, levelMatches, logFile, type LogLine, logSize, searchFile, tailFile } from './logs.ts'
import { markOf, readMarks, saveMark } from './log-clear/mark.ts'
import { runOp, type OpCtx } from './ops.ts'
import { runLuaGm } from './lua-gm/run.ts'
import { hasUnLua } from './lua/unlua-detect.ts'
import { readGm } from './store.ts'
import type { ProjectState, UeProject } from './types.ts'
import { t } from './util.ts'
import { breakMessage } from './vs-debug/break-note.ts'
import { vsDebugState } from './vs-debug/state.ts'

/** 比单个桥接操作大一点的动作（网页和 Agent 工具共用）：概况、撤回、日志、宏 */

export async function projectState(p: UeProject): Promise<ProjectState> {
  const cards = await liveCards(p.root)
  const [instances, bridge, bundled, vsDebug] = await Promise.all([
    // 忙着的进程补上「在忙什么」：日志路径用它上次回应时报的，没有就是项目的默认日志
    Promise.all(
      cards.map(async (card) => {
        const i = await info(card)
        if (i.busy) i.busy = { ...i.busy, ...(await busyFromLog(lastLogOf(card.pid) ?? logFile(p))) }
        return i
      }),
    ),
    bridgeVersionIn(p.root),
    availableVersion(),
    // VS 调试卡片（vs-debug/state.ts）：自己限 1.5 秒，不拖慢状态刷新
    vsDebugState(p),
  ])
  // 停在 VS 断点时进程冻住、/info 不回应：「忙」的说明换成停在哪、先 continue（不是在加载，别等也别重启）
  const paused = breakMessage(vsDebug?.status)
  if (paused) for (const i of instances) if (i.busy) i.error = paused
  // UEKit 扩展装没装（看磁盘上的插件目录）：左栏按它列出 AssetForge、GameTest
  const extensions = (
    await Promise.all(
      KNOWN_EXTENSIONS.map(async (name) => {
        const inst = await installedIn(p.root, name)
        return inst ? { name, version: inst.version } : undefined
      }),
    )
  ).filter((x) => !!x)
  return {
    project: p,
    instances,
    // 磁盘上认不出（插件放得太偏、名字全改了）但运行中的进程报了 Lua 环境，也算用了 UnLua
    unlua: instances.some((i) => i.lua) || (await hasUnLua(p)),
    bridge,
    bundled,
    background: backgroundState(p, cards),
    jobs: projectJobs(p.id),
    extensions,
    launch: launchProgress(p.id),
    ...(vsDebug && { vsDebug }),
  }
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
  /** 只要这一级（网页的级别分段），见 LineFilter.exact */
  exact?: boolean
  contains?: string
}

/** 日志：UE 在跑就从桥接取（带游标），没在跑读日志文件尾部 */
export async function logTail(ctx: OpCtx, a: LogArgs) {
  const cards = (await liveCards(ctx.project.root)).filter((x) => x.kind !== 'background')
  if (cards.length) {
    const r = await runOp(ctx, 'log.tail', { ...a, limit: a.limit ?? 300 })
    // 桥接的 verbosity 是最低级别（Warning 连错误也给）；网页要「只看这一级」时在这里再筛一遍，旧桥接也适用
    // 清空过的进程只给清空之后的行：缓冲里的旧行桥接没丢（log-clear/mark.ts）
    const pid = (r.instance as { pid?: number } | undefined)?.pid
    const mark = markOf(await readMarks(ctx.project.id), cards.find((x) => x.pid === pid))
    const got = ((r.lines as (RawLine & { verbosity?: string; seq?: number })[]) ?? []).filter(
      (l) => !mark || typeof l.seq !== 'number' || l.seq > mark,
    )
    const lines = a.exact && a.verbosity ? got.filter((l) => levelMatches(l.verbosity ?? '', a.verbosity, true)) : got
    return { live: true, ...r, lines: withWallTime(lines, r.now as number | undefined) }
  }
  // UE 没在运行：没筛选时只读文件尾部；有筛选时流式搜索最后 64 MB（大文件不整个读进内存）
  const filtered = !!(a.category || a.verbosity || a.contains)
  const r = filtered
    ? await searchFile(logFile(ctx.project), a, a.limit ?? 300)
    : { ...(await tailFile(logFile(ctx.project), a.limit ?? 300)), truncated: false }
  return {
    live: false,
    lines: r.lines.map(({ cont: _, ...l }: LogLine & { cont?: boolean }) => ({ ...l, at: fileTime(l.time) })),
    cursor: 0,
    // 按读到的整段算（不是筛选后的行），和在跑时桥接给的总数一样不随筛选变
    errors: r.errors,
    warnings: r.warnings,
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
    const at = { ...ctx, target: { instance: card.pid } }
    // 清空前的序号当水位线：之后在这一行之后写的（包括桥接自己那句「日志已清空」）才显示
    const before = await runOp(at, 'log.tail', { since: 1e15, limit: 1 }, 5000).catch(() => undefined)
    const res = await runOp(at, 'log.clear', { backup })
    const seq = Number(before?.cursor ?? res.cursor)
    if (seq > 0) await saveMark(ctx.project.id, card, seq, cards)
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
        : s.lua
          ? await runLuaGm(ctx, s.lua, s.args ?? [])
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
