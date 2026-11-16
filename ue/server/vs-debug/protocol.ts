/**
 * UEToVS 0.8.0 的 VS 调试控制协议（UEToVS 仓库 docs/design/VS-调试控制.md、src/UEToVS.Host/Logic/Debugging/DebugProtocol.cs）。
 * 只放常量和类型：管道客户端、工具、网页路由都按这一份走，协议升级时只改这里
 */
export const PROTOCOL = 1

/** 管道名前缀（后面是 devenv 的 PID）：只用来核对发现文件，连接时用文件里的 pipe 原样拼 */
export const PIPE_PREFIX = 'UEToVS.Debug.'

/** wait 最多阻塞多久（和 UEToVS 一致） */
export const MAX_WAIT_MS = 120000

export const SESSION_OPS = [
  'status',
  'start',
  'stop',
  'restart',
  'attach',
  'build',
  'pause',
  'continue',
  'step',
  'wait',
] as const
export const BP_OPS = ['bp.list', 'bp.add', 'bp.remove', 'bp.enable', 'bp.clear'] as const
export const INSPECT_OPS = ['stack', 'threads', 'locals', 'eval', 'output', 'dump'] as const

/** 请求 / 应答的全部 op；subscribe 是推送连接、不是一问一答，不在这里（网页靠现有的状态刷新） */
export const OPS: readonly string[] = [...SESSION_OPS, ...BP_OPS, ...INSPECT_OPS]
export const isKnownOp = (op: string) => OPS.includes(op)

/** 发现文件 <解决方案目录>/.vs/UEToVS/Debug/endpoint.json */
export interface Endpoint {
  protocol: number
  pipe: string
  pid?: number
  token: string
  solution?: string
  solutionDir?: string
  project?: string
  uetovs?: string
  vs?: string
  startedUtc?: string
}

export type VsDebugReason = 'no-vs' | 'connect-failed' | 'protocol' | 'error'

/**
 * VS 调试出的错：reason 给网页卡片分情况显示（和 VsDebugState.reason 同一套），message 是中文、写清楚怎么办，原样给用户和 Agent。
 * 不继承 instances.ts 的 BridgeError：instances.ts 要反过来 import 这里拼「停在断点」的提示，继承会成循环依赖
 */
export class VsDebugError extends Error {
  // 不用参数属性：单测用 Node 自带的去类型直接跑 .ts，不支持这种写法
  readonly reason: VsDebugReason
  constructor(message: string, reason: VsDebugReason = 'error') {
    super(message)
    this.reason = reason
  }
}
