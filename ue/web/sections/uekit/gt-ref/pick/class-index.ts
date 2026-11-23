import { useEffect, useRef, useState } from 'react'
import type { GtClassIndexResult, GtClassRow, GtClassesResult } from '../../../../../shared/gt-script/index.ts'
import { useRefRpc, type RefRpc } from '../live.ts'
import { buildIndex, type ClassIndex } from './class-index-model.ts'

export { ancestors, luaDirOf, searchIndex, SEARCH_MAX, type ClassIndex, type LuaDir } from './class-index-model.ts'

/**
 * 「类」下拉的本地索引（用户 2026-11-23：每次打开都「读类树…」、搜索慢、打字结果不跟着变）。
 * 整张类表问一次（gt.classes all，服务端记在内存和数据目录），在这里建好父子表、目录表和搜索用的小写名字，
 * 按项目留在页面内存里：再打开下拉、换页签、GM 页和测试页之间切换都直接用，展开一层、打字搜都不再发请求。
 * 打开时后台问一次有没有变（带 v，没变服务端只回 same），变了才换。
 */

/** 页面内存里的索引：按项目 + 种类（设置里的示例 project 为空，是假数据，也按它自己的键记） */
const cache = new Map<string, ClassIndex>()
const keyOf = (project: string, lua: boolean) => `${project}\n${lua ? 'lua' : 'ue'}`

/** 旧服务端 / 示例假数据回的是 gt.classes 的 items，没有 rows：照样转成行 */
function rowsOf(r: GtClassIndexResult & Partial<GtClassesResult>): GtClassRow[] | undefined {
  if (r.rows) return r.rows
  if (!r.items) return undefined
  return r.items.map((x) => [x.name, x.parent ?? '', x.kind, x.asset ?? x.file ?? '', x.live ?? 0])
}

async function fetchIndex(rpc: RefRpc, project: string, lua: boolean, args: Record<string, unknown>) {
  const r = await rpc<GtClassIndexResult & Partial<GtClassesResult>>(project, 'gt.classes', {
    all: true,
    ...(lua ? { lua: true } : {}),
    ...args,
  })
  const rows = rowsOf(r)
  const ix = rows ? buildIndex(rows, { v: r.v ?? '', source: r.source ?? 'ue', note: r.note }, lua) : undefined
  if (ix) cache.set(keyOf(project, lua), ix)
  return { r, ix }
}

/**
 * 取索引：页面里有就马上给，同时后台核对一次（服务端也有记住的就马上回、带 refreshing 时再等它重建完）。
 * rpc 换了（选对象面板点「刷新」）带 fresh 强制重建。enabled 为假（下拉没打开、在「屏幕上」页签）时不发请求
 */
export function useClassIndex(project: string, lua: boolean, enabled: boolean) {
  const rpc = useRefRpc()
  const key = keyOf(project, lua)
  const [ix, setIx] = useState<ClassIndex | undefined>(() => cache.get(key))
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const firstRpc = useRef(rpc)
  // 每个 rpc（每次刷新）每种只核对一次：开关下拉不反复问
  const checked = useRef(new Map<string, RefRpc>())
  const alive = useRef(true)
  // 换了页签（UObject ↔ Lua）后，上一种迟到的结果不能盖掉这一种
  const curKey = useRef(key)
  curKey.current = key
  // 开发模式下 React 会先卸载再挂一次：挂上时要重新置回 true，不然结果永远设不进来（一直「读类树…」）
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    setIx(cache.get(key))
    if (!enabled || checked.current.get(key) === rpc) return
    checked.current.set(key, rpc)
    const fresh = rpc !== firstRpc.current
    const have = fresh ? undefined : cache.get(key)
    setError('')
    setSyncing(true)
    // 关了下拉也让这次核对跑完（结果进页面缓存，下次打开直接用）；只是不再改已卸载组件的状态
    const apply = (x: ClassIndex | undefined) => alive.current && x && curKey.current === key && setIx(x)
    void (async () => {
      try {
        const first = await fetchIndex(rpc, project, lua, {
          ...(have ? { v: have.v } : {}),
          ...(fresh ? { fresh: true } : {}),
        })
        apply(first.ix)
        if (first.r.refreshing) {
          const v = first.ix?.v ?? have?.v
          apply((await fetchIndex(rpc, project, lua, { wait: true, ...(v ? { v } : {}) })).ix)
        }
      } catch (e) {
        // 已有索引时核对失败不打扰（照旧能用）；没有索引才显示错误
        checked.current.delete(key)
        if (alive.current && !cache.get(key)) setError((e as Error).message)
      } finally {
        if (alive.current) setSyncing(false)
      }
    })()
  }, [key, project, lua, enabled, rpc])
  return { ix, error, syncing }
}
