import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type {
  GtPropGroup,
  GtPropsResult,
  GtRef,
  GtRefForResult,
  GtRefLike,
  GtTarget,
  GtTreeNode,
} from '../../../../shared/gt-script/ref/types.ts'
import { op } from '../../../api.ts'
import { useLiveWatch } from '../gt-live/use-watch.ts'
import { inlineRef } from './describe.ts'
import { normalizeGroups } from './props-shape.ts'

/**
 * GameTest 2.0 新操作（协议第 7 节）的前端调用：gt.props、gt.tree、gt.highlight、gt.refFor，
 * 以及「命中几个」（gt.resolve refs，挂在 gt.watch 上收推送，不轮询）
 */

/**
 * 调桥接操作的入口：默认就是 op；设置「控件样式」里的示例换成假数据（不连 UE 也能看、能调样式），
 * 组件本身不知道是不是示例
 */
export type RefRpc = <T>(project: string, name: string, args: Record<string, unknown>) => Promise<T>
const RpcCtx = createContext<RefRpc>(op)
export const RefRpcProvider = RpcCtx.Provider
export const useRefRpc = () => useContext(RpcCtx)

/** gt.props 的参数：三选一（node / target / class），可选 part */
export type PropsArgs = (
  | { node: string; part?: string }
  | { target: GtTarget; part?: string }
  | { class: string; part?: string }
) & {
  /** 知道对象绑的 Lua 模块时传：UE 读不到也能列出 ---@field 声明的字段 */
  luaModule?: string
}

/** gt.props 的返回：UE 读不到时服务端只给 Lua 声明字段（self 组），unavailable 写原因 */
export type PropsData = GtPropsResult & { unavailable?: string; luaFile?: string }

/** 读一个对象的属性树；嵌套界面展开时再按 part 读一次（loadPart） */
export function useProps(project: string, args: PropsArgs | undefined) {
  const rpc = useRefRpc()
  const [data, setData] = useState<PropsData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = args ? JSON.stringify(args) : ''
  useEffect(() => {
    setData(undefined)
    setError('')
    if (!key) return
    let off = false
    setLoading(true)
    rpc<PropsData>(project, 'gt.props', JSON.parse(key) as Record<string, unknown>)
      .then((r) => !off && setData({ ...r, groups: normalizeGroups(r) }))
      .catch((e: Error) => !off && setError(e.message))
      .finally(() => !off && setLoading(false))
    return () => {
      off = true
    }
  }, [project, key, rpc])
  const loadPart = async (part: string): Promise<GtPropGroup[] | undefined> => {
    if (!args) return undefined
    const r = await rpc<GtPropsResult>(project, 'gt.props', { ...args, part, siblings: true })
    return normalizeGroups(r)
  }
  return { data, error, loading, loadPart }
}

/** 此刻游戏页面上的 UMG 树（gt.tree）：打开时读一次，点「刷新」再读；不轮询 */
export function useTree(project: string, on: boolean, opts: { filter?: string; onlyVisible?: boolean }) {
  const rpc = useRefRpc()
  const [nodes, setNodes] = useState<GtTreeNode[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<{ total?: number; truncated?: boolean }>({})
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    if (!on) return
    let off = false
    setLoading(true)
    rpc<{ nodes: GtTreeNode[]; total?: number; truncated?: boolean }>(project, 'gt.tree', {
      ...(opts.filter ? { filter: opts.filter } : {}),
      ...(opts.onlyVisible ? { onlyVisible: true } : {}),
    })
      .then((r) => {
        if (off) return
        setNodes(r.nodes ?? [])
        setInfo({ total: r.total, truncated: r.truncated })
        setError('')
      })
      .catch((e: Error) => !off && setError(e.message))
      .finally(() => !off && setLoading(false))
    return () => {
      off = true
    }
  }, [project, on, opts.filter, opts.onlyVisible, seq, rpc])
  return { nodes, error, loading, ...info, refresh: () => setSeq((n) => n + 1) }
}

/** 在游戏画面上描边（gt.highlight）；失败不打扰（描边只是辅助） */
export function highlight(
  project: string,
  args: { node?: string; target?: GtTarget; clear?: boolean },
  rpc: RefRpc = op,
) {
  return rpc(project, 'gt.highlight', args).catch(() => undefined)
}

/** 从树里点到的节点出命中链和推荐引用（gt.refFor） */
export const refFor = (project: string, node: string, level?: number, rpc: RefRpc = op) =>
  rpc<GtRefForResult>(project, 'gt.refFor', { node, ...(level === undefined ? {} : { level }) })

/** gt.resolve refs 的一项结果（协议 7.6） */
export interface RefHits {
  count: number
  candidates?: { name: string; ident?: { prop: string; actual: unknown }[] }[]
  error?: string
}

/**
 * 一组引用此刻各命中几个：连着游戏时挂一项 gt.watch（op gt.resolve，参数 refs），之后只收推送。
 * 名字引用先按场景的 objects 展开（gt.resolve 拿不到正在编辑、还没存的场景）。
 * show：额外要每个候选这些属性的值（同类实例表写「排除：因为哪条」用；GameTest 不认时忽略）
 */
export function useRefHits(
  project: string,
  live: boolean,
  refs: { id: string; ref: GtRefLike }[],
  objects?: Record<string, unknown>,
  show?: string[],
): { hits: Record<string, RefHits | undefined>; ready: boolean; error: string } {
  // 调用方每次渲染都传新数组：按内容比，内容没变不重新登记
  const sig =
    live && refs.length ? JSON.stringify([refs.map((r) => ({ id: r.id, ref: inlineRef(r.ref, objects) })), show]) : ''
  const items = useMemo(() => {
    if (!sig) return undefined
    const [list, sh] = JSON.parse(sig) as [unknown[], string[] | undefined]
    return { refs: { op: 'gt.resolve' as const, args: { refs: list, ...(sh?.length ? { show: sh } : {}) } } }
  }, [sig])
  const w = useLiveWatch(project, items)
  const res = w.results.refs as { refs?: (RefHits & { id: string })[]; error?: string } | undefined
  const hits: Record<string, RefHits | undefined> = {}
  for (const r of res?.refs ?? []) hits[r.id] = r
  return { hits, ready: w.ready, error: res?.error ?? w.error }
}

/** 一个引用此刻命中几个（对象卡片用） */
export function useRefHit(
  project: string,
  live: boolean,
  ref: GtRefLike | undefined,
  objects?: Record<string, unknown>,
) {
  const r = useRefHits(project, live, ref ? [{ id: 'r', ref }] : [], objects)
  return { hit: r.hits.r, error: r.error }
}

/** 只按类、不带标识的引用（同类实例表：此刻屏上 / 世界里一共几个） */
export const classOnly = (r: GtRef): GtRef => ({ class: r.class, ...(r.in ? { in: r.in } : {}) })
