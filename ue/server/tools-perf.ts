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
import { exportTrace } from './perf/export.ts'
import { recordTrace, waitCapture } from './perf/record.ts'
import { traceAgentQuery, traceDiagnose, traceSummary } from './perf/trace-agent.ts'
import { traceCompare } from './perf/trace-compare.ts'
import { str, TARGET, tool } from './toolkit.ts'
import { clip, mcpText, t } from './util.ts'

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
action=mark   往正在进行的 trace / CSV 抓取里打书签（name），分析时可以按书签切段、用书签名当 from / to；shot=true 同时截一张视口图（分析时 what=screenshots）
action=stop   停止 trace / CSV 抓取，返回抓取 id
action=status 看有没有正在进行的抓取
action=record 一次调用录完一段 trace：按 steps 顺序执行再停止，并等分析完（waitMs，默认 60000，最多 120000）。preset / lua / label / channels 同 start，seconds 是上限（默认 steps 里 wait 之和 + 60）
  steps 例：[{"mark":"开始"},{"console":"ce SpawnWave"},{"wait":8},{"gm":"OpenBag","args":[1]},{"wait":3},{"mark":"结束","shot":true}]
  每项写一个：console（控制台命令）/ gm（C++ GM 名，args 参数）/ mark（书签名，shot 截图）/ wait（秒，最多 600）。某步失败不中断，结果里 steps 标出
action=wait   有 id：等这份 trace 分析完（timeoutMs，默认 30000，最多 120000）；没 id：等正在进行的录制停下

怎么选：
- 卡顿、帧率低、要知道慢在哪个函数：kind=trace。能用命令复现的场景用 action=record 一次录完；要人操作的 start → mark → stop。之后 ue_capture action=diagnose → query 深挖。
- Lua 慢（哪一帧、哪个 Lua 函数、从哪个 UE 回调进来）：kind=trace lua=true，之后 query what=timers lua=true、what=tree luaOnly=true。ue_lua action=profile 只有平铺的总表，看不出帧和调用关系。
- 长时间看走势（跑一整局）、对比两个版本：kind=csv，文件小，能录很久。
- 内存高、怀疑泄漏：kind=memreport。在同一个场景进出一次，前后各抓一份，用 ue_capture compare 看哪些类只涨不回。
- 先看大概：action=live，看帧率、哪个线程最慢、内存多少，不留文件。
- CSV 只说明「哪些帧、哪一类慢」，定位不到具体函数；要函数用 trace。
- trace 由编辑器（没开时后台编辑器）用 UE 自己的 TraceServices 分析，停止后第一次查要等几秒到几十秒：返回 analyzing 时用 action=wait id=… 等，不要反复查。
- 内存分配（谁分配的、调用栈）要 UE 用 -trace=memory 启动，中途开不了；LLM 标签（memtag 预设）要 -llm 启动。

注意：Shipping 构建里没有 CSV Profiler；PIE 里客户端和服务器在同一个进程，抓到的是整个进程的数据。`

const CAPTURE_HELP = `ue_capture：分析抓到的文件（UE 不在运行也能用）。id 可以写抓取 id、起的名字或文件名。

action=list     列出抓取（kind 可筛 csv / memreport / trace）；包括手动在 UE 里抓的
action=summary  一份抓取的摘要
action=diagnose trace 的诊断：帧率、瓶颈线程、卡顿按元凶分组、热点、Lua、内存涨幅、日志警告，每条带 impactMs（摊到每帧的毫秒）排好序，drill 是可以并行深挖的方向。from / to 限定范围，targetMs 目标帧时间（默认 16.67）
action=query    下钻，what 见下
action=compare  两份同类抓取的差异（id 是先抓的，other 是后抓的）。trace 按每帧平均比：帧时间、各线程、瓶颈、卡顿元凶、变慢 / 变快最多的计时器（from / to 写书签名时两份各按自己的书签对齐）
action=export   trace 的完整数据写成文件，只回路径：what=frames（每帧一行，含各线程忙的毫秒）/ timers / counters（name 逗号分隔）/ log，format=csv（默认）/ json
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

