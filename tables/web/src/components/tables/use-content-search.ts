import { useEffect, useState } from 'react'
import type { TableSearch } from '@shared/tables'
import type { TableSearchOpts } from '@shared/table-search'
import { tablesApi } from '@/lib/tables-api'

/** 跨表搜索的三个开关（不含要找的字） */
export type SearchFlags = Omit<TableSearchOpts, 'q'>

/** 开关记在这台浏览器里：下次打开表格页还是上次的选法（读不到就用默认，不影响使用） */
const FLAGS_KEY = 'agent-panel.tables.search-flags'

function loadFlags(): SearchFlags {
  try {
    const v = JSON.parse(localStorage.getItem(FLAGS_KEY) ?? '{}') as SearchFlags
    return { caseSensitive: !!v.caseSensitive, whole: !!v.whole, regex: !!v.regex }
  } catch {
    return {}
  }
}

export function useSearchFlags() {
  const [flags, setFlags] = useState<SearchFlags>(loadFlags)
  const set = (f: SearchFlags) => {
    setFlags(f)
    try {
      localStorage.setItem(FLAGS_KEY, JSON.stringify(f))
    } catch {
      // 隐私模式等存不了：只在这次页面里有效
    }
  }
  return [flags, set] as const
}

/**
 * 内容搜索：停手 300ms 再搜，旧的结果先留着（不闪）。又输了字就取消上一次请求，服务端也就不再接着搜。
 * seq 变了重新搜一遍（全部替换之后）
 */
export function useContentSearch(projectId: string, query: string, flags: SearchFlags, seq = 0) {
  const [result, setResult] = useState<TableSearch | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { caseSensitive, whole, regex } = flags
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResult(null)
      setError('')
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    const abort = new AbortController()
    const timer = setTimeout(() => {
      tablesApi
        .search(projectId, { q, caseSensitive, whole, regex }, abort.signal)
        .then((r) => live && (setResult(r), setError('')))
        .catch((e) => live && setError((e as Error).message))
        .finally(() => live && setLoading(false))
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
      abort.abort()
    }
  }, [projectId, query, caseSensitive, whole, regex, seq])
  return { result, loading, error }
}
