import { useEffect, useRef } from 'react'
import type { Target } from '../../../server/types.ts'
import { op } from '../../api.ts'
import { useKept } from '../../keep.ts'

/** assets.children 的一层（服务端 ue/server/asset-folders-disk.ts 的 Children） */
export interface Folder {
  name: string
  path: string
  count?: number
  root?: 'game' | 'plugin' | 'engine'
}
export interface Item {
  name: string
  path: string
  class: string
}
export interface Level {
  folders: Folder[]
  items: Item[]
  more?: boolean
  total?: number
  note?: string
  /** 桥接的资源注册表还在扫盘 */
  loading?: boolean
  source?: 'bridge' | 'disk'
  error?: string
  /** 网页这边正在读 */
  busy?: boolean
}

const EMPTY: Level = { folders: [], items: [] }

/** 一层最多列多少：和服务端、UELink 的默认上限一致，再多在上面的搜索框里搜 */
export const LIMIT = 500

/** 对象路径 → 包路径：/Game/A/B.B → /Game/A/B（选中、定位时两种写法都可能来） */
export const pkgOf = (p: string) => p.split(':')[0].split('.')[0].replace(/\/$/, '')

/**
 * 文件夹树的数据：哪些层读过（levels）、哪些展开了（open），都按 项目/目标 留在 keep.ts 里，切页回来不重读。
 * 类型筛选变了整份缓存作废，已经展开的层按新类型重读（文件夹里只列这个类型的资源）
 */
export function useFolderData(projectId: string, target: Target) {
  const kk = `${projectId}/assets/folders/${target.instance ?? ''}`
  const [levels, setLevelsRaw] = useKept<Record<string, Level>>(`${kk}/levels`, {})
  // Content 默认展开；Engine 默认收起，展开才读（用户定）
  const [open, setOpen] = useKept<Record<string, boolean>>(`${kk}/open`, { '/Game': true })
  const [cls, setClsRaw] = useKept(`${kk}/cls`, '')
  // 异步的逐层定位要读到最新的缓存，不能用渲染时闭包里的
  const cache = useRef(levels)
  cache.current = levels
  const clsRef = useRef(cls)
  clsRef.current = cls
  // 换了类型后，旧类型还没回来的结果丢掉
  const gen = useRef(0)
  const inflight = useRef(new Map<string, Promise<Level | undefined>>())

  const setLevels = (f: (m: Record<string, Level>) => Record<string, Level>) =>
    setLevelsRaw((m) => {
      const n = f(m)
      cache.current = n
      return n
    })

  const load = (path: string): Promise<Level | undefined> => {
    const my = gen.current
    const key = `${my}|${path}`
    const running = inflight.current.get(key)
    if (running) return running
    setLevels((m) => ({ ...m, [path]: { ...(m[path] ?? EMPTY), busy: true, error: undefined } }))
    const p = op<Level>(projectId, 'assets.children', { path, class: clsRef.current, limit: LIMIT }, target, 60000)
      .then(
        (r) => {
          const lv: Level = {
            folders: r.folders ?? [],
            items: r.items ?? [],
            more: r.more,
            total: r.total,
            note: r.note,
            loading: r.loading,
            source: r.source,
          }
          if (my === gen.current) setLevels((m) => ({ ...m, [path]: lv }))
          return lv
        },
        (e: Error) => {
          if (my === gen.current) setLevels((m) => ({ ...m, [path]: { ...EMPTY, error: e.message } }))
          return undefined
        },
      )
      .finally(() => inflight.current.delete(key))
    inflight.current.set(key, p)
    return p
  }

  /** 读过且没出错就用缓存，否则读 */
  const ensure = (path: string) => {
    const lv = cache.current[path]
    return lv && !lv.error && !lv.busy ? Promise.resolve(lv) : load(path)
  }

  // 第一次进来（或缓存被清掉后）：读挂载根和已经展开的层
  useEffect(() => {
    if (!cache.current['/']) void load('/')
    for (const [p, on] of Object.entries(open)) if (on && p.startsWith('/') && !cache.current[p]) void load(p)
    // 只在换项目 / 目标时补读；展开时由 toggle 读
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [kk])

  // 展开时缓存里有就先显示，同时重读一次换成最新的：缓存一直留到整页刷新，编辑器刚启动注册表没扫完、
  // 或之后新加了资源时读到的那份会一直是空的 / 旧的（用户 2026-11-19「有些文件夹展开显示为空」）
  const toggle = (key: string) => {
    const next = !open[key]
    setOpen((m) => ({ ...m, [key]: next }))
    if (next && key.startsWith('/')) void load(key)
  }

  /** 页头「刷新」：挂载根和展开着的层全部重读；旧数据先留着，读回来再换，不闪成空 */
  const reload = () => {
    gen.current++
    inflight.current.clear()
    void load('/')
    for (const [p, on] of Object.entries(open)) if (on && p.startsWith('/')) void load(p)
  }

  const setCls = (c: string) => {
    if (c === clsRef.current) return
    clsRef.current = c
    setClsRaw(c)
    gen.current++
    inflight.current.clear()
    setLevels(() => ({}))
    void load('/')
    for (const [p, on] of Object.entries(open)) if (on && p.startsWith('/')) void load(p)
  }

  /**
   * 展开到一个文件夹（kind=folder，连它自己也展开）或资源所在的文件夹，逐层读；返回要滚到的行的 key。
   * 插件的挂载点在虚拟的「Plugins」下，引擎插件在「Engine / Plugins」下，这两个也要展开
   */
  const revealPath = async (to: string, kind: 'asset' | 'folder') => {
    const pkg = pkgOf(to)
    const folder = kind === 'asset' ? pkg.slice(0, pkg.lastIndexOf('/')) : pkg
    const segs = folder.split('/').filter(Boolean)
    if (!segs.length) return undefined
    const chain = segs.map((_, i) => '/' + segs.slice(0, i + 1).join('/'))
    const root = await ensure('/')
    const mount = root?.folders.find((f) => f.path.toLowerCase() === chain[0].toLowerCase())
    const extra: string[] = []
    if (mount?.root === 'plugin') extra.push('#plugins')
    else if (mount?.root === 'engine' && chain[0] !== '/Engine') extra.push('/Engine', '#engine-plugins')
    setOpen((m) => ({ ...m, ...Object.fromEntries([...extra, ...chain].map((k) => [k, true])) }))
    if (extra.includes('/Engine')) void ensure('/Engine')
    for (const p of chain) {
      const lv = await ensure(p)
      if (!lv) break
    }
    return kind === 'asset' ? `i:${pkg}` : `f:${folder}`
  }

  return { levels, open, toggle, load, reload, cls, setCls, revealPath }
}
