import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { pipeOne, howToEnable, READ_TIMEOUT_MS, type CallOpts } from './client.ts'
import { findEndpoint, findSolution, ENDPOINT_REL } from './discover.ts'
import { sameFile } from './instances.ts'
import { MAX_WAIT_MS, VsDebugError } from './protocol.ts'

/** 按项目找到发现文件再发请求：工具、网页路由、状态都从这里进 */

/** 测试里把管道路径换成本地 socket（发现文件里的 pipe 名 → 路径） */
let pipeOverride: ((pipe: string) => string) | undefined
export function setPipeOverride(fn: ((pipe: string) => string) | undefined) {
  pipeOverride = fn
}

/** 只有 Windows 有命名管道；单测换了管道路径时也算能用 */
export const pipeSupported = () => process.platform === 'win32' || !!pipeOverride

/** 有替换时的管道路径（没替换返回空，客户端按发现文件拼 \\.\pipe\…） */
export const overridePath = (pipe: string) => (pipeOverride ? { pipePath: pipeOverride(pipe) } : {})

export async function endpointOf(p: UeProject) {
  if (!pipeSupported()) throw new VsDebugError(t('通过 VS 调试 UE 只支持 Windows'), 'no-vs')
  const found = await findEndpoint(p)
  if (!found)
    throw new VsDebugError(
      t('VS 的调试控制没开（解决方案旁边没有 {file}）：{how}', { file: ENDPOINT_REL, how: howToEnable() }),
      'no-vs',
    )
  // 外层目录的发现文件可能是别的项目的 VS（项目和解决方案都对不上）：不能拿它调试这个项目
  const ep = found.endpoint
  if (ep.project && p.uproject && !sameFile(ep.project, p.uproject) && ep.solution) {
    const mine = await findSolution(p)
    if (mine && !sameFile(ep.solution, mine))
      throw new VsDebugError(
        t('VS 开着的是别的项目（{other}），没开这个项目：{how}', { other: ep.solution, how: howToEnable() }),
        'no-vs',
      )
  }
  return found
}

const num = (v: unknown) =>
  v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v)

/** 会在 VS 里阻塞的 op 各自的默认等待（协议第 4 节） */
const DEFAULT_WAIT: Record<string, number> = { wait: 30000, step: 10000, pause: 5000 }

/**
 * 读应答的超时：wait / step / pause / continue / build 会在 VS 里等到停下或编译完，按它们的 timeoutMs / waitMs 再加 5 秒；
 * 存完整转储（几 GB）给 2 分钟；其余 15 秒
 */
export function readTimeoutFor(op: string, args: Record<string, unknown>) {
  if (op === 'dump') return MAX_WAIT_MS
  const ms = num(args.timeoutMs) ?? num(args.waitMs) ?? DEFAULT_WAIT[op] ?? 0
  return Math.max(READ_TIMEOUT_MS, Math.min(ms, MAX_WAIT_MS) + 5000)
}

export async function vsCall(p: UeProject, op: string, args: Record<string, unknown> = {}, opts: CallOpts = {}) {
  const { endpoint } = await endpointOf(p)
  return pipeOne(endpoint, op, args, {
    readTimeoutMs: readTimeoutFor(op, args),
    ...overridePath(endpoint.pipe),
    ...opts,
  })
}