trace 的 what（范围是秒，耗时是毫秒；列表都能 top / offset 翻页）：
  概览    frames（帧统计和最慢的帧，type=render 看渲染帧，thresholdMs）/ frame（frame=<帧号> 一帧的全貌：各线程、瓶颈、比普通帧涨了什么、附近日志）
          hitches（卡顿帧，按元凶分组、成簇、是否周期性，每帧带比普通帧涨得最多的计时器；thresholdMs 门槛，默认中位帧×2 且 ≥33ms，attribute 归因几帧）
          bound（每帧瓶颈线程分布和连续段）/ threads（各线程每帧平均、P95、占帧比例；list=true 只列线程）
  计时器  timers（name 筛，sort=incl / count / max，lane 只看某条线程，perFrame=true 给每帧平均；lua=true 只看 Lua，mergeC=true C 函数并进调用者）
          tree（调用树：root 从某个计时器往下，luaOnly，lane）/ butterfly（timer：callers 谁调它、callees 它调了谁）
          instances（timer 每次调用的统计和最慢几次在第几帧）/ stack（lane + time 或 frame：那一刻的调用堆栈，depth 选层）
          events（lane 一段时间里的块，按耗时排：范围最多 10 秒，name、minMs、depth 筛）
  其他    counters（不写 name 列出带统计的计数器，sort=growth 找一直涨的；写 name 看走势，points 段数）/ log（verbosity=Warning 只看警告以上，near=<秒> 看那一刻前后 window 秒）/ bookmarks
          session（录了哪些数据、命令行、平台）/ regions（区间）/ memtags（LLM 标签内存，name 看走势）/ allocs（at=<秒> 那一刻活着的分配，或 from / to 之间新增未释放的；groupBy=tag / callstack / size）
          loads（加载的包和类型，sort=time / size）/ files（文件读写）/ tasks（任务执行和排队，sort=wait）/ switches（线程真正在 CPU 上跑的时间）/ net（各连接收发流量）
          screenshots / screenshot（录制时 mark shot=true 截的图，index 取一张的路径）
  范围    from / to（秒数或书签名）、frame=<帧号>、frames="120-180"
  线程    lane 写线程名或泳道 id，逗号分隔可写多个；名字对得上好几条时报错列出候选
  session 以后的几类和 framestats 归因要分析用的 UELink 2.11 起；没录对应通道时会说要开什么
