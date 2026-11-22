import { FileCode } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import type { LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import type { GmRun, LocalState } from '../../../server/store.ts'
import type { GmStore } from '../../../server/types.ts'
import type { TableBase } from '../../../server/gm-custom/table-base.ts'
import { consoleFavs } from '../../../shared/gm/common.ts'
import { emptyGm } from '../../../shared/gm/schema.ts'
import { op, pget, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useTargetInfo } from '../../ui.tsx'
import { gmCache, registerJumpSource } from '../../jump/local.ts'
import { setPending } from '../../pending.ts'
import { fromConsole, fromCpp, fromCustom, fromLua, type CppGm, type GmEntry } from './data.ts'
import { setTableRoots } from './tables.ts'

const EMPTY = emptyGm()

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

/**
 * GM 页的数据：C++ GM（要 UE 在运行）、Lua GM（扫描结果，UE 没开也有）、gm.json v2（模块、自定义 GM、对象列表、常用、宏、表格关联）、
 * 本机的最近执行和控制台历史。Lua 扫描结果变了服务端推 lua-gm 事件、gm.json 变了（含 Agent 改的、别人提交拉下来的）推 gm 事件，
 * 这里收到再取，不轮询
 */
export function useGm(nonce: number) {
  const { project } = useUe()
  const { inst } = useTargetInfo()
  const { hooks } = h()
  const panelDir = (hooks.useData().projects as { id: string; path?: string }[]).find((p) => p.id === project.id)?.path
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
  const info = useLoad(() => pget<{ file: string; table: TableBase }>(project.id, 'gm/info'), [project.id])
  // 参数关联表格存相对路径（shared/gm/table-path.ts）：调表格插件前按这两个根换算
  if (info.data && panelDir) setTableRoots(project.id, { base: info.data.table.base, panelDir })

  useEffect(() => {
    const offs = [
      h().events.on('lua-gm', (d) => {
        if ((d as { project?: string }).project === project.id) void lua.reload()
      }),
      h().events.on('gm', (d) => {
        if ((d as { project?: string }).project === project.id) void store.reload()
      }),
    ]
    return () => offs.forEach((off) => off())
    // lua.reload、store.reload 是稳定的；只按项目重新订阅
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const gm = store.data ?? EMPTY
  const consoleCmds = useMemo(
    () => [
      ...consoleFavs(gm).map((cmd) => ({ cmd, group: t('常用的命令') })),
      ...[...(local.data?.console ?? [])]
        .reverse()
        .filter((c) => !consoleFavs(gm).includes(c))
        .slice(0, 50)
        .map((cmd) => ({ cmd, group: t('最近用过的命令') })),
    ],
    [gm, local.data?.console],
  )
  const entries = useMemo<GmEntry[]>(
    () => [
      ...fromLua(lua.data?.scan.items ?? []),
      ...fromCpp(cpp.data ?? []),
      ...fromCustom(gm.custom),
      ...fromConsole(consoleCmds),
    ],
    [lua.data, cpp.data, gm.custom, consoleCmds],
  )
  luaSeen.items = entries.filter((e) => e.src === 'lua')
  /** 整份存回去（服务端按契约校验，存完推 gm 事件）；返回存好的 */
  const saveGm = async (next: GmStore) => {
    store.setData(next)
    try {
      store.setData(await ppost<GmStore>(project.id, 'gm', next))
    } catch (e) {
      h().toast.error((e as Error).message)
      void store.reload()
    }
  }
  const recent = local.data?.gmRecent ?? []
  /**
   * 记一次执行：本地先插到最前面（马上看得到），服务端只追加这一条（B3：以前整份写回，连着两次执行会丢一条）；
   * 服务端返回的是追加后的整份，以它为准
   */
  const pushRecent = (r: GmRun) => {
    local.setData((s) => (s ? { ...s, gmRecent: [r, ...(s.gmRecent ?? [])].slice(0, 60) } : s))
    void ppost<LocalState>(project.id, 'local/gm-recent', r)
      .then((s) => local.setData(s))
      .catch((e: Error) => h().toast.error(e.message))
  }
  return { inst, cpp, lua, entries, gm, saveGm, recent, pushRecent, file: info.data?.file }
}

export type GmData = ReturnType<typeof useGm>
