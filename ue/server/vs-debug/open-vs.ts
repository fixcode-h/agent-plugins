import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { howToEnable, pipeOne } from './client.ts'
import { endpointOf, overridePath, pipeSupported, vsCall } from './connect.ts'
import { findSolution } from './discover.ts'
import { listVsInstances, vsSituation } from './instances.ts'
import { SOLUTION_OPEN, VsDebugError } from './protocol.ts'
import { findDevenv } from './vswhere.ts'

/**
 * 用 VS 打开这个项目，等 UEToVS 写出发现文件、管道连得通再返回（连通后卡片随状态刷新自动连上）：
 * - 默认新开一个 VS（devenv <解决方案> 分离启动）
 * - into = 某个开着别的项目的 VS 的 PID 时，让那个 VS 换成这个解决方案（UEToVS 0.9.5 的 solution.open）
 * VS 已经开着这个项目但没有调试控制时不再开第二个 VS，报错说明去 VS 里开设置。
 * VS 加载 UE 的大解决方案要一两分钟：最多等 3 分钟，按退避间隔有限次地检查（不是无限轮询），同一项目同时只开一次
 */
export const OPEN_WAIT_MS = 180000
/** 检查间隔：开头密一点（VS 已经在开的情况很快就好），后面放宽 */
export const BACKOFF_MS = [
  1000, 2000, 3000, 5000, 5000, 10000, 10000, 15000, 15000, 20000, 20000, 20000, 20000, 20000, 20000,
]

const opening = new Map<string, Promise<OpenResult>>()

export interface OpenOpts {
  /** 在这个 PID 的 VS 里打开；不给就新开一个 VS */
  into?: number
}

export interface OpenResult {
  ok: true
  /** 这次是不是新开了 VS（false = 本来就开着） */
  opened: boolean
  solution?: string
}

/** 管道现在通不通：通了返回 true；文件不在、连不上返回 false，其余错误（协议版本不对）照抛 */
async function reachable(p: UeProject) {
  try {
    await endpointOf(p)
    await vsCall(p, 'status', { frames: 0 }, { readTimeoutMs: 5000 })
    return true
  } catch (e) {
    const reason = (e as VsDebugError).reason
    if (reason === 'no-vs' || reason === 'connect-failed') return false
    throw e
  }
}

export function openVs(p: UeProject, opts: OpenOpts = {}): Promise<OpenResult> {
  const running = opening.get(p.id)
  if (running) return running
  const job = doOpen(p, opts).finally(() => opening.delete(p.id))
  opening.set(p.id, job)
  return job
}

async function doOpen(p: UeProject, opts: OpenOpts): Promise<OpenResult> {
  if (!pipeSupported()) throw new VsDebugError(t('通过 VS 调试 UE 只支持 Windows'), 'no-vs')
  if (await reachable(p)) return { ok: true, opened: false }
  const solution = await findSolution(p)
  if (!solution)
    throw new VsDebugError(
      t(
        '项目目录和外层目录里都没找到 .sln：先生成 VS 工程（右键 .uproject →「Generate Visual Studio project files」）再打开',
      ),
      'no-vs',
    )
  const failed = opts.into !== undefined ? await switchInto(opts.into, solution) : await spawnNew(solution)
  await waitReady(p, solution, failed, opts.into !== undefined)
  return { ok: true, opened: true, solution }
}

/** 让开着别的项目的 VS 换成这个解决方案：VS 先回应答再切换，有没保存的文件时 VS 会弹保存提示 */
async function switchInto(pid: number, solution: string) {
  const inst = (await listVsInstances()).find((i) => i.pid === pid)
  if (!inst) throw new VsDebugError(t('那个 VS 已经关了或换了项目：重新点「用 VS 打开这个项目」再选一次'), 'no-vs')
  await pipeOne(
    inst.endpoint,
    SOLUTION_OPEN,
    { path: solution },
    {
      readTimeoutMs: 10000,
      ...overridePath(inst.endpoint.pipe),
    },
  )
  return () => ''
}

/** 新开一个 VS；返回取启动错误的函数（spawn 的 error 事件是异步来的，等就绪时顺带看） */
async function spawnNew(solution: string): Promise<() => string> {
  // VS 开着这个项目只是连不上调试控制时，再开一个 VS 也连不上，还多一个窗口
  if ((await vsSituation(solution)).openWithoutControl)
    throw new VsDebugError(
      t(
        'VS 已经开着这个项目（{sln}），只是连不上它的调试控制，不再开第二个 VS：确认装的是 UEToVS 0.8.0 以上，并且 VS 里 UEToVS 设置「MCP > 允许 Agent 通过 VS 调试 UE」开着，改完重新打开解决方案',
        { sln: solution },
      ),
      'no-control',
    )
  const devenv = await findDevenv()
  if (!devenv)
    throw new VsDebugError(
      t('没找到 Visual Studio（vswhere 没找到 devenv.exe）：装好 VS 2022 后再试，或者自己打开 {sln}', {
        sln: solution,
      }),
      'no-vs',
    )
  let spawnError = ''
  try {
    const child = spawn(devenv, [solution], { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', (e) => (spawnError = e.message))
    child.unref()
  } catch (e) {
    throw new VsDebugError(t('启动 VS 失败：{msg}', { msg: (e as Error).message }), 'no-vs')
  }
  return () => spawnError
}

async function waitReady(p: UeProject, solution: string, failed: () => string, switched: boolean) {
  const deadline = Date.now() + OPEN_WAIT_MS
  for (const delay of BACKOFF_MS) {
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())))
    const err = failed()
    if (err) throw new VsDebugError(t('启动 VS 失败：{msg}', { msg: err }), 'no-vs')
    if (await reachable(p)) return
    if (Date.now() >= deadline) break
  }
  throw new VsDebugError(
    switched
      ? t(
          '已经让那个 VS 打开 {sln}，但 3 分钟内调试控制还没就绪：如果在 VS 的保存提示里点了取消，VS 不会换项目；否则等 VS 加载完解决方案再试，一直不行就{how}',
          { sln: solution, how: howToEnable() },
        )
      : t('已经打开 VS（{sln}），但 3 分钟内调试控制还没就绪：等 VS 加载完解决方案再试；一直不行就{how}', {
          sln: solution,
          how: howToEnable(),
        }),
    'no-vs',
  )
}