读数提示：时间类的列单位是毫秒；memreport 的大小是 KB；ResExcKB 是对象持有的资源（贴图、网格数据）的大小，通常比 NumKB 更能说明问题。`

/** 性能结果是大段数字：紧凑 JSON（不缩进）省一半字数，同样的 12000 字上限能多放不少（设计稿 4.4） */
const out = (data: unknown) => mcpText(clip(typeof data === 'string' ? data : JSON.stringify(data)))

export const PERF_DEFS = [
  tool(
    'ue_perf',
    '性能和内存抓取（对着正在运行的 UE）。action=live 看最近几秒的实时读数；start 开始录（kind=trace / csv / memreport，preset 选通道，lua 叠加录 Lua，seconds 上限，0 不限）；mark 打书签（name，shot=true 同时截图）；stop 停止并返回抓取 id；record 按 steps（console / gm / mark / wait）一次录完并等分析好；wait 等录制停或等某份 trace（id）分析完；status 看进行中的抓取；help 看用法和怎么选。抓到的文件用 ue_capture 分析。',
    {
      action: { type: 'string', enum: ['live', 'start', 'stop', 'mark', 'record', 'wait', 'status', 'help'] },
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
      shot: { type: 'boolean' },
      steps: { type: 'array', items: { type: 'object' } },
      waitMs: { type: 'number' },
      timeoutMs: { type: 'number' },
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
          return out(await markCapture(ctx, str(a.name), a.shot === true))
        case 'record':
          return out(await recordTrace(ctx, a))
        case 'wait': {
          const id = str(a.id)
          return out(
            await waitCapture(ctx, id ? (await getCapture(ctx.project, id)).id : '', Number(a.timeoutMs) || 30000),
          )
        }
        case 'status':
          return out(await captureStatus(ctx))
        default:
          return out(PERF_HELP)
      }
    },
  ),
  tool(
    'ue_capture',
    '分析性能和内存抓取文件（UE 不在运行也能用）。action=list 列出抓取；summary 摘要（id）；diagnose 诊断 trace：排好序的问题（impactMs）和可并行深挖的方向（drill）；query 下钻（id + what，trace：frames / frame / hitches / bound / threads / timers / tree / butterfly / instances / stack / events / counters / log / session / memtags / allocs / loads / tasks 等；CSV：hitches / columns / column / frame / segment；memreport：objects / section 等）；compare 对比两份（id 先、other 后；trace 按每帧平均比）；export 把 trace 完整数据写成 CSV / JSON 文件只回路径；import 登记外部文件；delete 删除（请用户确认）；help 看每种 what 的参数。',
    {
      action: {
        type: 'string',
        enum: ['list', 'summary', 'diagnose', 'query', 'compare', 'export', 'import', 'delete', 'help'],
      },
      id: { type: 'string' },
      other: { type: 'string' },
      kind: { type: 'string', enum: ['csv', 'memreport', 'trace'] },
      what: { type: 'string' },
      name: { type: 'string' },
      frame: { type: 'number' },
      frames: { type: 'string' },
      from: { type: ['number', 'string'] },
      to: { type: ['number', 'string'] },
      sort: { type: 'string' },
      filter: { type: 'string' },
      contains: { type: 'string' },
      thresholdMs: { type: 'number' },
      targetMs: { type: 'number' },
      timer: { type: ['number', 'string'] },
      root: { type: ['number', 'string'] },
      lane: { type: ['number', 'string'] },
      lua: { type: 'boolean' },
      luaOnly: { type: 'boolean' },
      mergeC: { type: 'boolean' },
      perFrame: { type: 'boolean' },
      type: { type: 'string', enum: ['game', 'render'] },
      time: { type: 'number' },
      at: { type: 'number' },
      near: { type: 'number' },
      verbosity: { type: 'string' },
      groupBy: { type: 'string', enum: ['tag', 'callstack', 'size'] },
      depth: { type: 'number' },
      format: { type: 'string', enum: ['csv', 'json'] },
      top: { type: 'number' },
      offset: { type: 'number' },
      path: { type: 'string' },
      label: { type: 'string' },
    },
    ['action'],
    async (a, ctx) => {
      const p = ctx.project
      const trace = async () => {
        const cap = await getCapture(p, str(a.id))
        if (cap.kind !== 'trace')
          throw new BridgeError(t('{action} 只用于 trace（.utrace）', { action: str(a.action) }))
        return cap
      }
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
        case 'diagnose':
          return out(await traceDiagnose(ctx, (await trace()).id, a))
        case 'query': {
          const cap = await getCapture(p, str(a.id))
          if (cap.kind === 'trace') return out(await traceAgentQuery(ctx, cap.id, a))
          return out(await captureQuery(p, cap.id, a))
        }
        case 'compare': {
          const cap = await getCapture(p, str(a.id))
          if (cap.kind === 'trace') {
            const other = await getCapture(p, str(a.other))
            if (other.kind !== 'trace') throw new BridgeError(t('compare 的两份要是同一类（都是 trace）'))
            return out(await traceCompare(ctx, cap.id, other.id, a))
          }
          return out(await captureCompare(p, str(a.id), str(a.other), Number(a.top) || undefined))
        }
        case 'export':
          return out(await exportTrace(ctx, (await trace()).id, a))
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
