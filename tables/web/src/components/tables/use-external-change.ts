import { useEffect, useMemo, useRef } from 'react'
import { tablesApi } from '@/lib/tables-api'
import { tablesHost } from '@/lib/tables-host'

/** 正在保存、切换版本时来的通知，隔这么久再看一次（最多看这么多次），免得把自己写的当成外面改的 */
const BUSY_RETRY_MS = 800
const BUSY_RETRIES = 40

interface FileChanged {
  projectId: string
  path: string
  mtime?: string
  missing?: boolean
}

/**
 * 外部改动检测：这个项目里打开着的表格被 Excel / WPS 或版本控制改了就回调。
 * 服务端用 fs.watch 盯着这些文件（server/tables/watch.ts），改了经面板的推送通道（插件接口 7）推过来，不再轮询。
 * - 每次连上推送（含断线重连）把打开着的文件登记一遍，登记时服务端顺便对一下修改时间，断线期间的改动也补得上；
 * - 页面藏起来（切到别的页面）时先记着，切回来再处理；busy（正在保存、切换版本）时等它忙完再看一次修改时间，
 *   免得把自己写的当成外面改的；
 * - 同一个新修改时间只报一次；文件被删了不在这里报（打开、保存时会说）。
 */
export function useExternalChange(
  projectId: string,
  docs: { path: string; mtime: string }[],
  shown: boolean,
  busy: React.RefObject<boolean>,
  onChanged: (path: string, mtime: string) => void,
) {
  const cb = useRef(onChanged)
  cb.current = onChanged
  const key = docs.map((d) => `${d.path}\u0000${d.mtime}`).join('\u0001')
  // 故意只看 key：父组件每次渲染都给新数组，内容（路径和修改时间）没变就不重新登记
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => docs, [key])
  const latest = useRef(list)
  latest.current = list
  const shownRef = useRef(shown)
  shownRef.current = shown
  /** 藏起来时收到的：路径 → 新修改时间 */
  const pending = useRef(new Map<string, string>())
  const reported = useRef(new Map<string, string>())

  const deliver = (path: string, mtime: string, tries = 0) => {
    const doc = latest.current.find((d) => d.path === path)
    // 已经关了、已经是这个版本（自己保存的、已经重新载入过）、已经报过：不报
    if (!doc || doc.mtime === mtime || reported.current.get(path) === mtime) return
    if (!shownRef.current) {
      pending.current.set(path, mtime)
      return
    }
    if (busy.current) {
      if (tries < BUSY_RETRIES) setTimeout(() => recheck(path, tries + 1), BUSY_RETRY_MS)
      return
    }
    reported.current.set(path, mtime)
    cb.current(path, mtime)
  }
  /** 忙完之后重新看一次修改时间：保存完文件变了，doc.mtime 也跟着变，一样就不是外面改的 */
  const recheck = (path: string, tries: number) => {
    if (busy.current) {
      if (tries < BUSY_RETRIES) setTimeout(() => recheck(path, tries + 1), BUSY_RETRY_MS)
      return
    }
    tablesApi
      .stat(projectId, path)
      .then((s) => s.mtime && deliver(path, s.mtime, tries))
      // 看不了（服务没开、网络断）不打扰：这只是提醒，保存时还有修改时间检查兜底
      .catch(() => {})
  }
  const deliverRef = useRef(deliver)
  deliverRef.current = deliver

  // 收推送
  useEffect(() => {
    const events = tablesHost()?.events
    if (!events) return
    return events.on('file-changed', (data) => {
      const d = data as FileChanged
      if (d.projectId !== projectId || d.missing || !d.mtime) return
      deliverRef.current(d.path, d.mtime)
    })
  }, [projectId])

  // 登记要盯的文件：连上时、打开的文件变了时
  useEffect(() => {
    const events = tablesHost()?.events
    if (!events || !projectId) return
    const files = list.map((d) => ({ path: d.path, mtime: d.mtime }))
    const register = (conn: string) => {
      // 登记不上（服务没开）不打扰：重连时还会再登记
      tablesApi.watch(projectId, conn, files).catch(() => {})
    }
    // 打开的文件变了就整份重新登记（服务端按页面和项目整份替换），不先清空：两个请求先后到达的顺序不一定
    return events.onConnect(register)
  }, [projectId, list])

  // 换项目、表格页卸载：这个项目的登记清空（连接断了服务端自己会清）
  useEffect(() => {
    const events = tablesHost()?.events
    if (!events || !projectId) return
    return () => {
      const conn = events.conn()
      if (conn) tablesApi.watch(projectId, conn, []).catch(() => {})
    }
  }, [projectId])

  // 切回来：处理藏起来时收到的
  useEffect(() => {
    if (!shown || !pending.current.size) return
    const got = [...pending.current]
    pending.current.clear()
    for (const [path, mtime] of got) deliverRef.current(path, mtime)
  }, [shown])
}
