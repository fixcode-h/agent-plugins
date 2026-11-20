import { useEffect, useState } from 'react'
import type { SearchIndex } from '../../server/search-index/types.ts'
import { pget } from '../api.ts'
import { mapSliced } from './index-async.ts'
import { toAsset, toLua, type LoadedIndex } from './index-match.ts'

export { matchAssets, matchLua, queryTerms, type LoadedIndex } from './index-match.ts'

/**
 * 跳转弹窗的本地索引（server/search-index/）：打开弹窗时问一次服务端（带着上次的版本，没变只回 same），
 * 打字只在这里筛，不发请求、不碰 UE（用户 2026-11-10 定的「打字不发请求」照旧）。
 * 名字、路径的小写形式在拿到索引时算好一次，5000+ 资源每次按键只做一遍 includes
 */

const cache = new Map<string, LoadedIndex>()
const inflight = new Map<string, Promise<LoadedIndex>>()

/** 取索引：内存里有就带版本去问，没变直接用 */
export function loadIndex(pid: string, refresh = false): Promise<LoadedIndex> {
  const running = inflight.get(pid)
  if (running) return running
  const have = cache.get(pid)
  const q = new URLSearchParams()
  if (have) q.set('v', have.version)
  if (refresh) q.set('refresh', '1')
  const p = pget<SearchIndex | { version: string; same: true }>(pid, `search-index?${q}`)
    .then(async (r) => {
      if ('same' in r && have) return have
      const idx = r as SearchIndex
      // 几万个资源一次算完小写会卡一下界面：分片算，期间输入框照常能打字
      const next: LoadedIndex = {
        version: idx.version,
        assets: await mapSliced(idx.assets, toAsset),
        lua: await mapSliced(idx.lua, toLua),
        source: idx.source,
      }
      cache.set(pid, next)
      return next
    })
    .finally(() => inflight.delete(pid))
  inflight.set(pid, p)
  return p
}

/** 弹窗用：先给内存里那份（上次的），后台再问一次有没有变 */
export function useSearchIndex(pid: string) {
  const [idx, setIdx] = useState<LoadedIndex | undefined>(() => cache.get(pid))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    void loadIndex(pid, tick > 0)
      .then((x) => live && setIdx(x))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [pid, tick])
  return { idx, error, loading, refresh: () => setTick((n) => n + 1) }
}
