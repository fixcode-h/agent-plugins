import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  captureId,
  kindOfFile,
  listCaptures,
  profilingDir,
  setMeta,
  type Capture,
  type CaptureKind,
} from './captures.ts'
import { BridgeError } from './instances.ts'
import { runOp, type OpCtx } from './ops.ts'
import type { Actor, UeProject } from './types.ts'
import { c, now, readJson, t, uid, writeJson } from './util.ts'

/**
 * 发起和停止抓取（设计稿第一期：不改桥接 C++，全走现有的控制台命令通道）。
 * - CSV Profiler：CsvProfile Start / Stop，文件写在 Saved/Profiling/CSV；
 * - memreport：memreport -full，文件写在 Saved/Profiling/MemReports。
 * 引擎不告诉我们文件写到哪了，所以开始前记下已有的文件，结束后找新出现的那个。
 * - trace（性能页二期）：Trace.File 写到 Saved/Profiling/AgentPanel/<名字>.utrace，Trace.Stop 停；分析见 trace-query.ts。
 * 每次抓取都有时长上限，到了自己停：Agent 开了忘关的话 CSV / trace 会一直涨。
 */
export interface ActiveCapture {
  id: string
  kind: 'csv' | 'trace'
  /** trace：录制预设（TRACE_PRESETS 的键或 custom）和开了命名事件没有（停的时候要关回去） */
  preset?: string
  named?: boolean
  /** trace：期望写出的文件（绝对路径） */
  file?: string
  label: string
  startedAt: string
  /** 到这个时间自动停 */
  deadline: string
  seconds: number
  pid: number
  by: Actor
  marks: { at: number; name: string }[]
  /** 开始前已经有的文件，结束后用来认出新文件 */
  before: string[]
}

const activeFile = (project: string) => path.join(c().dataDir, 'captures', `${encodeURIComponent(project)}.active.json`)
const readActive = (project: string) => readJson<ActiveCapture[]>(activeFile(project), [])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const DEFAULT_SECONDS = 30
export const MAX_SECONDS = 600

/**
 * trace 录制预设（性能页设计 3.4，默认「标准」）。命名事件靠 stat namedevents：蓝图函数、Actor / 组件 Tick 带上具体名字，
 * 开销大一些所以单独一档。内存标签要 UE 用 -llm 启动才有数据。
 */
const STANDARD = 'cpu,gpu,frame,bookmark,counters,log'
export const TRACE_PRESETS: Record<string, { channels: string; named?: boolean }> = {
  standard: { channels: STANDARD },
  named: { channels: STANDARD, named: true },
  loading: { channels: `${STANDARD},loadtime,assetloadtime` },
  memtag: { channels: `${STANDARD},memtag` },
}

function traceChannels(preset: string, custom: string) {
  if (preset === 'custom') {
    const ch = custom.replace(/\s+/g, '')
    if (!/^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/.test(ch))
      throw new BridgeError(t('自定义通道要写成逗号分隔的通道名，例如 cpu,gpu,frame'))
    return { channels: ch, named: false }
  }
  const p = TRACE_PRESETS[preset]
  if (!p)
    throw new BridgeError(t('不认识的录制预设：{p}（standard / named / loading / memtag / custom）', { p: preset }))
  return { channels: p.channels, named: !!p.named }
}

/**
 * 抓取的权限在这里按「一次抓取」问一遍（卡片上写清种类和时长），之后发给 UE 的控制台命令不再逐条确认：
 * 把这一次调用的运行时权限当成可写交给 runOp，操作记录里发起人不变。只读权限直接拒绝。
 */
async function allow(ctx: OpCtx, title: string, detail: string): Promise<OpCtx> {
  if (ctx.actor.kind !== 'agent') return ctx
  const { runtime } = ctx.project.perms
  if (runtime === 'read')
    throw new BridgeError(t('UE 页「桥接与权限」里 Agent 对运行时是只读，不能执行：{what}', { what: title }))
  if (runtime === 'ask') {
    if (!ctx.confirm) throw new BridgeError(t('这一步要你确认，但这次调用不在对话里，没法弹出确认卡片'))
    const r = await ctx.confirm({ title, detail })
    if (!r.allow) throw new BridgeError(t('你拒绝了：{msg}', { msg: r.message || title }))
  }
  return granted(ctx)
}

const granted = (ctx: OpCtx): OpCtx => ({
  ...ctx,
  project: { ...ctx.project, perms: { ...ctx.project.perms, runtime: 'write' } },
})

async function filesOf(p: UeProject, kind: CaptureKind) {
  return (await listCaptures(p)).filter((x) => x.kind === kind && !x.imported)
}

