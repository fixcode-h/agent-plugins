import { useCallback, useSyncExternalStore } from 'react'
import { useUe } from '../ctx.tsx'
import { isRuntimePath } from '../details/model.ts'
import { keep, kept } from '../keep.ts'
import * as N from './nav-state.ts'
import type { NavEntry, NavFrom, NavPage, NavState } from './nav-state.ts'

export type { NavEntry, NavFrom, NavPage, NavState }

/**
 * 对象页、资源页共用的导航历史（设计稿第 5 节）：按项目一份，存在 keep.ts 的模块级表里（整页刷新才清，切分区不丢）。
 * 历史跟着地址走：地址是唯一的真相，点了东西先用 stageNav 留下「从哪个属性 / 浏览栏哪里来的」，再 go() 改地址，
 * UePage 看到地址变了调 syncNav 把它记进来。这样 Ctrl+K、对话、别的分区直接 go('objects', p) 也会进历史，
 * 浏览器自己的后退前进也对得上，不会出现历史和地址不一致。纯逻辑在 nav-state.ts
 */
const subs = new Set<() => void>()
const keyOf = (pid: string) => `${pid}/nav`
const read = (pid: string) => kept<NavState>(keyOf(pid)) ?? N.EMPTY
function write(pid: string, s: NavState) {
  if (s === read(pid)) return
  keep(keyOf(pid), s)
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}

/** 下一次地址变到 page/path 时带上的说明；只认对得上的那一次，别的跳转不会误用 */
let staged: { pid: string; page: NavPage; path: string; meta: Pick<NavEntry, 'via' | 'from'> } | undefined

export function stageNav(pid: string, page: NavPage, path: string, meta: Pick<NavEntry, 'via' | 'from'>) {
  staged = { pid, page, path, meta }
}

/** 运行时实例记下当时的目标进程和世界，换了世界在「最近看过」里标灰 */
export const scopeOf = (target: { instance?: string | number; world?: string }) =>
  `${target.instance ?? ''}/${target.world ?? ''}`

/** UePage 在对象页、资源页的地址变了时调：把历史对上地址 */
export function syncNav(pid: string, page: NavPage, sub: string, scope: string) {
  const { path, comp } = N.splitSub(sub)
  const meta = staged && staged.pid === pid && staged.page === page && staged.path === path ? staged.meta : undefined
  staged = undefined
  let s = N.sync(read(pid), page, path, comp, meta)
  // 新记下的运行时实例补上当时的目标（后退前进移过去的那条保留原来的）
  const cur = N.current(s)
  if (cur && !cur.scope && isRuntimePath(cur.path)) {
    const items = s.items.slice()
    items[s.index] = { ...cur, scope }
    s = { ...s, items }
  }
  write(pid, s)
}

/**
 * 页面里用的导航历史：open 新看一个东西（会 push），back / forward / jump 改地址回到那条记录（连组件一起恢复），
 * clear 清空「最近看过」
 */
export function useNavHistory() {
  const { project, go } = useUe()
  const pid = project.id
  const state = useSyncExternalStore(
    subscribe,
    useCallback(() => read(pid), [pid]),
  )
  const goEntry = (s: NavState) => {
    if (s === state) return
    const e = N.current(s)
    write(pid, s)
    if (e) go(e.page, N.joinSub(e.path, e.comp))
  }
  return {
    state,
    current: N.current(state),
    canBack: N.canBack(state),
    canForward: N.canForward(state),
    chain: N.chain(state),
    recent: N.recent(state),
    /** 新看一个东西：via 是从哪个属性点过来的（引用链上的一步），from 是浏览栏的哪一处 */
    open(page: NavPage, path: string, meta: Pick<NavEntry, 'via' | 'from'> = {}) {
      stageNav(pid, page, path, meta)
      go(page, path)
    },
    back: () => goEntry(N.back(state)),
    forward: () => goEntry(N.forward(state)),
    jump: (i: number) => goEntry(N.jump(state, i)),
    clear: () => write(pid, N.clear(state)),
  }
}
