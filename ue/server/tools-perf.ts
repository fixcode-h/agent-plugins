import {
  captureCompare,
  captureList,
  captureQuery,
  captureSummary,
  deleteCapture,
  getCapture,
  importCapture,
} from './captures.ts'
import { BridgeError } from './instances.ts'
import { liveSummary } from './perf-live.ts'
import { captureStatus, DEFAULT_SECONDS, markCapture, MAX_SECONDS, startCapture, stopCapture } from './perf.ts'
import { traceAgentQuery, traceSummary } from './trace-query.ts'
import { out, str, TARGET, tool } from './toolkit.ts'
import { t } from './util.ts'

/**
 * 性能和内存分析的两个工具（设计稿「性能与内存分析」第一期）：
 * ue_perf 对着正在运行的 UE 发起抓取，ue_capture 对着抓到的文件做摘要、查询和对比（UE 关了也能用）。
 * 原始文件不直接给 Agent：先摘要、再按条件下钻，结果限长。单独一个文件，tools.ts 只把它拼进工具列表。
 */
const PERF_HELP = `ue_perf：对着正在运行的 UE 抓性能和内存数据。抓到的文件用 ue_capture 分析。

action=live   不抓文件，直接看最近 seconds 秒（默认 5，最多 60）的实时读数：帧时间、各线程时间、GPU、Draw Calls、内存，和游戏里 stat unit 同源。先用它判断有没有问题、瓶颈在哪个线程
action=start  开始抓取
  kind=trace      Unreal Insights 同款 trace：每个线程每一层作用域（函数调用堆栈）、计时器、帧、书签、计数器、日志。seconds 同下，到时间自动停
                  preset=standard（默认：cpu,gpu,frame,bookmark,counters,log）/ named（再开 stat namedevents，能看到蓝图函数名，开销大些）/
                  loading（加 loadtime,assetloadtime，查切关和加载慢）/ memtag（加 memtag，UE 要用 -llm 启动）/ custom（channels 写逗号分隔的通道）
  kind=csv        CSV Profiler：每帧的帧时间、各线程时间和各项统计。seconds 是时长上限（默认 ${DEFAULT_SECONDS}，最多 ${MAX_SECONDS}），到时间自动停
  kind=memreport  执行 memreport -full，马上得到一份内存报告（游戏会卡几秒），不用 stop
  label           给这份抓取起个名字，之后可以用名字代替 id
action=mark   往正在进行的 trace / CSV 抓取里打书签（name），分析时可以按书签切段、用书签名当 from / to
action=stop   停止 trace / CSV 抓取，返回抓取 id
action=status 看有没有正在进行的抓取

怎么选：
- 卡顿、帧率低、要知道慢在哪个函数：kind=trace。start → 用 ue_gm / ue_console 触发场景（前后各 mark 一下）→ stop → ue_capture summary → query what=timers / butterfly / stack。
- 长时间看走势（跑一整局）、对比两个版本：kind=csv，文件小，能录很久。
- 内存高、怀疑泄漏：kind=memreport。在同一个场景进出一次，前后各抓一份，用 ue_capture compare 看哪些类只涨不回。
- 先看大概：action=live，看帧率、哪个线程最慢、内存多少，不留文件。
- CSV 只说明「哪些帧、哪一类慢」，定位不到具体函数；要函数用 trace。
- trace 由编辑器（没开时后台编辑器）用 UE 自己的 TraceServices 分析，停止后第一次查要等几秒到几十秒，返回 analyzing 时过一会儿再查。

注意：Shipping 构建里没有 CSV Profiler；PIE 里客户端和服务器在同一个进程，抓到的是整个进程的数据。`

const CAPTURE_HELP = `ue_capture：分析抓到的文件（UE 不在运行也能用）。id 可以写抓取 id、起的名字或文件名。

action=list     列出抓取（kind 可筛 csv / memreport / trace）；包括手动在 UE 里抓的
action=summary  一份抓取的摘要
action=query    下钻，what 见下
action=compare  两份同类抓取的差异（id 是先抓的，other 是后抓的）
action=import   登记磁盘上的一个文件（path；.csv、.csv.gz、.memreport、.utrace），不复制不改原文件
action=delete   删除抓取文件（每次都会请用户确认；导入的外部文件只取消登记）

CSV 的 what：
  hitches   卡顿帧：数量、分布在哪些时间段、最慢的若干帧，每帧附带比平时涨得最多的列。thresholdMs 改门槛
  columns   列出有哪些列（name 按名字里的文字筛，offset 翻页），带平均、P95、最大值
  column    一列的统计和随时间的走势（name 是列名；top 是分多少段，默认 60）
  frame     某一帧（frame 是帧号）的关键列和异常高的列
  segment   按事件（书签）切段，给每段的关键列统计（name 筛事件名）
  from / to 限定时间段：写秒数或书签名（hitches、columns、column 支持）

memreport 的 what：
  objects   按类的对象表（来自 obj list）：sort 指定排序列（Count、NumKB、ResExcKB…），name 筛类名，top / offset 分页
  section   不写 name 列出所有段；写 name 取那一段的原文（contains 筛关键字，top / offset 分页）
  textures、meshes、skeletalmeshes、sounds、particles、rendertargets、rhi、llm、levels  对应段的明细，能认出表格时按表给（可 sort）

trace 的 what（时间单位：范围是秒，耗时是毫秒）：
  frames     帧统计和最慢的帧（每帧带开始时间，可以接着用 frame=<帧号> 查那一帧）。thresholdMs 只列超过门槛的
  timers     计时器表：每个作用域的次数、包含时间、独占时间、单次最长，默认按独占时间倒序（sort=incl / count / max）；name 按名字筛
  butterfly  调用者 / 被调用者：timer 写计时器的名字或 id，callers 是谁调了它，callees 是它里面调了谁
  stack      某一刻的调用堆栈：lane 写线程名（默认 GameThread）或泳道 id，time 写秒（或给 frame 取那一帧开头）；depth 选中某一层，children 是那一层的直接子调用
  threads    有哪些线程（泳道 id 和名字）
  log        日志（name 按内容或分类筛）
  bookmarks  书签
  counters   不写 name 列出计数器；写 name 给那条计数器的走势
  from / to  限定范围：秒数或书签名；frame=<帧号> 只看那一帧
读数提示：时间类的列单位是毫秒；memreport 的大小是 KB；ResExcKB 是对象持有的资源（贴图、网格数据）的大小，通常比 NumKB 更能说明问题。`