/** 等新文件出现并写完（连着两次大小一样）；等不到返回 undefined */
async function waitNewFile(p: UeProject, kind: CaptureKind, before: string[], since: number, waitMs: number) {
  const known = new Set(before)
  const end = Date.now() + waitMs
  let last: { file: string; size: number } | undefined
  for (;;) {
    const fresh = (await filesOf(p, kind))
      .filter((x) => !known.has(x.file) && Date.parse(x.at) >= since - 2000)
      .sort((a, b) => b.at.localeCompare(a.at))[0]
    if (fresh) {
      if (last && last.file === fresh.file && last.size === fresh.size && fresh.size > 0) return fresh
      last = { file: fresh.file, size: fresh.size }
    }
    if (Date.now() > end) return undefined
    await new Promise((r) => setTimeout(r, 400))
  }
}

/** 控制台输出里如果带了文件路径（引擎会打一行写到哪了），直接用它，比扫目录准 */
async function fileFromOutput(output: unknown, kind: CaptureKind): Promise<string | undefined> {
  for (const line of Array.isArray(output) ? output : []) {
    for (const m of String(line).matchAll(
      /((?:[A-Za-z]:)?[^\s"':*?<>|]*[\\/][^"':*?<>|]*\.(?:csv(?:\.gz)?|memreport))/gi,
    )) {
      const file = path.resolve(m[1].trim())
      if (kindOfFile(file) === kind && (await stat(file).catch(() => undefined))?.isFile()) return file
    }
  }
  return undefined
}

const asCapture = async (p: UeProject, file: string): Promise<Capture | undefined> =>
  (await listCaptures(p)).find((x) => x.id === captureId(file))

export async function captureStatus(ctx: OpCtx) {
  // 面板重启后定时器没了：过了时限的在这里补停（看状态和开始新抓取之前都会走到）
  await sweep(ctx)
  const active = await readActive(ctx.project.id)
  return { active: active.map(({ before: _b, ...a }) => ({ ...a, elapsed: elapsedOf(a.startedAt) })) }
}

const elapsedOf = (startedAt: string) => Math.round((Date.now() - Date.parse(startedAt)) / 100) / 10

export async function startCapture(
  ctx: OpCtx,
  a: { kind?: string; seconds?: number; label?: string; preset?: string; channels?: string },
) {
  const kind = String(a.kind || 'csv')
  if (kind === 'memreport') return memreport(ctx, a.label)
  if (kind !== 'csv' && kind !== 'trace')
    throw new BridgeError(t('能抓的种类：trace（Unreal Insights 同款）、csv（CSV Profiler）、memreport'))
  const p = ctx.project
  await sweep(ctx)
  const active = await readActive(p.id)
  if (active.length) {
    const cur = active[0]
    throw new BridgeError(
      t('已经有一个抓取在进行（{label}，已经 {s} 秒，id {id}）：先 stop 再开新的', {
        label: cur.label,
        s: elapsedOf(cur.startedAt),
        id: cur.id,
      }),
    )
  }
  const seconds = Math.min(Math.max(1, Math.round(Number(a.seconds) || DEFAULT_SECONDS)), MAX_SECONDS)
  const label = (a.label || '').trim() || `${kind}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`
  if (kind === 'trace') return startTrace(ctx, label, seconds, String(a.preset || 'standard'), String(a.channels || ''))
  const run = await allow(
    ctx,
    t('Agent 要开始性能抓取'),
    t('CSV Profiler（每帧各项耗时），最长 {s} 秒，到时间自动停；文件写在项目的 Saved/Profiling/CSV', { s: seconds }),
  )
  const before = (await filesOf(p, 'csv')).map((x) => x.file)
  const res = await runOp(run, 'console', { command: 'CsvProfile Start' })
  const pid = (res.instance as { pid: number }).pid
  const item: ActiveCapture = {
    id: uid(),
    kind: 'csv',
    label,
    startedAt: now(),
    deadline: new Date(Date.now() + seconds * 1000).toISOString(),
    seconds,
    pid,
    by: ctx.actor,
    marks: [],
    before,
  }
  await writeJson(activeFile(p.id), [item])
  arm(ctx, item)
  return {
    started: true,
    id: item.id,
    kind,
    label,
    seconds,
    pid,
    output: res.output,
    next: '触发要测的场景（ue_gm / ue_console），需要分段就 action=mark，然后 action=stop；不 stop 到时间也会自动停',
  }
}

function arm(ctx: OpCtx, item: ActiveCapture) {
  clearTimeout(timers.get(item.id))
  const ms = Math.max(0, Date.parse(item.deadline) - Date.now())
  // 自动停不在对话里，没有确认卡片可弹：开始时已经确认过这一次抓取
  const auto = granted({ ...ctx, confirm: undefined })
  timers.set(
    item.id,
    setTimeout(() => {
      stopCapture(auto, item.id, true).catch((e) => c().log.warn('自动停止抓取失败', { error: (e as Error).message }))
    }, ms),
  )
}

/** 过了时限还没停的（面板重启过、定时器丢了）补停 */
async function sweep(ctx: OpCtx) {
  for (const item of await readActive(ctx.project.id))
    if (Date.parse(item.deadline) < Date.now() - 1000 && !timers.has(item.id))
      await stopCapture(granted({ ...ctx, confirm: undefined }), item.id, true).catch(async () => {
        // 当时的进程已经退了：没什么可停的，清掉登记
        await writeJson(activeFile(ctx.project.id), [])
      })
}

export async function stopCapture(ctx: OpCtx, id?: string, auto = false) {
  const p = ctx.project
  const active = await readActive(p.id)
  const item = id ? active.find((x) => x.id === id) : active[0]
  if (!item) throw new BridgeError(t('没有正在进行的抓取'))
  clearTimeout(timers.get(item.id))
  timers.delete(item.id)
  // 先清登记再发命令：命令失败（进程退了）时也不会留下一个永远停不掉的抓取
  await writeJson(
    activeFile(p.id),
    active.filter((x) => x.id !== item.id),
  )
  if (item.kind === 'trace') return stopTrace(ctx, item, auto)
  const res = await runOp(granted({ ...ctx, target: { instance: item.pid } }), 'console', {
    command: 'CsvProfile Stop',
  })
  const since = Date.parse(item.startedAt)
  const named = await fileFromOutput(res.output, 'csv')
  const cap = named ? await asCapture(p, named) : await waitNewFile(p, 'csv', item.before, since, 20000)
  if (!cap)
    throw new BridgeError(
      t(
        '已经让 UE 停止 CSV 抓取，但 20 秒内没在 Saved/Profiling/CSV 里看到新文件。可能这个构建没编进 CSV Profiler（Shipping 默认没有），或者文件写到了别处。UE 的输出：{out}',
        { out: JSON.stringify(res.output ?? []) },
      ),
    )
  await setMeta(p.id, cap.id, {
    label: item.label,
    by: item.by,
    startedAt: item.startedAt,
    marks: item.marks,
    pid: item.pid,
  })
  return {
    stopped: true,
    auto,
    capture: { id: cap.id, kind: cap.kind, label: item.label, file: cap.file, sizeKB: Math.round(cap.size / 1024) },
    seconds: elapsedOf(item.startedAt),
    marks: item.marks,
    next: `用 ue_capture action=summary id=${cap.id} 看摘要`,
  }
}

/** 书签：往 CSV 里写一个事件（引擎的 CsvEvent 命令），面板这边同时记一份时间，引擎没写进去时也能按时间切段 */
export async function markCapture(ctx: OpCtx, name: string) {
  const label = name.trim().replace(/[\s,;"]+/g, '_')
  if (!label) throw new BridgeError(t('书签要有名字'))
  const active = await readActive(ctx.project.id)
  const item = active[0]
  if (!item) throw new BridgeError(t('没有正在进行的抓取，书签要在 start 和 stop 之间打'))
  const at = elapsedOf(item.startedAt)
  // trace 的书签进 trace 本身（时间轴上画竖线）；CSV 的进 CSV 事件
  const command = item.kind === 'trace' ? `Trace.Bookmark ${label}` : `CsvEvent ${label}`
  const res = await runOp(granted({ ...ctx, target: { instance: item.pid } }), 'console', { command })
  item.marks.push({ at, name: label })
  await writeJson(activeFile(ctx.project.id), active)
  return { marked: label, at, output: res.output }
}

async function memreport(ctx: OpCtx, label?: string) {
  const p = ctx.project
  const run = await allow(
    ctx,
    t('Agent 要抓一份内存报告'),
    t('执行 memreport -full：游戏会卡几秒，文件写在项目的 Saved/Profiling/MemReports'),
  )
  const before = (await filesOf(p, 'memreport')).map((x) => x.file)
  const since = Date.now()
  const res = await runOp(run, 'console', { command: 'memreport -full' }, 120000)
  // memreport 里的命令是分几帧执行的，文件过一会儿才写完
  const named = await fileFromOutput(res.output, 'memreport')
  const cap = named ? await asCapture(p, named) : await waitNewFile(p, 'memreport', before, since, 60000)
  if (!cap)
    throw new BridgeError(
      t('已经执行 memreport -full，但 60 秒内没在 Saved/Profiling/MemReports 里看到新文件。UE 的输出：{out}', {
        out: JSON.stringify(res.output ?? []),
      }),
    )
  const name = (label || '').trim() || undefined
  await setMeta(p.id, cap.id, {
    label: name,
    by: ctx.actor,
    startedAt: new Date(since).toISOString(),
    pid: (res.instance as { pid: number }).pid,
  })
  return {
    captured: true,
    capture: { id: cap.id, kind: cap.kind, label: name, file: cap.file, sizeKB: Math.round(cap.size / 1024) },
    next: `用 ue_capture action=summary id=${cap.id} 看摘要；查泄漏就在同一个场景进出一次后再抓一份，用 action=compare 对比`,
  }
}

/** 文件名里只留字母数字和 -_：Trace.File 的参数按空格切，路径里不能有空格 */
const safeName = (s: string) =>
  s
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'trace'

async function startTrace(ctx: OpCtx, label: string, seconds: number, preset: string, custom: string) {
  const p = ctx.project
  const { channels, named } = traceChannels(preset, custom)
  const run = await allow(
    ctx,
    t('Agent 要开始录 trace'),
    t(
      'Unreal Insights 同款录制（通道 {ch}{named}），最长 {s} 秒，到时间自动停；文件写在项目的 Saved/Profiling/AgentPanel',
      {
        ch: channels,
        named: named ? t('，开命名事件') : '',
        s: seconds,
      },
    ),
  )
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  // 相对路径：引擎把它放在 Saved/Profiling 下（绝对路径里有空格时控制台参数会被切开）
  const rel = `AgentPanel/${safeName(label)}-${stamp}.utrace`
  const file = path.join(profilingDir(p), rel)
  await mkdir(path.dirname(file), { recursive: true })
  const before = (await filesOf(p, 'trace')).map((x) => x.file)
  const res = await runOp(run, 'console', { command: `Trace.File ${rel} ${channels}` })
  const pid = (res.instance as { pid: number }).pid
  if (named) await runOp(granted({ ...run, target: { instance: pid } }), 'console', { command: 'stat namedevents' })
  const item: ActiveCapture = {
    id: uid(),
    kind: 'trace',
    preset,
    named,
    file,
    label,
    startedAt: now(),
    deadline: new Date(Date.now() + seconds * 1000).toISOString(),
    seconds,
    pid,
    by: ctx.actor,
    marks: [],
    before,
  }
  await writeJson(activeFile(p.id), [item])
  arm(ctx, item)
  return {
    started: true,
    id: item.id,
    kind: 'trace',
    preset,
    channels,
    label,
    seconds,
    pid,
    output: res.output,
    next: '触发要测的场景，需要分段就 action=mark，然后 action=stop；停止后用 ue_capture action=summary 看分析结果',
  }
}

async function stopTrace(ctx: OpCtx, item: ActiveCapture, auto: boolean) {
  const p = ctx.project
  const run = granted({ ...ctx, target: { instance: item.pid } })
  const res = await runOp(run, 'console', { command: 'Trace.Stop' })
  // 命名事件是开关命令：开始时打开了，这里关回去，免得一直多一份开销
  if (item.named) await runOp(run, 'console', { command: 'stat namedevents' }).catch(() => undefined)
  const since = Date.parse(item.startedAt)
  const expected = item.file && (await stat(item.file).catch(() => undefined))?.isFile() ? item.file : undefined
  const cap = expected ? await asCapture(p, expected) : await waitNewFile(p, 'trace', item.before, since, 20000)
  if (!cap)
    throw new BridgeError(
      t(
        '已经让 UE 停止 trace，但 20 秒内没在 Saved/Profiling 里看到 .utrace 文件。可能 UE 已经在往 Unreal Insights 录（命令行带了 -trace），或者这个构建没编进 trace。UE 的输出：{out}',
        { out: JSON.stringify(res.output ?? []) },
      ),
    )
  await setMeta(p.id, cap.id, {
    label: item.label,
    by: item.by,
    startedAt: item.startedAt,
    marks: item.marks,
    pid: item.pid,
    preset: item.preset,
  })
  return {
    stopped: true,
    auto,
    capture: { id: cap.id, kind: cap.kind, label: item.label, file: cap.file, sizeKB: Math.round(cap.size / 1024) },
    seconds: elapsedOf(item.startedAt),
    marks: item.marks,
    next: `用 ue_capture action=summary id=${cap.id} 看分析结果（第一次要等后台编辑器分析几秒）`,
  }
}
