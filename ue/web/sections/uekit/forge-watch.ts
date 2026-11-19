import { useEffect, useRef } from 'react'
import { ppost } from '../../api.ts'
import { h } from '../../host.ts'

/**
 * 让服务端盯着右栏选中的那份配置（server/uekit/forge-watch.ts）：存盘了推 forge.file 事件，
 * Forge.tsx 收到后重拉清单和差异、重新演练，不用手动点刷新。
 * 每次连上面板推送都要重新登记（断线重连后旧连接的登记已经清掉了）；换选中项整份替换，没选中就取消。
 * extra 是这份配置 include 的片段文件（相对配置根）：片段存盘也推这份配置的 forge.file。
 */
export function useForgeFileWatch(project: string, root: string, config: string | undefined, extra: string[] = []) {
  const { events } = h()
  const rootRef = useRef(root)
  // 数组每次渲染都是新的：拼成字符串当依赖，片段列表真变了才重新登记
  const extraKey = extra.join('\n')
  rootRef.current = root
  useEffect(() => {
    if (!root) return
    const path = (config ?? '').replace(/\\/g, '/')
    const more = extraKey ? extraKey.split('\n') : []
    const register = (conn: string) =>
      void ppost(project, 'ext/forge/watch', { conn, root, path, ...(more.length > 0 && { extra: more }) }).catch(
        () => undefined,
      )
    const off = events.onConnect(register)
    const conn = events.conn()
    if (conn) register(conn)
    // 换选中项时不先取消：新的登记会整份替换，先发取消的话两个请求先后不定，可能把新的冲掉
    return off
  }, [project, root, config, events, extraKey])
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
