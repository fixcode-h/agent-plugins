import { Hourglass, Loader2 } from 'lucide-react'
import type { Instance, ProjectState } from '../../server/types.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'

/**
 * 编辑器忙（进程活着，UELink 几秒没回应：游戏线程卡在同步加载、编译着色器、断点里）的显示。
 * 用户 2026-11-16：这时网页显示「1 个进程连不上」「UE 没在运行」并提示再启动编辑器，其实它只是在忙。
 * 忙不是断开：不提示启动、不起后台编辑器，等它回应后状态自己变回「已连接」（状态本来就在定时刷新）
 */

/** 忙着的、有游戏世界的进程（编辑器 / 游戏 / 服务器，不算后台编辑器） */
export const busyOf = (s: ProjectState | undefined) =>
  (s?.instances ?? []).filter((i) => i.kind !== 'background' && !i.online && i.busy)

/** 在忙什么，一句话（左栏目标卡、实例列表、空页面共用） */
export function busyWhat(i: Instance) {
  const b = i.busy
  if (!b) return ''
  // 心跳说整个进程停住（UELink 2.25）：日志尾巴是停住前的旧内容，不按它猜「在加载」
  if (b.state === 'frozen') return t('整个进程停住了，多半停在调试器断点上')
  const d = b.detail ?? ''
  switch (b.kind) {
    case 'map':
      return d ? t('在加载地图 {d}', { d }) : t('在加载地图')
    case 'shaders':
      return d ? t('在编译着色器，还剩 {d} 个', { d }) : t('在编译着色器')
    case 'assets':
      return d ? t('在加载资源 {d}', { d }) : t('在加载资源')
    case 'ddc':
      return t('在读派生数据缓存（DDC）')
    case 'registry':
      return t('在扫描资源')
    case 'compile':
      return t('在编译代码')
    case 'save':
      return d ? t('在保存 {d}', { d }) : t('在保存资源')
    default:
      // 心跳回了、日志里又认不出在做什么：游戏线程卡住，进程还在
      return b.state === 'gameThread' ? t('游戏线程卡住了，进程还在') : t('可能在加载')
  }
}

/** 没回应多久了（秒），按状态刷新的时间算，不另起计时器 */
export const busySec = (i: Instance) => (i.busy ? Math.max(0, Math.round((Date.now() - i.busy.since) / 1000)) : 0)

/** 目标卡、实例行上的一行：「忙 · 12 秒没回应 · 在加载地图 /Game/Maps/Main」 */
export const busyLine = (i: Instance) => t('{s} 秒没回应 · {what}', { s: busySec(i), what: busyWhat(i) })

/**
 * 空页面的「编辑器忙」版：页面要连着 UE 才能用、而编辑器正忙时显示，代替「UE 没在运行」。
 * 不给启动按钮（编辑器开着，再起一个会抢项目），说清楚在忙什么、等它就好
 */
export function EditorBusy({ inst }: { inst: Instance }) {
  const { go } = useUe()
  const b = inst.busy
  return (
    <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-6">
      <div className="ue:flex ue:max-w-lg ue:flex-col ue:items-center ue:gap-3 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:px-8 ue:py-8 ue:text-center">
        <span className="ue:flex ue:h-11 ue:w-11 ue:items-center ue:justify-center ue:rounded-xl ue:bg-run-soft ue:text-run">
          <Hourglass className="ue:h-5 ue:w-5" strokeWidth={1.75} />
        </span>
        <h2 className="ue:flex ue:items-center ue:gap-2 ue:text-heading ue:font-medium ue:text-fg">
          <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin ue:text-subtle" />
          {t('编辑器忙，暂时没有回应')}
        </h2>
        <p className="ue:text-body ue:leading-relaxed ue:text-subtle">
          {t('PID {pid} 还在运行，{what}。等它忙完会自动连上，不用重新启动编辑器。', {
            pid: inst.pid,
            what: busyWhat(inst),
          })}
        </p>
        <p className="ue:text-footnote ue:text-subtle">
          {t('已经 {s} 秒没回应', { s: busySec(inst) })}
          {b?.quietSec !== undefined && b.quietSec >= 5 && ` · ${t('日志 {q} 秒没有新内容', { q: b.quietSec })}`}
        </p>
        {b?.line && (
          <code
            title={b.line}
            className="ue:block ue:max-w-full ue:truncate ue:rounded-md ue:bg-hover ue:px-2 ue:py-1 ue:font-mono ue:text-caption ue:text-muted"
          >
            {b.line}
          </code>
        )}
        <button
          type="button"
          onClick={() => go('logs')}
          className="ue:cursor-pointer ue:text-footnote ue:text-accent-text ue:hover:underline"
        >
          {t('看日志')}
        </button>
      </div>
    </div>
  )
}

/** 目标卡用：忙时的状态点颜色和文字 */
export function busyConn(s: ProjectState | undefined) {
  const list = busyOf(s)
  if (!list.length) return undefined
  const text =
    list.length > 1
      ? t('{n} 个进程忙', { n: list.length })
      : list[0].kind === 'editor'
        ? t('编辑器忙，等它回应')
        : t('进程忙，等它回应')
  return { tone: 'run' as const, text }
}

/** 实例行、目标卡副行用的忙碌说明（带转圈图标） */
export function BusyText({ inst }: { inst: Instance }) {
  const { cn } = h()
  return (
    <span className={cn('ue:flex ue:min-w-0 ue:items-center ue:gap-1')} title={inst.busy?.line}>
      <Loader2 className="ue:h-3 ue:w-3 ue:shrink-0 ue:animate-spin" />
      <span className="ue:truncate">{busyLine(inst)}</span>
    </span>
  )
}
