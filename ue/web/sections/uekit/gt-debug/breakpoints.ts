import { useSyncExternalStore } from 'react'

/**
 * 断点（定稿 9.2「运行控制」、列表视图的 F9）：每个人自己调试用的，不进场景文件，存浏览器（按项目 + 脚本分开）。
 * 按步骤 key 记（有 id 用 id，没有用路径，和流程图的 stepKey 一样；UE 的 gt.run / gt.debug 也认这两种）。
 * 编辑页打开时把自己设成「当前脚本」，画布节点、列表行、命令都只看当前脚本的断点，不用层层传参
 */
const STORE_KEY = 'ue.gt.breakpoints'

type Listener = () => void
const listeners = new Set<Listener>()
let scope = ''
let all: Record<string, string[]> = load()
/** 当前脚本的断点：useSyncExternalStore 要同一个对象，改了才换新的 */
let current: ReadonlySet<string> = new Set()

function load(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all))
  } catch {
    // 存不了就只在这次打开里有效
  }
}

function emit() {
  current = new Set(all[scope] ?? [])
  for (const l of listeners) l()
}

const subscribe = (l: Listener) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** 编辑页打开某个脚本时调（project + 场景相对路径） */
export function setBreakpointScope(project: string, scenario: string) {
  const next = `${project}|${scenario}`
  if (next === scope) return
  scope = next
  emit()
}

export const breakpoints = (): ReadonlySet<string> => current

export function setBreakpoints(keys: Iterable<string>) {
  if (!scope) return
  const list = [...new Set(keys)]
  if (list.length) all = { ...all, [scope]: list }
  else {
    const { [scope]: _, ...rest } = all
    all = rest
  }
  persist()
  emit()
}

export function toggleBreakpoint(key: string) {
  const s = new Set(current)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  setBreakpoints(s)
}

/** 当前脚本的全部断点 */
export const useBreakpoints = () => useSyncExternalStore(subscribe, breakpoints)

/** 某一步上有没有断点：节点、行只关心自己这一个 */
export const useHasBreakpoint = (key: string | undefined) =>
  useSyncExternalStore(subscribe, () => !!key && current.has(key))
