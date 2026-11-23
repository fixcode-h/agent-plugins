import { useEffect } from 'react'
import { pget, ppost, useLoad } from './api.ts'
import { h } from './host.ts'
import type { ProjectState } from '../server/types.ts'

/**
 * 项目概况（实例、桥接、扩展、启动进度……）：服务端推送（server/state-feed/feed.ts），页面不再各自定时取。
 * 进页面先取一份；登记后服务端变了就推 ue-state；断线重连后重新登记（旧连接的登记服务端已经清掉）。
 * 返回和 useLoad 一样的形状（data / error / reload），UE 页、资源查看页、对话侧栏照旧用
 */
/** 同一个页面里几处一起看同一个项目（UE 页 + 对话侧栏）：最后一个走了才取消登记 */
const watching = new Map<string, number>() // 模块状态：运行时，跟着页面

export function useUeState(projectId: string | undefined) {
  const { events } = h()
  const state = useLoad<ProjectState | undefined>(
    () => (projectId ? pget<ProjectState>(projectId, 'state') : Promise.resolve(undefined)),
    [projectId],
  )
  const { setData } = state
  useEffect(() => {
    if (!projectId) return
    watching.set(projectId, (watching.get(projectId) ?? 0) + 1)
    const register = (conn: string) => void ppost(projectId, 'state/watch', { conn }).catch(() => undefined)
    const offConn = events.onConnect(register)
    const conn = events.conn()
    if (conn) register(conn)
    const offEv = events.on('ue-state', (d) => {
      const e = d as { project?: string; state?: ProjectState }
      if (e?.project === projectId && e.state) setData(e.state)
    })
    return () => {
      offConn()
      offEv()
      const left = (watching.get(projectId) ?? 1) - 1
      if (left > 0) return void watching.set(projectId, left)
      watching.delete(projectId)
      // 离开页面（或换项目）：取消登记，没人看的项目服务端就不再算
      const c = events.conn()
      if (c) void ppost(projectId, 'state/watch', { conn: c, on: false }).catch(() => undefined)
    }
  }, [projectId, events, setData])
  return state
}
