import { useEffect, useState } from 'react'
import {
  classKey,
  lastSegOf,
  luaClassOf,
  rebasePath,
  shortClass,
  type GtClassItem,
  type GtClassesResult,
  type GtPropGroup,
  type GtPropItem,
  type GtRef,
  type GtTreeNode,
} from '../../../../../shared/gt-script/index.ts'
import type { Prop } from '../../../../details/model.ts'
import { t } from '../../../../host.ts'
import { useRefRpc } from '../live.ts'

/**
 * 选对象面板（一页）的数据：类树（gt.classes）、此刻实例的 UMG 子树（gt.tree root）、属性树（gt.props）按页签分、
 * 转成细节面板（details/Details.tsx）的行。只取数和整理，界面在同目录的各栏组件里
 */

export type ClassKind = GtClassItem['kind']

/** 在哪找的三个开关（都不选 = all） */
export const SOURCES = ['screen', 'world', 'lua'] as const
export type Source = (typeof SOURCES)[number]

/** 类的种类 → 能在哪找到它（对不上的开关置灰） */
export function sourcesFor(kind: ClassKind | undefined): Source[] {
  if (kind === 'umg') return ['screen', 'lua']
  if (kind === 'actor' || kind === 'component') return ['world', 'lua']
  if (kind === 'lua') return ['screen', 'world', 'lua']
  if (kind === 'object') return ['lua']
  return [...SOURCES]
}

/** 刚定类时默认勾哪个：界面在屏上找，Actor 在关卡里找，Lua 类在 Lua 对象里找 */
export function defaultSources(kind: ClassKind | undefined): Source[] {
  if (kind === 'umg') return ['screen']
  if (kind === 'actor' || kind === 'component') return ['world']
  if (kind === 'lua') return ['lua']
  return []
}

/** 引用里的 in → 开关；对象写法、@来源 返回 undefined（不归开关管） */
export function sourcesOfIn(inn: unknown): Source[] | undefined {
  if (inn === undefined || inn === 'all') return []
  const list = typeof inn === 'string' ? [inn] : Array.isArray(inn) ? inn : undefined
  if (!list || list.some((x) => !(SOURCES as readonly unknown[]).includes(x))) return undefined
  return list as Source[]
}

/** 开关 → 存进脚本的 in：一个写字符串，几个写数组，都不选写 all */
export const inOfSources = (s: Source[]): GtRef['in'] => (s.length === 0 ? 'all' : s.length === 1 ? s[0] : [...s])

/** 调 gt.classes：类树一层（parent）或按开头搜（q，带上命中项的祖先） */
export function useClasses(project: string, args: { parent?: string; q?: string; lua?: boolean } | undefined) {
  const rpc = useRefRpc()
  const [data, setData] = useState<GtClassesResult>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = args ? JSON.stringify(args) : ''
  useEffect(() => {
    setError('')
    if (!key) return setData(undefined)
    let off = false
    setLoading(true)
    rpc<GtClassesResult>(project, 'gt.classes', { ...(JSON.parse(key) as object), limit: 200 })
      .then((r) => !off && setData(r))
      .catch((e: Error) => !off && (setError(e.message), setData(undefined)))
      .finally(() => !off && setLoading(false))
    return () => {
      off = true
    }
  }, [project, key, rpc])
  return { data, error, loading }
}

/** 一个类的条目（拿种类、资产路径）：按名字搜一次，找同名的那个；lua: 类直接是 lua */
export function useClassInfo(project: string, cls: string): GtClassItem | undefined {
  const lua = luaClassOf(cls)
  const q = cls ? (lua ?? shortClass(cls)) : ''
  const r = useClasses(project, q ? { q, ...(lua !== undefined ? { lua: true } : {}) } : undefined)
  if (!cls) return undefined
  const want = classKey(cls)
  const hit = r.data?.items.find((x) => classKey(lua !== undefined ? `lua:${x.name}` : x.name) === want)
  if (hit) return hit
  if (lua !== undefined) return { name: lua, kind: 'lua', kids: 0 }
  // 类树还没回来（或 GameTest 旧、没有 gt.classes）：按名字粗猜，只用来定图标和默认的「在哪找」
  const s = shortClass(cls)
  const kind: ClassKind = /^(W|WBP|UI)_/i.test(s)
    ? 'umg'
    : /Component$/i.test(s)
      ? 'component'
      : /^(BP|A)_/i.test(s)
        ? 'actor'
        : 'object'
  return { name: s, kind, kids: 0 }
}

