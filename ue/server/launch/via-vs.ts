import { vsCall, pipeSupported } from '../vs-debug/connect.ts'
import { findEndpoint } from '../vs-debug/discover.ts'
import type { UeProject, VsDebugStatus } from '../types.ts'
import { c, t } from '../util.ts'
import type { LaunchPoll, LaunchSource } from './track.ts'

/**
 * 「启动编辑器」先看 VS 开没开着这个项目的解决方案（用户 2026-11-18）：开着、并且 UEToVS 的调试控制连得上，
 * 就让 VS 按 F5 启动（带调试器，编辑器崩了直接停在 VS 里），不然照旧直接起 UnrealEditor。
 * 只认 UEToVS 0.8.0 起的调试控制管道（server/vs-debug/）：没装 UEToVS、版本旧、设置里关了，都当作 VS 没开，走直接启动。
 * 连得上但 VS 拒绝启动（正在编译、已经在调试）就把原因报出来，不悄悄换成直接启动：那样会和 VS 那边的启动撞成两个编辑器
 */

/** 探 VS 时的时限：VS 没开（管道不在）立刻失败；开着但卡住时不能把启动按钮拖太久 */
const PROBE_MS = 1500

/** 插件参数「启动编辑器」：默认 VS 开着就经 VS 启动 */
export const launchViaVsOn = () => c().config().launchVia !== 'direct'

const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()

/**
 * VS 开着这个项目、能经它启动时返回 VS 的状态；VS 没开、连不上、开的是别的项目返回空（调用方直接启动）。
 * VS 已经在编译或调试时报错：这时直接起一个会和 VS 那边的编辑器撞上
 */
export async function vsLaunchable(p: UeProject): Promise<VsDebugStatus | undefined> {
  if (!launchViaVsOn() || !pipeSupported()) return undefined
  const found = await findEndpoint(p)
  if (!found) return undefined
  // 外层解决方案可能是别的项目的 VS 开着：发现文件写着别的 .uproject 就不经它启动
  if (found.endpoint.project && norm(found.endpoint.project) !== norm(p.uproject)) return undefined
  const st = (await vsCall(p, 'status', { frames: 0 }, { connectTimeoutMs: PROBE_MS, readTimeoutMs: PROBE_MS }).catch(
    () => undefined,
  )) as unknown as VsDebugStatus | undefined
  if (!st) return undefined
  if (st.building) throw new Error(t('VS 正在编译：等它编完再启动编辑器（编完 VS 也可以直接按 F5）'))
  if (st.launchPending || st.mode !== 'design') {
    const pid = st.processes?.[0]?.pid
    throw new Error(
      pid
        ? t('VS 已经在调试 UE（PID {pid}）：等它起来自动连上；要重新启动先在 VS 里停止调试', { pid })
        : t('VS 正在启动 UE：等它起来自动连上，不用再启动一个'),
    )
  }
  return st
}

/** F5 的参数：解决方案配置不是编辑器配置、启动项目不是这个项目时顺手改对，不然 F5 起的不是这个项目的编辑器 */
export function vsStartArgs(p: UeProject, st: VsDebugStatus) {
  const args: Record<string, unknown> = {}
  if (st.configuration && !/editor/i.test(st.configuration)) args.configuration = 'Development Editor'
  if (p.uname && st.startupProject && st.startupProject.toLowerCase() !== p.uname.toLowerCase()) args.project = p.uname
  return args
}

/** VS 状态里被调试的编辑器进程：优先名字像 UnrealEditor 的 */
const editorProc = (st: VsDebugStatus) => st.processes?.find((x) => /unrealeditor/i.test(x.name)) ?? st.processes?.[0]

/** 连续这么多秒连不上 VS 就算 VS 关了（每秒问一次） */
const LOST_S = 20
/** 连续这么多秒 VS 回到不在调试、也没在编译和等启动，就算没起来 */
const IDLE_S = 3

/**
 * 让 VS 按 F5 并返回启动进度的来源（track.ts 每秒问一次 VS 的状态）：
 * VS 先编译（显示「VS 编译中」），编完起编辑器（这时才有 PID），之后和直接启动一样读日志认阶段、等名片就绪。
 * VS 回到不在调试的状态：见过编辑器进程算编辑器退出了，编译失败算编译失败，都报错
 */
export async function startViaVs(p: UeProject, st: VsDebugStatus): Promise<LaunchSource> {
  await vsCall(p, 'start', vsStartArgs(p, st))
  let seenBuild = false
  let seenPid = 0
  let idle = 0
  let lost = 0
  const poll = async (): Promise<LaunchPoll> => {
    let s: VsDebugStatus
    try {
      s = (await vsCall(
        p,
        'status',
        { frames: 0 },
        { connectTimeoutMs: PROBE_MS, readTimeoutMs: 3000 },
      )) as unknown as VsDebugStatus
      lost = 0
    } catch {
      // VS 卡着（编译出错弹「要不要继续」的对话框时 UI 线程不回应）先等着；一直连不上算 VS 关了
      if (++lost >= LOST_S) return { failed: t('VS 连不上了（关掉了或卡住）：在 VS 里看看，或改成直接启动') }
      return { waiting: 'vs' }
    }
    if (s.building) {
      seenBuild = true
      idle = 0
      return { building: true }
    }
    const proc = editorProc(s)
    if (proc) seenPid = proc.pid
    if (s.mode !== 'design' || s.launchPending) {
      idle = 0
      return { pid: proc?.pid }
    }
    if (++idle < IDLE_S) return {}
    if (seenPid)
      return {
        failed: t('经 VS 启动的编辑器退出了（PID {pid}），看 Saved/Logs 里的日志和 VS 的输出窗口', { pid: seenPid }),
      }
    if (seenBuild && s.lastBuildFailed) return { failed: t('VS 编译失败：看 VS 的错误列表，改好后再启动') }
    return { failed: t('VS 没有启动编辑器（可能编译失败或被取消）：看 VS 的输出窗口') }
  }
  return { via: 'vs', poll }
}
