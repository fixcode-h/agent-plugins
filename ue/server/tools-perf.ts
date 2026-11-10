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
import { captureStatus, DEFAULT_SECONDS, markCapture, MAX_SECONDS, startCapture, stopCapture } from './perf.ts'
import { out, str, TARGET, tool } from './toolkit.ts'
import { t } from './util.ts'

/**
 * 性能和内存分析的两个工具（设计稿「性能与内存分析」第一期）：
 * ue_perf 对着正在运行的 UE 发起抓取，ue_capture 对着抓到的文件做摘要、查询和对比（UE 关了也能用）。
 * 原始文件不直接给 Agent：先摘要、再按条件下钻，结果限长。单独一个文件，tools.ts 只把它拼进工具列表。
 */
const PERF_HELP = `ue_perf：对着正在运行的 UE 抓性能和内存数据。抓到的文件用 ue_capture 分析。

action=start  开始抓取
  kind=csv        CSV Profiler：每帧的帧时间、各线程时间和各项统计。seconds 是时长上限（默认 ${DEFAULT_SECONDS}，最多 ${MAX_SECONDS}），到时间自动停
  kind=memreport  执行 memreport -full，马上得到一份内存报告（游戏会卡几秒），不用 stop
  label           给这份抓取起个名字，之后可以用名字代替 id
action=mark   往正在进行的 CSV 抓取里打书签（name），分析时可以按书签切段、用书签名当 from / to
action=stop   停止 CSV 抓取，返回抓取 id
action=status 看有没有正在进行的抓取

怎么选：
- 卡顿、帧率低：kind=csv。start → 用 ue_gm / ue_console 触发场景（前后各 mark 一下）→ stop → ue_capture summary。
- 内存高、怀疑泄漏：kind=memreport。在同一个场景进出一次，前后各抓一份，用 ue_capture compare 看哪些类只涨不回。
- 这个版本还不能抓 Unreal Insights 的 trace、GPU 分阶段耗时，也没有实时数值；CSV 只说明「哪些帧、哪一类慢」，定位不到具体函数。

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

trace（.utrace）这个版本只能登记，不能分析。
读数提示：时间类的列单位是毫秒；memreport 的大小是 KB；ResExcKB 是对象持有的资源（贴图、网格数据）的大小，通常比 NumKB 更能说明问题。`

export const PERF_DEFS = [
  tool(
    'ue_perf',
    '性能和内存抓取（对着正在运行的 UE）。action=start 开始：kind=csv 是 CSV Profiler（每帧耗时，seconds 时长上限，到时间自动停），kind=memreport 抓一份内存报告（马上完成）；action=mark 打书签（name）；action=stop 停止 CSV 抓取并返回抓取 id；action=status 看进行中的抓取；action=help 看用法和怎么选。抓到的文件用 ue_capture 分析。',
    {
      action: { type: 'string', enum: ['start', 'stop', 'mark', 'status', 'help'] },
      kind: { type: 'string', enum: ['csv', 'memreport'] },
      seconds: { type: 'number' },
      label: { type: 'string' },
      name: { type: 'string' },
      id: { type: 'string' },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      switch (a.action) {
        case 'start':
          return out(await startCapture(ctx, { kind: str(a.kind), seconds: Number(a.seconds), label: str(a.label) }))
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
    '分析性能和内存抓取文件（UE 不在运行也能用）。action=list 列出抓取；summary 看一份的摘要（id）；query 下钻（id + what，CSV：hitches / columns / column / frame / segment，memreport：objects / section / textures 等）；compare 对比两份同类抓取（id 先抓的、other 后抓的，查内存泄漏用两份 memreport）；import 登记外部文件（path）；delete 删除（每次请用户确认）；action=help 看每种 what 的参数。结果先摘要再细节，不会返回整份文件。',
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
        case 'summary':
          return out(await captureSummary(p, str(a.id)))
        case 'query':
          return out(await captureQuery(p, str(a.id), a))
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
