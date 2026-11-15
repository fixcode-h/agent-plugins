/**
 * 对象页、资源页共用的导航历史（设计稿 designs/对象页合并与资源导航-设计稿.md 第 5 节「历史怎么记」）的纯逻辑：
 * 只有数据变换，不碰 React 和地址，方便单测（nav-state.test.ts）。存储、和地址同步在 history.ts。
 */

export type NavPage = 'objects' | 'assets'

/**
 * 从浏览栏哪里点进来的（「最近看过」里写「从大纲」）：outline 大纲、tree UObject 树、search 按类搜、
 * folders 资源文件夹、assetSearch 资源搜索、pins 固定的对象、jump Ctrl+K、link 别的页面跳过来（概览、日志、对话…）
 */
export type NavFrom = 'outline' | 'tree' | 'search' | 'folders' | 'assetSearch' | 'pins' | 'jump' | 'link'

export interface NavEntry {
  page: NavPage
  path: string
  /** 当时选中的组件（Actor 的组件、蓝图的组件模板）：后退回来时恢复，切组件本身不加记录 */
  comp?: string
  /** 从哪个属性点过来的（Static Mesh、Static Materials[0]）：有它的是引用链上的一步，没有的是一条链的起点 */
  via?: string
  from?: NavFrom
  /** 运行时实例记下当时的目标（进程 / 世界）：换了目标世界，这条在「最近看过」里标灰 */
  scope?: string
}

export interface NavState {
  items: NavEntry[]
  /** 当前停在哪一条；没有记录时是 -1 */
  index: number
}

/** 最多留 50 条（再多就丢最早的），「最近看过」列 20 条 */
export const NAV_MAX = 50
export const RECENT_MAX = 20

export const EMPTY: NavState = { items: [], index: -1 }

const same = (a: NavEntry | undefined, page: NavPage, path: string) => !!a && a.page === page && a.path === path

export const current = (s: NavState): NavEntry | undefined => s.items[s.index]
export const canBack = (s: NavState) => s.index > 0
export const canForward = (s: NavState) => s.index >= 0 && s.index < s.items.length - 1

/** 换掉当前这条的组件（同一个 Actor 里切组件不加记录，只记下来，后退回来时恢复） */
export function setComp(s: NavState, comp: string | undefined): NavState {
  const cur = current(s)
  if (!cur || (cur.comp ?? '') === (comp ?? '')) return s
  const items = s.items.slice()
  items[s.index] = { ...cur, comp: comp || undefined }
  return { ...s, items }
}

/**
 * 新看一个东西：和当前是同一个对象时只更新组件（不加记录）；否则丢掉前进的部分（和浏览器一样），接在后面，
 * 超过上限丢最早的
 */
export function push(s: NavState, e: NavEntry): NavState {
  if (same(current(s), e.page, e.path)) return setComp(s, e.comp)
  const items = [...s.items.slice(0, s.index + 1), e]
  const drop = Math.max(0, items.length - NAV_MAX)
  return { items: drop ? items.slice(drop) : items, index: items.length - 1 - drop }
}

export function back(s: NavState): NavState {
  return canBack(s) ? { ...s, index: s.index - 1 } : s
}

export function forward(s: NavState): NavState {
  return canForward(s) ? { ...s, index: s.index + 1 } : s
}

export function jump(s: NavState, i: number): NavState {
  return i >= 0 && i < s.items.length && i !== s.index ? { ...s, index: i } : s
}

/** 清空记录：只留当前这一条（导航条上的面包屑还要显示正在看的） */
export function clear(s: NavState): NavState {
  const cur = current(s)
  return cur ? { items: [{ ...cur, via: undefined }], index: 0 } : EMPTY
}

/**
 * 地址变了（点了东西、浏览器后退、从别处 go 进来）时把历史对上地址，保证两者不会不一致：
 * - 地址就是当前这条：只更新组件；
 * - 没带说明（不是网页里点的，例如浏览器自己的后退 / 前进）且地址是前一条或后一条：移过去，不新加；
 * - 其余当成新看一个东西，push（meta 是点的时候留下的 via / from，没有就记成 link）。
 */
export function sync(
  s: NavState,
  page: NavPage,
  path: string,
  comp: string | undefined,
  meta?: Pick<NavEntry, 'via' | 'from' | 'scope'>,
): NavState {
  if (!path) return s
  if (same(current(s), page, path)) return setComp(s, comp)
  if (!meta) {
    for (const i of [s.index - 1, s.index + 1])
      if (same(s.items[i], page, path)) return setComp({ ...s, index: i }, comp)
  }
  return push(s, { page, path, comp: comp || undefined, from: meta?.from ?? (meta?.via ? undefined : 'link'), ...meta })
}

/**
 * 面包屑：从最近一次在浏览栏点选（没有 via 的那条）开始，一路点引用走到当前的几步。
 * 返回记录和它在 items 里的下标（点前面的段 = jump 过去）
 */
export function chain(s: NavState): { entry: NavEntry; index: number }[] {
  if (s.index < 0) return []
  let start = s.index
  while (start > 0 && s.items[start].via) start--
  return s.items.slice(start, s.index + 1).map((entry, k) => ({ entry, index: start + k }))
}

/** 最近看过：新的在上，同一个对象只留最近的一次，最多 20 条 */
export function recent(s: NavState): { entry: NavEntry; index: number; current: boolean }[] {
  const seen = new Set<string>()
  const out: { entry: NavEntry; index: number; current: boolean }[] = []
  for (let i = s.items.length - 1; i >= 0 && out.length < RECENT_MAX; i--) {
    const e = s.items[i]
    const k = `${e.page}|${e.path}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ entry: e, index: i, current: i === s.index })
  }
  return out
}

/** 拆地址里的子位置：「对象路径|组件路径」 */
export function splitSub(sub: string): { path: string; comp?: string } {
  const i = sub.indexOf('|')
  return i < 0 ? { path: sub } : { path: sub.slice(0, i), comp: sub.slice(i + 1) || undefined }
}

export const joinSub = (path: string, comp?: string) => (comp ? `${path}|${comp}` : path)
