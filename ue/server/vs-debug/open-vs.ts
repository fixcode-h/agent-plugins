import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { howToEnable } from './client.ts'
import { endpointOf, vsCall } from './connect.ts'
import { findSolution } from './discover.ts'
import { VsDebugError } from './protocol.ts'
import { findDevenv } from './vswhere.ts'

/**
 * VS 没开时打开 VS（devenv <解决方案> 分离启动），等 UEToVS 写出发现文件、管道连得通再返回。
 * VS 加载 UE 的大解决方案要一两分钟：最多等 3 分钟，按退避间隔有限次地检查（不是无限轮询），同一项目同时只开一次
 */
export const OPEN_WAIT_MS = 180000
/** 检查间隔：开头密一点（VS 已经在开的情况很快就好），后面放宽 */
export const BACKOFF_MS = [
  1000, 2000, 3000, 5000, 5000, 10000, 10000, 15000, 15000, 20000, 20000, 20000, 20000, 20000, 20000,
]

const opening = new Map<string, Promise<OpenResult>>()

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

export function openVs(p: UeProject): Promise<OpenResult> {
  const running = opening.get(p.id)
  if (running) return running
  const job = doOpen(p).finally(() => opening.delete(p.id))
  opening.set(p.id, job)
  return job
}

async function doOpen(p: UeProject): Promise<OpenResult> {
  if (process.platform !== 'win32') throw new VsDebugError(t('通过 VS 调试 UE 只支持 Windows'), 'no-vs')
  if (await reachable(p)) return { ok: true, opened: false }
  const solution = await findSolution(p)
  if (!solution)
    throw new VsDebugError(
      t(
        '项目目录和外层目录里都没找到 .sln：先生成 VS 工程（右键 .uproject →「Generate Visual Studio project files」）再打开',
      ),
      'no-vs',
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
  const deadline = Date.now() + OPEN_WAIT_MS
  for (const delay of BACKOFF_MS) {
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())))
    if (spawnError) throw new VsDebugError(t('启动 VS 失败：{msg}', { msg: spawnError }), 'no-vs')
    if (await reachable(p)) return { ok: true, opened: true, solution }
    if (Date.now() >= deadline) break
  }
  throw new VsDebugError(
    t('已经打开 VS（{sln}），但 3 分钟内调试控制还没就绪：等 VS 加载完解决方案再试；一直不行就{how}', {
      sln: solution,
      how: howToEnable(),
    }),
    'no-vs',
  )
}
