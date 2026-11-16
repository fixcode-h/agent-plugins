import { FileCode } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import type { LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import type { GmRun, LocalState } from '../../../server/store.ts'
import type { GmStore } from '../../../server/types.ts'
import { op, pget, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h } from '../../host.ts'
import { useTargetInfo } from '../../ui.tsx'
import { gmCache, registerJumpSource } from '../../jump/local.ts'
import { setPending } from '../../pending.ts'
import { fromCpp, fromLua, type CppGm, type GmEntry } from './data.ts'

/**
 * gm.list 要遍历所有类，按进程缓存（同一个进程的 GM 不会变；Live Coding 后点「刷新」重取）。
 * 缓存放在 jump/local.ts：双击 Shift 的跳转直接在这份列表里匹配
 */
const cppCache = gmCache
/**
 * 双击 Shift 跳转里也能搜到 Lua GM（W1 留的 registerJumpSource）：用 GM 页取过的扫描结果，打字不发请求。
 * 按项目记最近一次的结果；跳转弹窗只搜当前打开的项目
 */
const luaSeen = { items: [] as GmEntry[] }
registerJumpSource({
  id: 'lua-gm',
  match: (q, env) =>
    luaSeen.items
      .filter((g) => g.name.toLowerCase().includes(q) || g.desc.toLowerCase().includes(q))
      .slice(0, 5)
      .map((g) => ({
        key: `lua-gm:${g.name}`,
        icon: FileCode,
        label: g.name,
        detail: g.params.map((p) => p.name).join(', '),
        hint: g.group ? `Lua GM · ${g.group}` : 'Lua GM',
        chat: `Lua GM ${g.name}（${g.file}:${g.line}）`,
        run: () => {
          setPending('gm', g.name)
          env.go('gm')
        },
      })),
})

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
  luaSeen.items = entries.filter((e) => e.src === 'lua')
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