export const PERF_DEFS = [
  tool(
    'ue_perf',
    '性能和内存抓取（对着正在运行的 UE）。action=live 看最近几秒的实时读数（seconds，和 stat unit 同源，不留文件）；action=start 开始：kind=trace 录 Unreal Insights 同款 trace（每个线程的函数调用堆栈和计时器，preset 选通道组合，seconds 时长上限，到时间自动停），kind=csv 是 CSV Profiler（每帧耗时），kind=memreport 抓一份内存报告（马上完成）；action=mark 打书签（name）；action=stop 停止 trace / CSV 并返回抓取 id；action=status 看进行中的抓取；action=help 看用法和怎么选。抓到的文件用 ue_capture 分析。',
    {
      action: { type: 'string', enum: ['live', 'start', 'stop', 'mark', 'status', 'help'] },
      kind: { type: 'string', enum: ['trace', 'csv', 'memreport'] },
      preset: { type: 'string', enum: ['standard', 'named', 'loading', 'memtag', 'custom'] },
      channels: { type: 'string' },
      seconds: { type: 'number' },
      label: { type: 'string' },
      name: { type: 'string' },
      id: { type: 'string' },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      switch (a.action) {
        case 'live':
          return out(await liveSummary(ctx, Number(a.seconds) || 5))
        case 'start':
          return out(
            await startCapture(ctx, {
              kind: str(a.kind),
              seconds: Number(a.seconds),
              label: str(a.label),
              preset: str(a.preset),
              channels: str(a.channels),
            }),
          )
        case 'stop':
          return out(await stopCapture(ctx, str(a.id) || undefined))
        case 'mark':
          return out(await markCapture(ctx, str(a.name)))
        case 'status':
          return out(await captureStatus(ctx))
        default:
          return out(PERF_HELP)
      }
    },
  ),
  tool(
    'ue_capture',
    '分析性能和内存抓取文件（UE 不在运行也能用）。action=list 列出抓取；summary 看一份的摘要（id）；query 下钻（id + what，trace：frames / timers / butterfly / stack / threads / log / bookmarks / counters，CSV：hitches / columns / column / frame / segment，memreport：objects / section / textures 等）；compare 对比两份同类抓取（id 先抓的、other 后抓的，查内存泄漏用两份 memreport）；import 登记外部文件（path）；delete 删除（每次请用户确认）；action=help 看每种 what 的参数。结果先摘要再细节，不会返回整份文件。',
    {
      action: { type: 'string', enum: ['list', 'summary', 'query', 'compare', 'import', 'delete', 'help'] },
      id: { type: 'string' },
      other: { type: 'string' },
      kind: { type: 'string', enum: ['csv', 'memreport', 'trace'] },
      what: { type: 'string' },
      name: { type: 'string' },
      frame: { type: 'number' },
      from: { type: ['number', 'string'] },
      to: { type: ['number', 'string'] },
      sort: { type: 'string' },
      contains: { type: 'string' },
      thresholdMs: { type: 'number' },
      timer: { type: ['number', 'string'] },
      lane: { type: ['number', 'string'] },
      time: { type: 'number' },
      depth: { type: 'number' },
      top: { type: 'number' },
      offset: { type: 'number' },
      path: { type: 'string' },
      label: { type: 'string' },
    },
    ['action'],
    async (a, ctx) => {
      const p = ctx.project
      switch (a.action) {
        case 'list':
          return out(await captureList(p, str(a.kind) || undefined, Number(a.top) || 30))
        case 'summary': {
          const cap = await getCapture(p, str(a.id))
          if (cap.kind === 'trace')
            return out({
              capture: { id: cap.id, label: cap.label, file: cap.file },
              ...(await traceSummary(ctx, cap.id)),
            })
          return out(await captureSummary(p, cap.id))
        }
        case 'query': {
          const cap = await getCapture(p, str(a.id))
          if (cap.kind === 'trace') return out(await traceAgentQuery(ctx, cap.id, a))
          return out(await captureQuery(p, cap.id, a))
        }
        case 'compare':
          return out(await captureCompare(p, str(a.id), str(a.other), Number(a.top) || undefined))
        case 'import':
          return out(await importCapture(p, str(a.path), str(a.label) || undefined))
        case 'delete': {
          const cap = await getCapture(p, str(a.id))
          // 删文件不能撤回：不管权限设成什么都先问
          if (!ctx.confirm) throw new BridgeError(t('这一步要你确认，但这次调用不在对话里，没法弹出确认卡片'))
          const r = await ctx.confirm({
            title: cap.imported ? t('Agent 要取消登记一份导入的抓取') : t('Agent 要删除一份抓取文件'),
            detail: `${cap.label ? `${cap.label}\n` : ''}${cap.file}\n${Math.round(cap.size / 1024)} KB`,
          })
          if (!r.allow) throw new BridgeError(t('你拒绝了：{msg}', { msg: r.message || cap.file }))
          return out(await deleteCapture(p, cap.id))
        }
        default:
          return out(CAPTURE_HELP)
      }
    },
  ),
]
