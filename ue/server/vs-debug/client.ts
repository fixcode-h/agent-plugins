import net from 'node:net'
import { t } from '../util.ts'
import { PROTOCOL, VsDebugError, type Endpoint } from './protocol.ts'

/**
 * VS 调试控制管道的客户端：一个连接上按顺序发几行请求、读同样多行应答（协议第 3 节允许连发，按顺序应答）。
 * 每次调用新开一个连接、用完就关：VS 每次启动换令牌和管道名，长连接要处理重连，没必要。
 * 出错一律抛 VsDebugError，原样给用户和 Agent，不重试（面板硬规则）
 */
export interface PipeRequest {
  op: string
  args?: Record<string, unknown>
}

export type PipeReply = { ok: true; result: Record<string, unknown> } | { ok: false; error: string }

export interface CallOpts {
  /** 管道的完整路径；不给按发现文件拼 \\.\pipe\<pipe>。单测在 Linux 上换成 unix socket 路径 */
  pipePath?: string
  /** 连接超时，默认 2 秒 */
  connectTimeoutMs?: number
  /** 连上以后等应答的超时，默认 15 秒；wait / step 这类会阻塞的由调用方按 timeoutMs + 5 秒给 */
  readTimeoutMs?: number
}

export const CONNECT_TIMEOUT_MS = 2000
export const READ_TIMEOUT_MS = 15000

/** Windows 命名管道 \\.\pipe\<名字> */
export const pipePathOf = (pipe: string) => '\\\\.\\pipe\\' + pipe

/** 怎么让管道出现：开 VS、装对版本、打开设置。几种连不上的错误都接这一句 */
export const howToEnable = () =>
  t(
    '用 VS 打开这个项目的解决方案（UE 页「VS 调试」卡片的「用 VS 打开这个项目」，或 ue_vs_debug 的 start / attach / build 会自动打开），确认装的是 UEToVS 0.8.0 以上，并且 VS 里 UEToVS 设置「MCP > 允许 Agent 通过 VS 调试 UE」开着',
  )

let seq = 0

export function pipeCall(ep: Endpoint, reqs: PipeRequest[], opts: CallOpts = {}): Promise<PipeReply[]> {
  if (ep.protocol !== PROTOCOL)
    return Promise.reject(
      new VsDebugError(
        t('VS 里 UEToVS 的调试控制协议是 {got}，面板 UE 插件认的是 {want}：把 UEToVS 和面板的 UE 插件都升级到最新', {
          got: String(ep.protocol ?? '?'),
          want: PROTOCOL,
        }),
        'protocol',
      ),
    )
  const target = opts.pipePath ?? pipePathOf(ep.pipe)
  const ids = reqs.map(() => `p${++seq}`)
  const opsText = reqs.map((r) => r.op).join(', ')
  return new Promise((resolve, reject) => {
    const replies = new Map<string, PipeReply>()
    let connected = false
    let done = false
    let buf = ''
    const sock = net.connect(target)
    const finish = (err?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      if (err) reject(err)
      else resolve(ids.map((id) => replies.get(id)!))
    }
    const connectFailed = (msg: string) =>
      new VsDebugError(
        t('连不上 VS 的调试控制管道（{pipe}）：{msg}。VS 可能已经关了或崩了：{how}', {
          pipe: ep.pipe,
          msg,
          how: howToEnable(),
        }),
        'connect-failed',
      )
    let timer = setTimeout(
      () => finish(connectFailed(t('{s} 秒内没连上', { s: (opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS) / 1000 }))),
      opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    )
    sock.setEncoding('utf8')
    sock.on('connect', () => {
      connected = true
      clearTimeout(timer)
      const readMs = opts.readTimeoutMs ?? READ_TIMEOUT_MS
      timer = setTimeout(
        () =>
          finish(
            new VsDebugError(
              t('VS 在 {s} 秒内没有回应（{ops}）：VS 可能卡住了或正弹着对话框等你点，到 VS 里看一眼', {
                s: Math.round(readMs / 1000),
                ops: opsText,
              }),
            ),
          ),
        readMs,
      )
      sock.write(
        reqs
          .map(
            (r, i) => JSON.stringify({ v: PROTOCOL, id: ids[i], token: ep.token, op: r.op, args: r.args ?? {} }) + '\n',
          )
          .join(''),
      )
    })
    sock.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let o: { id?: string; ok?: boolean; result?: Record<string, unknown>; error?: string }
        try {
          o = JSON.parse(line)
        } catch {
          return finish(new VsDebugError(t('VS 回了无法解析的内容：{line}', { line: line.slice(0, 200) })))
        }
        if (!o.id || !ids.includes(o.id)) continue
        replies.set(
          o.id,
          o.ok ? { ok: true, result: o.result ?? {} } : { ok: false, error: o.error || t('VS 返回失败，没有说明原因') },
        )
        if (replies.size === ids.length) return finish()
      }
    })
    sock.on('error', (e: Error) =>
      finish(connected ? new VsDebugError(t('和 VS 的连接出错：{msg}', { msg: e.message })) : connectFailed(e.message)),
    )
    sock.on('close', () =>
      finish(
        connected
          ? new VsDebugError(t('VS 没回完就断开了连接（{ops}）：VS 可能刚关掉或重启了', { ops: opsText }))
          : connectFailed(t('连接被关闭')),
      ),
    )
  })
}

/** 只发一个请求：失败（ok=false）抛出 VS 给的中文原因 */
export async function pipeOne(ep: Endpoint, op: string, args: Record<string, unknown> = {}, opts: CallOpts = {}) {
  const [r] = await pipeCall(ep, [{ op, args }], opts)
  if (!r.ok) throw new VsDebugError(r.error)
  return r.result
}