/** 此刻游戏里一个界面的 UMG 子树（gt.tree root）：选中实例时读一次，不轮询 */
export function useSubtree(project: string, root: string | undefined) {
  const rpc = useRefRpc()
  const [nodes, setNodes] = useState<GtTreeNode[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    setNodes([])
    setError('')
    if (!root) return
    let off = false
    rpc<{ nodes: GtTreeNode[] }>(project, 'gt.tree', { root })
      .then((r) => !off && setNodes(r.nodes ?? []))
      .catch((e: Error) => !off && setError(e.message))
    return () => {
      off = true
    }
  }, [project, root, rpc])
  return { nodes, error }
}

/** 细节栏的四个页签：按路径最后一段分（.名字() 方法、#名字 Lua、:名字 运行状态，其余属性） */
export type DetailTab = 'props' | 'fns' | 'lua' | 'states'

export function tabOf(item: GtPropItem): DetailTab {
  // Lua 类的函数（functions 组）放「方法」页
  if (item.luaFn) return 'fns'
  const last = lastSegOf(item.prop)
  if (last?.kind === 'fn') return 'fns'
  if (last?.kind === 'lua' || item.src === 'lua') return 'lua'
  if (last?.kind === 'state' || item.src === 'state') return 'states'
  return 'props'
}

/**
 * 属性树的项（只要对象自己和条目数据那几组；部件组是折叠的，点结构栏的子控件时再读）。
 * part：按部件读回来的项，路径还是从部件写的时，拼上 `/部件`（UE 已经从外层对象写的不重复拼）
 */
export function itemsOf(groups: GtPropGroup[] | undefined, part?: string): GtPropItem[] {
  const out: GtPropItem[] = []
  for (const g of groups ?? []) {
    if (g.part && g.collapsed) continue
    for (const it of g.items) out.push(part ? { ...it, prop: rebasePath(it.prop, part) } : it)
  }
  return out
}

/** 同类几个实例里这一项有几种值：标识挑「各不相同」的最好 */
function noteOf(it: GtPropItem, siblings?: number): string | undefined {
  const parts: string[] = []
  if (it.distinct !== undefined && siblings && siblings > 1)
    parts.push(
      it.distinct >= siblings
        ? t('同类 {n} 个里各不相同', { n: siblings })
        : it.distinct <= 1
          ? t('同类 {n} 个里都一样', { n: siblings })
          : t('同类 {n} 个里 {d} 种', { n: siblings, d: it.distinct }),
    )
  if (it.changing) parts.push(t('会变'))
  if (it.note) parts.push(it.note)
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * gt.props 的项 → 细节面板的行。name 用属性路径本身：细节面板展开结构体、数组时子行的路径是「父路径 + .成员 / [i]」，
 * 正好是 v5 的写法，准星加标识时直接用。分组按 UE 的 Category（cat），没有时按 gt.props 的组名
 */
export function toDetailProps(items: GtPropItem[], groupTitle: (it: GtPropItem) => string, siblings?: number): Prop[] {
  return items.map((it) => ({
    name: it.prop,
    displayName: it.name,
    type: it.type,
    category: it.cat || groupTitle(it),
    value: it.value,
    ...(it.members?.length ? { enum: it.members } : {}),
    readOnly: true,
    readOnlyWhy: t('这里只看此刻的值；要改值在脚本里用 obj.set'),
    edit: true,
    note: noteOf(it, siblings),
  }))
}
