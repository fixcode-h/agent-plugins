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
import { captureStatus, DEFAULT_SECONDS, markCapture, startCapture, stopCapture, TRACE_CHANNELS } from './perf.ts'
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
  kind=trace      Unreal Insights 同款 trace：每个线程每一层作用域（函数调用堆栈）、计时器、帧、书签、计数器、日志。seconds 同下
                  preset 选通道组合（都含标准的 cpu,gpu,frame,bookmark,counters,log）：standard（默认）/ named（再开 stat namedevents，能看到蓝图函数名，开销大些）/
                  gpu（加 rhicommands,rendercommands，查渲染线程和 RHI，开销大）/ loading（加 loadtime,assetloadtime,file，查切关和加载慢）/ memtag（加 memtag，UE 要用 -llm 启动）/
                  net（加 net，同步和 RPC）/ animation（加 animation）/ task（加 task,contextswitch，任务等待和线程切换，切换要管理员权限）/ object（加 object，UObject 创建销毁）/
                  custom（channels 写逗号分隔的通道，可选：${TRACE_CHANNELS.join(' ')}；named=true 同时开命名事件；memory 分配要 UE 用 -trace=memory 启动）
                  lua=true / "noc" / false：和 preset 叠加，一起录 Lua 函数（UnLua 项目，UELink 2.9 起）。true 是 Lua 函数 + C 函数（UE.GetVelocity 这类 UE 接口）单独成块，
                  "noc" 不单独录 C 函数（时间算进调用它的 Lua 函数，trace 更小）。不给按项目设置（装了 UnLua 默认 true）；UELink 太旧或没装 UnLua 时只录 UE 部分，结果里 luaNote 说明。
                  录 Lua 时 Lua 会变慢一些，看占比不看绝对值；IDE 的 Lua 调试器连着时录不到 Lua
  kind=csv        CSV Profiler：每帧的帧时间、各线程时间和各项统计。seconds 是时长上限（不给默认 ${DEFAULT_SECONDS} 秒自动停；0 = 不限时长，测完一定要 stop）
  kind=memreport  执行 memreport -full，马上得到一份内存报告（游戏会卡几秒），不用 stop
  label           给这份抓取起个名字，之后可以用名字代替 id
action=mark   往正在进行的 trace / CSV 抓取里打书签（name），分析时可以按书签切段、用书签名当 from / to
action=stop   停止 trace / CSV 抓取，返回抓取 id
action=status 看有没有正在进行的抓取

怎么选：
- 卡顿、帧率低、要知道慢在哪个函数：kind=trace。start → 用 ue_gm / ue_console 触发场景（前后各 mark 一下）→ stop → ue_capture summary → query what=timers / butterfly / stack。
- Lua 慢（哪一帧、哪个 Lua 函数、从哪个 UE 回调进来）：kind=trace lua=true，之后 query what=timers lua=true、what=tree luaOnly=true。ue_lua action=profile 只有平铺的总表，看不出帧和调用关系。
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
             lua=true 只看 Lua 计时器（含 C 函数，c=true），mergeC=true 把 C 函数的时间并进调用它的 Lua 函数；Lua 行带 src（文件:行）
  tree       自上而下的调用树（火焰图同一份数据）：root 写计时器名字或 id 只看它往下，luaOnly=true 从最外层的 Lua 函数开始（各线程合并；给了 root 时不起作用），mergeC 同上；
             每层只留最热的几支，more 是没列出的个数，要细看某一支就拿它的 id 当 root 再查（timers 的 lua / mergeC 和 tree 要 UELink 2.9 起）
  butterfly  调用者 / 被调用者：timer 写计时器的名字或 id，callers 是谁调了它，callees 是它里面调了谁
  instances  一个计时器每次调用的统计（次数、最短 / 平均 / 中位 / 最长）和最慢的几次在哪（timer 同上）：区分「每次都慢」和「偶尔一次特别慢」
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
    '性能和内存抓取（对着正在运行的 UE）。action=live 看最近几秒的实时读数（seconds，和 stat unit 同源，不留文件）；action=start 开始：kind=trace 录 Unreal Insights 同款 trace（每个线程的函数调用堆栈和计时器，preset 选通道组合，custom 时 channels 自选通道，lua 叠加录 Lua 函数，seconds 时长上限，0 不限），kind=csv 是 CSV Profiler（每帧耗时），kind=memreport 抓一份内存报告（马上完成）；action=mark 打书签（name）；action=stop 停止 trace / CSV 并返回抓取 id；action=status 看进行中的抓取；action=help 看用法和怎么选。抓到的文件用 ue_capture 分析。',
    {
      action: { type: 'string', enum: ['live', 'start', 'stop', 'mark', 'status', 'help'] },
      kind: { type: 'string', enum: ['trace', 'csv', 'memreport'] },
      preset: {
        type: 'string',
        enum: ['standard', 'named', 'gpu', 'loading', 'memtag', 'net', 'animation', 'task', 'object', 'custom'],
      },
      channels: { type: 'string' },
      seconds: { type: 'number' },
      named: { type: 'boolean' },
      lua: { type: ['boolean', 'string'], enum: [true, false, 'noc'] },
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
              seconds: a.seconds,
              label: str(a.label),
              preset: str(a.preset),
              channels: str(a.channels),
              named: a.named === true,
              lua: a.lua,
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
    '分析性能和内存抓取文件（UE 不在运行也能用）。action=list 列出抓取；summary 看一份的摘要（id）；query 下钻（id + what，trace：frames / timers（lua=true 只看 Lua）/ tree（调用树，luaOnly）/ butterfly / instances / stack / threads / log / bookmarks / counters，CSV：hitches / columns / column / frame / segment，memreport：objects / section / textures 等）；compare 对比两份同类抓取（id 先抓的、other 后抓的，查内存泄漏用两份 memreport）；import 登记外部文件（path）；delete 删除（每次请用户确认）；action=help 看每种 what 的参数。结果先摘要再细节，不会返回整份文件。',
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
      root: { type: ['number', 'string'] },
      lua: { type: 'boolean' },
      luaOnly: { type: 'boolean' },
      mergeC: { type: 'boolean' },
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
