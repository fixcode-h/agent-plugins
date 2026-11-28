import { connect } from 'node:net'

/**
 * UELink 2.25 的心跳端口（名片 alivePort，UEKit docs/protocol.md 第 1 节）：在 UE 的监听线程上应答，不经过游戏线程。
 * /rpc、/info 超时后问它一次，分清三种情况（用户 2026-11-28：游戏线程卡死被当成无连接）：
 * - 回了一行：进程在、游戏线程卡住（lastTickAgoMs 是多久没走一帧）；
 * - 连上了却不回：整个进程停住（调试器断点，监听线程也停了）；
 * - 没有心跳端口（旧 UELink）或连不上：不知道，按原来的「忙」处理。
 */
export type AliveState = { state: 'gameThread'; tickAgoMs: number } | { state: 'frozen' }

export function probeAlive(port: number | undefined, timeoutMs = 600): Promise<AliveState | undefined> {
  if (!port) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let buf = ''
    let connected = false
    let done = false
    const finish = (v: AliveState | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      resolve(v)
    }
    const sock = connect({ host: '127.0.0.1', port })
    // 进程被调试器停住时内核照样完成握手（连接排在 backlog 里），只是没人回：连上了还等不到就是停住
    const timer = setTimeout(() => finish(connected ? { state: 'frozen' } : undefined), timeoutMs)
    sock.on('connect', () => (connected = true))
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      try {
        const body = JSON.parse(buf.slice(0, nl)) as { ok?: boolean; lastTickAgoMs?: number }
        finish(body.ok ? { state: 'gameThread', tickAgoMs: Math.max(0, body.lastTickAgoMs ?? 0) } : undefined)
      } catch {
        finish(undefined)
      }
    })
    sock.on('error', () => finish(undefined))
    sock.on('close', () => finish(undefined))
  })
}
