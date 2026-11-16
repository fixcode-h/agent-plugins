import { useEffect, useRef } from 'react'
import { ppost } from '../../api.ts'
import { h } from '../../host.ts'

/**
 * 让服务端盯着右栏选中的那份配置（server/uekit/forge-watch.ts）：存盘了推 forge.file 事件，
 * Forge.tsx 收到后重拉清单和差异、重新演练，不用手动点刷新。
 * 每次连上面板推送都要重新登记（断线重连后旧连接的登记已经清掉了）；换选中项整份替换，没选中就取消。
 */
export function useForgeFileWatch(project: string, root: string, config: string | undefined) {
  const { events } = h()
  const rootRef = useRef(root)
  rootRef.current = root
  useEffect(() => {
    if (!root) return
    const path = (config ?? '').replace(/\\/g, '/')
    const register = (conn: string) =>
      void ppost(project, 'ext/forge/watch', { conn, root, path }).catch(() => undefined)
    const off = events.onConnect(register)
    const conn = events.conn()
    if (conn) register(conn)
    // 换选中项时不先取消：新的登记会整份替换，先发取消的话两个请求先后不定，可能把新的冲掉
    return off
  }, [project, root, config, events])
  useEffect(
    () => () => {
      // 离开页面（或换项目）：取消登记，服务端关掉 watcher
      const conn = events.conn()
      if (conn && rootRef.current)
        void ppost(project, 'ext/forge/watch', { conn, root: rootRef.current, path: '' }).catch(() => undefined)
    },
    [project, events],
  )
}
