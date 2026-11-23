import { c } from '../util.ts'

/**
 * 「页面按推送连接登记、服务端有变化推给登记了的页面」的共用部分（state-feed、日志推送都用）：
 * 按 key（一般是项目 id）记登记的连接；连接断开（面板 onClose）或取消登记时撤掉，key 上没人了回调 onEmpty 让调用方停掉监听。
 * 以前 state-feed、uekit/stream 各写一份 conns + onClose 清理
 */
export interface PageSubs {
  /** 登记；连接已经断了返回 false。first：这个 key 上原来没人（调用方据此开始监听） */
  add: (key: string, conn: string) => { ok: boolean; first: boolean }
  remove: (key: string, conn: string) => void
  conns: (key: string) => string[]
  has: (key: string) => boolean
  keys: () => string[]
  /** 推给这个 key 上登记的页面 */
  push: (event: string, key: string, data: unknown) => number
  /** 全部撤掉（插件停用） */
  clear: () => void
}

export function pageSubs(onEmpty: (key: string) => void): PageSubs {
  const subs = new Map<string, Set<string>>() // 模块状态：运行时，页面重连后重新登记
  let hooked = false
  const remove = (key: string, conn: string) => {
    const s = subs.get(key)
    if (!s) return
    s.delete(conn)
    if (s.size) return
    subs.delete(key)
    onEmpty(key)
  }
  return {
    add(key, conn) {
      if (!conn || !c().pages.open(conn)) return { ok: false, first: false }
      if (!hooked) {
        hooked = true
        c().pages.onClose((gone) => {
          for (const k of [...subs.keys()]) remove(k, gone)
        })
      }
      let s = subs.get(key)
      const first = !s
      if (!s) subs.set(key, (s = new Set()))
      s.add(conn)
      return { ok: true, first }
    },
    remove,
    conns: (key) => [...(subs.get(key) ?? [])],
    has: (key) => subs.has(key),
    keys: () => [...subs.keys()],
    push(event, key, data) {
      const s = subs.get(key)
      return s?.size ? c().pages.push(event, data, [...s]) : 0
    },
    clear() {
      for (const k of [...subs.keys()]) {
        subs.delete(k)
        onEmpty(k)
      }
    },
  }
}
