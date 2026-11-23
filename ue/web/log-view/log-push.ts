import { useEffect, useRef, useState } from 'react'
import { ppost } from '../api.ts'
import { h } from '../host.ts'

/**
 * 日志页的推送（服务端 server/log-tail/feed.ts）：登记后 Saved/Logs 有新写入就推 ue-log，这里调 onPush 让页面按游标取新的。
 * 以前日志页每秒问一次。断线重连后重新登记（旧连接的登记服务端已经清掉）；登记不上（旧面板、盯不了目录）时 watching 为 false，
 * 页面退回定时取，不至于停在旧内容上
 */
export function useLogPush(projectId: string, onPush: () => void) {
  const { events } = h()
  const cb = useRef(onPush)
  cb.current = onPush
  const [watching, setWatching] = useState(true)
  useEffect(() => {
    const register = (conn: string) =>
      void ppost<{ watching: boolean }>(projectId, 'logs/watch', { conn })
        .then((r) => {
          setWatching(!!r.watching)
          // 登记前写进来的漏了：登记好马上取一次
          cb.current()
        })
        .catch(() => setWatching(false))
    const offConn = events.onConnect(register)
    const conn = events.conn()
    if (conn) register(conn)
    else setWatching(false)
    const offEv = events.on('ue-log', (d) => {
      if ((d as { project?: string })?.project === projectId) cb.current()
    })
    // 切回这个标签页：藏着时收到的推送没取（页面藏着不取），回来补一次
    const onVis = () => !document.hidden && cb.current()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      offConn()
      offEv()
      document.removeEventListener('visibilitychange', onVis)
      const c = events.conn()
      if (c) void ppost(projectId, 'logs/watch', { conn: c, on: false }).catch(() => undefined)
    }
  }, [projectId, events])
  return watching
}
