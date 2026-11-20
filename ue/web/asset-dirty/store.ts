import { useEffect, useSyncExternalStore } from 'react'
import type { AssetDiff } from '../../shared/asset-diff/types.ts'
import { op } from '../api.ts'
import { useUe } from '../ctx.tsx'

/** 编辑器里改了没保存的一个包（UELink asset.dirty） */
export interface Dirty {
  package: string
  file: string
  readOnly: boolean
  /** 还没存过盘的新资源 */
  isNew?: boolean
}

/**
 * 「当前修改」的数据（资源页左栏的列表、资源头的「改动」页、页头的「N 个没保存」共用一份）：
 * - 列表按「项目 + 进程个数 + 左栏徽标里的未保存个数」取，数字变了才重读，不另开轮询；
 * - 哪个资源正开着「改动」页（只对那一个资源生效，换到别的资源自动回到原来的视图）；
 * - 「改动」页算过的差异，左栏那一行补上小标签（用户 2026-11-19 定：点开才算，不在后台预算）
 */
interface State {
  pid: string
  items: Dirty[]
  loaded: boolean
  /** 开着「改动」页的资源包路径 */
  changes: string
  /** 左栏多选模式下勾上的包 */
  picked: string[]
  /** 算过的差异：包路径 → 差异 */
  sums: Record<string, AssetDiff>
  /** 列表展开（页头「N 个没保存」会把它打开） */
  open: boolean
}

let st: State = { pid: '', items: [], loaded: false, changes: '', picked: [], sums: {}, open: true }
const subs = new Set<() => void>()
const set = (p: Partial<State>) => {
  st = { ...st, ...p }
  for (const f of subs) f()
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export const pkgOf = (path: string) => path.split('.')[0]

// 重读的请求号：同一轮里好几处都挂着 useDirtyList，只发一次
let fetched = ''
let nonce = 0

/** 读「当前修改」列表；编辑器（含后台编辑器）没开时是空的 */
export function useDirtyList() {
  const { project, state, badges } = useUe()
  const insts = state?.instances ?? []
  const hasEditor = insts.some((i) => i.kind === 'editor' || i.kind === 'background')
  const s = useSyncExternalStore(subscribe, () => st)
  const key = `${project.id}|${insts.length}|${hasEditor}|${badges?.dirty ?? ''}|${nonce}`
  useEffect(() => {
    if (fetched === key) return
    fetched = key
    if (st.pid !== project.id) set({ pid: project.id, items: [], loaded: false, changes: '', picked: [], sums: {} })
    if (!hasEditor) {
      set({ items: [], loaded: true, picked: [] })
      return
    }
    op<{ items: Dirty[] }>(project.id, 'asset.dirty').then(
      (r) => {
        const items = r.items ?? []
        const live = new Set(items.map((d) => d.package))
        // 不再是没保存的：小标签、勾选一起丢掉
        const sums = Object.fromEntries(Object.entries(st.sums).filter(([k]) => live.has(k)))
        set({ items, loaded: true, sums, picked: st.picked.filter((p) => live.has(p)) })
      },
      // 问不到（编辑器忙、旧桥接）：保留上一次的列表，不弹错
      () => set({ loaded: true }),
    )
  }, [key, project.id, hasEditor])
  return s.pid === project.id ? s : { ...s, items: [], loaded: false }
}

/** 保存、放弃、刷新之后重读列表；算过的差异全部作废（内容可能变了） */
export function reloadDirty() {
  nonce += 1
  set({ sums: {} })
}

export function useDirtyState() {
  return useSyncExternalStore(subscribe, () => st)
}

/** 这个资源有没有没保存的改动 */
export function useIsDirty(path: string) {
  const pkg = pkgOf(path)
  return useSyncExternalStore(subscribe, () => st.items.some((d) => d.package === pkg))
}

/** 打开 / 关掉某个资源的「改动」页 */
export function showChanges(path: string) {
  set({ changes: path ? pkgOf(path) : '' })
}

/** 这个资源正开着「改动」页 */
export function useChangesOn(path: string) {
  const pkg = pkgOf(path)
  return useSyncExternalStore(subscribe, () => !!pkg && st.changes === pkg && st.items.some((d) => d.package === pkg))
}

export function setDiffSummary(pkg: string, diff: AssetDiff | undefined) {
  const sums = { ...st.sums }
  if (diff) sums[pkg] = diff
  else delete sums[pkg]
  set({ sums })
}

export function setPicked(picked: string[]) {
  set({ picked })
}

export function setDirtyOpen(open: boolean) {
  set({ open })
}
