// 假桥接的心跳端口（UELink 2.25，UEKit docs/protocol.md 第 1 节「心跳」）：和真的一样在另一个线程上应答，
// 主线程（假的游戏线程）卡住时照样回 lastTickAgoMs；整个进程被 SIGSTOP 停住时谁都不回，用来测「整个进程停住」
import { createServer } from 'node:net'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

if (!isMainThread && workerData?.fakeHeartbeat) {
  const last = new Float64Array(workerData.buf)
  const server = createServer((sock) => {
    const ago = Math.round(Date.now() - last[0])
    sock.end(JSON.stringify({ ok: true, pid: process.pid, frame: 0, lastTickAgoMs: ago }) + '\n')
  })
  server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port))
}

/** 起心跳线程，返回端口；主线程每 100 毫秒记一次「走了一帧」 */
export function startFakeHeartbeat() {
  const buf = new SharedArrayBuffer(8)
  const last = new Float64Array(buf)
  last[0] = Date.now()
  const tick = setInterval(() => (last[0] = Date.now()), 100)
  tick.unref()
  const worker = new Worker(new URL(import.meta.url), { workerData: { fakeHeartbeat: true, buf } })
  worker.unref()
  return new Promise((resolve) => worker.once('message', resolve))
}
