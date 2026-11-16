import { useCallback, useEffect, useRef, useState } from 'react'
import type { TablesIndex } from '@shared/tables'
import {
  TABLES_LIST_EVENT,
  TABLES_PROGRESS_EVENT,
  applyTablesDelta,
  type TablesListDelta,
  type TablesListProgress,
} from '@shared/table-list'
import { tablesApi } from '@/lib/tables-api'
import { tablesHost } from '@/lib/tables-host'

/** 切回表格页时，文件列表超过这么久没读就再取一次（服务端先给索引、后台重扫） */
const STALE_MS = 60_000

/**
 * 表格页左侧的文件列表：服务端先给存下的索引（马上显示），后台重新扫描表格目录，扫完推增量过来合进列表
 * （server/tables/list-index.ts）。index.scanning 为真时页面显示「后台更新中」。
 * reload(true) 是刷新按钮、新建表格这些：等服务端重新扫完再给
 */
export function useTablesIndex(projectId: string, shown: boolean) {
  const [index, setIndex] = useState<TablesIndex | null>(null)
  const [error, setError] = useState('')
  /** 服务端正在扫描表格目录的进度（第一次打开、后台重扫时推来）；扫完清掉 */
  const [progress, setProgress] = useState<TablesListProgress | null>(null)
  /** 上次读表格目录的时间：切回来时太久没读才再读一次（懒刷新） */
  const loadedAt = useRef(0)
  const reload = useCallback(
    (fresh = false) => {
      setError('')
      loadedAt.current = Date.now()
      tablesApi
        .list(projectId, fresh)
        .then((i) => {
          setIndex(i)
          if (!i.scanning) setProgress(null)
        })
        .catch((e) => {
          setProgress(null)
          setError((e as Error).message)
        })
    },
    [projectId],
  )
  // 从别的页面切回来：页面状态都还在，不重新加载；离上次读目录超过 STALE_MS 才悄悄再取（不清空、不转圈，服务端后台重扫）
  const wasShown = useRef(shown)
  useEffect(() => {
    if (shown && !wasShown.current && Date.now() - loadedAt.current > STALE_MS) reload()
    wasShown.current = shown
  }, [shown, reload])
  useEffect(() => {
    reload()
  }, [projectId, reload])

  // 后台扫完推来的增量：按列表的键认是不是这一份（别的项目、别的表格目录设置的不管）
  const indexRef = useRef(index)
  indexRef.current = index
  useEffect(() => {
    const events = tablesHost()?.events
    if (!events) return
    const offPush = events.on(TABLES_LIST_EVENT, (data) => {
      const d = data as TablesListDelta
      const cur = indexRef.current
      if (!cur?.key || d.key !== cur.key) return
      const next = applyTablesDelta(cur, d)
      // 变化太多的服务端只说一声：这时它内存里已经是新的，再取一次很快
      setProgress(null)
      if (next) setIndex(next)
      else reload()
    })
    // 扫描进度：按列表的键认，第一次扫（手上还没有这个项目的列表、不知道键）时按项目认
    const offProgress = events.on(TABLES_PROGRESS_EVENT, (data) => {
      const p = data as TablesListProgress
      if (p.key === indexRef.current?.key || p.projects.includes(projectId)) setProgress(p)
    })
    // 断线重连：等着的推送可能丢了，还在「后台更新中」就重新取一次
    let first = true
    const offConn = events.onConnect(() => {
      if (!first && indexRef.current?.scanning) reload()
      first = false
    })
    return () => {
      offPush()
      offProgress()
      offConn()
    }
  }, [reload, projectId])

  return { index, error, reload, progress }
}
