import { useEffect, useMemo } from 'react'
import type { LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import type { GmRun, LocalState } from '../../../server/store.ts'
import type { GmStore } from '../../../server/types.ts'
import { op, pget, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h } from '../../host.ts'
import { useTargetInfo } from '../../ui.tsx'
import { fromCpp, fromLua, type CppGm, type GmEntry } from './data.ts'

/** gm.list 要遍历所有类，按进程缓存（同一个进程的 GM 不会变；Live Coding 后点「刷新」重取） */
const cppCache = new Map<number, CppGm[]>()
const EMPTY: GmStore = { presets: [], macros: [], favConsole: [], favGm: [] }

/**
 * GM 页的数据：C++ GM（要 UE 在运行）、Lua GM（扫描结果，UE 没开也有）、gm.json（收藏、宏、DataTable 绑定）、
 * 本机的最近执行。Lua 扫描结果变了服务端推 lua-gm 事件，这里收到再取，不轮询
 */
export function useGm(nonce: number) {
  const { project } = useUe()
  const { inst } = useTargetInfo()
  const cpp = useLoad(async () => {
    if (!inst) return [] as CppGm[]
    const hit = cppCache.get(inst.pid)
    if (hit && !nonce) return hit
    const r = await op<{ items: CppGm[] }>(project.id, 'gm.list', {}, { instance: inst.pid })
    cppCache.set(inst.pid, r.items)
    return r.items
  }, [inst?.pid, nonce])
  const lua = useLoad(
    () => pget<{ scan: LuaGmScan; config: LuaGmConfig }>(project.id, 'lua-gm'),
    [project.id],
    0,
    `gm-lua/${project.id}`,
  )
  const store = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const local = useLoad(() => pget<LocalState>(project.id, 'local'), [project.id])

  useEffect(
    () =>
      h().events.on('lua-gm', (d) => {
        if ((d as { project?: string }).project === project.id) void lua.reload()
      }),
    // lua.reload 是稳定的；只按项目重新订阅
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [project.id],
  )

  const entries = useMemo<GmEntry[]>(
    () => [...fromLua(lua.data?.scan.items ?? []), ...fromCpp(cpp.data ?? [])],
    [lua.data, cpp.data],
  )
  const gm = { ...EMPTY, ...store.data }
  const saveGm = async (next: GmStore) => {
    await ppost(project.id, 'gm', next)
    store.setData(next)
  }
  const recent = local.data?.gmRecent ?? []
  const pushRecent = (r: GmRun) => {
    const next = [r, ...recent].slice(0, 60)
    local.setData({ ...(local.data as LocalState), gmRecent: next })
    void ppost(project.id, 'local', { gmRecent: next })
  }
  return { inst, cpp, lua, entries, gm, saveGm, recent, pushRecent }
}

export type GmData = ReturnType<typeof useGm>
