import path from 'node:path'
import type { GtClassItem, GtClassRow, GtClassesResult } from '../../shared/gt-script/ref/types.ts'
import { searchText } from '../../shared/gt-script/ref/search-text.ts'
import { nativeParents } from '../search-index/native-widgets.ts'
import { projectMounts } from '../search-index/mounts.ts'
import { searchIndex } from '../search-index/index.ts'
import { shortClass } from '../search-index/uetovs.ts'
import type { UeProject } from '../types.ts'
import { headerTrees, ueMemo } from '../memo.ts'
import { readLuaHead } from './lua-parents.ts'
import { readBpTags } from './uasset-tags.ts'

/**
 * gt.classes 的离线版（用户 2026-11-21：类树不用编辑器启动）：UE 没开、GameTest 太旧时由 gt-ref/ops.ts 改走这里，
 * 返回和 UE 一样的形状（协议 7.7），只是没有 live（此刻实例数）。数据都来自磁盘：
 * - UObject：引擎常见类的骨架 + 项目头文件里的 UCLASS 继承（native-widgets.ts）+ 蓝图（跳转索引；有 UEToVS 索引用它记的父类，
 *   没有时读 .uasset 开头的资产注册表标签，见 uasset-tags.ts）
 * - Lua：跳转索引里的 Lua 模块 + 每个文件开头的继承写法（lua-parents.ts）
 */

/** 引擎里常见的类和父类：离线读不到引擎头文件，只放这一层骨架，项目类和蓝图挂在它们下面；不认识的父类挂在 Object 下 */
const ENGINE: [string, string][] = [
  ['Actor', 'Object'],
  ['Pawn', 'Actor'],
  ['Character', 'Pawn'],
  ['Controller', 'Actor'],
  ['PlayerController', 'Controller'],
  ['AIController', 'Controller'],
  ['GameModeBase', 'Actor'],
  ['GameMode', 'GameModeBase'],
  ['GameStateBase', 'Actor'],
  ['GameState', 'GameStateBase'],
  ['PlayerState', 'Actor'],
  ['HUD', 'Actor'],
  ['ActorComponent', 'Object'],
  ['SceneComponent', 'ActorComponent'],
  ['PrimitiveComponent', 'SceneComponent'],
  ['MeshComponent', 'PrimitiveComponent'],
  ['StaticMeshComponent', 'MeshComponent'],
  ['SkinnedMeshComponent', 'MeshComponent'],
  ['SkeletalMeshComponent', 'SkinnedMeshComponent'],
  ['Visual', 'Object'],
  ['Widget', 'Visual'],
  ['UserWidget', 'Widget'],
  ['CommonUserWidget', 'UserWidget'],
  ['CommonActivatableWidget', 'CommonUserWidget'],
  ['CommonButtonBase', 'CommonUserWidget'],
  ['EditorUtilityWidget', 'UserWidget'],
  ['AnimInstance', 'Object'],
  ['DataAsset', 'Object'],
  ['PrimaryDataAsset', 'DataAsset'],
  ['GameInstance', 'Object'],
  ['Subsystem', 'Object'],
  ['GameInstanceSubsystem', 'Subsystem'],
  ['WorldSubsystem', 'Subsystem'],
  ['LocalPlayerSubsystem', 'Subsystem'],
  ['BlueprintFunctionLibrary', 'Object'],
  ['SaveGame', 'Object'],
]

const ROOT = 'Object'
const LIMIT = 200
const LIMIT_MAX = 500
/** 读结构的上限（ADR 0067、协议 7.7） */
const MAX_CHARS = 12000
const PARALLEL = 32

type Node = Omit<GtClassItem, 'kids' | 'kind'> & { kind?: GtClassItem['kind'] }

export interface OfflineArgs {
  parent?: string
  q?: string
  lua?: boolean
  /** Lua 按目录列（空 = 最顶层），协议 7.7 */
  dir?: string
  /** 不用缓存重建类表（面板的「刷新」） */
  fresh?: boolean
  offset?: number
  limit?: number
}

/** 项目头文件里的原生父类：Source / Plugins 下的 .h 改了就重读，盯不住时五分钟重读（面板派生缓存，ADR 0074） */
const natives = ueMemo<string, Map<string, string>>({
  name: 'ue.class-headers',
  load: nativeParents,
  ttlMs: 5 * 60_000,
  watch: headerTrees,
})
const projectNatives = (root: string) => natives.get(root)

async function pool<T, R>(list: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length)
  let i = 0
  const work = async () => {
    for (let k = i++; k < list.length; k = i++) out[k] = await fn(list[k])
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, work))
  return out
}

const BP_TYPES = new Set(['Blueprint', 'WidgetBlueprint', 'AnimBlueprint', 'EditorUtilityWidgetBlueprint'])

/** 对象路径 /Game/UI/W_Shop.W_Shop → 磁盘上的 .uasset */
export function assetFile(objectPath: string, mounts: { mount: string; dir: string }[]) {
  const pkg = objectPath.slice(0, objectPath.lastIndexOf('.'))
  for (const m of mounts)
    if (pkg.startsWith(m.mount + '/')) return path.join(m.dir, `${pkg.slice(m.mount.length + 1)}.uasset`)
  return undefined
}

async function ueNodes(p: UeProject): Promise<Map<string, Node>> {
  const nodes = new Map<string, Node>([[ROOT, { name: ROOT }]])
  for (const [c, parent] of ENGINE) nodes.set(c, { name: c, parent })
  for (const [c, parent] of await projectNatives(p.root)) if (!nodes.has(c)) nodes.set(c, { name: c, parent })
  const idx = await searchIndex(p)
  const mounts = await projectMounts(p.root)
  // UEToVS 的索引记了父类（第三项）；自己扫磁盘的没有类型，只能读 .uasset 开头的标签
  const known = idx.assets.filter((a) => BP_TYPES.has(a[1]))
  const unknown = idx.assets.filter((a) => a[1] === '' && !/\.umap$/i.test(a[0]))
  const read = await pool(unknown, async (a) => {
    const file = assetFile(a[0], mounts)
    const tags = file ? await readBpTags(file) : undefined
    return tags ? ([a[0], shortClass(tags.parent || tags.native)] as const) : undefined
  })
  const bps: (readonly [string, string])[] = [
    ...known.map((a) => [a[0], a[2] ?? ''] as const),
    ...read.filter((x): x is readonly [string, string] => !!x),
  ]
  for (const [objectPath, parent] of bps) {
    const name = objectPath.slice(objectPath.lastIndexOf('.') + 1)
    nodes.set(name, { name, parent: parent || ROOT, asset: objectPath })
  }
  // 父类不在表里的（引擎里别的类）挂到 Object 下，保证每个节点都能从 Object 走到
  for (const n of [...nodes.values()])
    if (n.parent && !nodes.has(n.parent)) nodes.set(n.parent, { name: n.parent, parent: ROOT })
  for (const n of nodes.values()) n.kind = kindOf(n.name, nodes)
  return nodes
}

/** 顺着父类往上：碰到 UserWidget 是界面、ActorComponent 是组件、Actor 是 Actor，其余 UObject */
function kindOf(name: string, nodes: Map<string, Node>): GtClassItem['kind'] {
  const seen = new Set<string>()
  for (let cur: string | undefined = name; cur && !seen.has(cur); cur = nodes.get(cur)?.parent) {
    seen.add(cur)
    if (cur === 'UserWidget') return 'umg'
    if (cur === 'ActorComponent') return 'component'
    if (cur === 'Actor') return 'actor'
  }
  return 'object'
}

async function luaNodes(p: UeProject): Promise<Map<string, Node>> {
  const idx = await searchIndex(p)
  const heads = await pool(idx.lua, (l) => readLuaHead(l[1]))
  const mods = new Set(idx.lua.map((l) => l[0]))
  // ---@class 的类名 → 模块名：注解里的父类写的是类名时对回模块
  const byCls = new Map<string, string>()
  idx.lua.forEach((l, i) => heads[i].cls && byCls.set(heads[i].cls!, l[0]))
  const nodes = new Map<string, Node>()
  idx.lua.forEach(([mod, file], i) => {
    const raw = heads[i].parent
    const parent = raw && (mods.has(raw) ? raw : byCls.get(raw))
    nodes.set(mod, {
      name: mod,
      ...(parent && parent !== mod ? { parent } : {}),
      kind: 'lua',
      file: path.relative(p.root, file).replace(/\\/g, '/'),
    })
  })
  return nodes
}

const segs = (s: string) => s.replace(/\./g, '/').split('/').filter(Boolean)
/** Lua 模块所在目录：按 / 和 . 切段去掉最后一段（和 UE 侧 gt.classes 一致） */
export const luaFolderOf = (name: string) => segs(name).slice(0, -1).join('/')

/** Lua 按目录：正好在 dir 下的模块 + 下一层子目录和其下模块数 */
function pickDir(nodes: Map<string, Node>, rawDir: string) {
  const dir = segs(rawDir).join('/')
  const low = dir.toLowerCase()
  const prefix = dir ? `${low}/` : ''
  const list: Node[] = []
  const dirs = new Map<string, number>()
  for (const n of nodes.values()) {
    const folder = luaFolderOf(n.name)
    if (folder.toLowerCase() === low) list.push(n)
    else if (!prefix || folder.toLowerCase().startsWith(prefix)) {
      const head = folder.slice(prefix.length).split('/')[0]
      const key = (dir ? `${dir}/` : '') + head
      dirs.set(key, (dirs.get(key) ?? 0) + 1)
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  return { list, dirs: [...dirs].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })) }
}

/** 纯逻辑（单测用）：节点表按参数取一层或按名字搜，算 kids、分页、控制长度 */
export function pickClasses(nodes: Map<string, Node>, args: OfflineArgs, rootName?: string): GtClassesResult {
  const kids = new Map<string, number>()
  for (const n of nodes.values()) if (n.parent) kids.set(n.parent, (kids.get(n.parent) ?? 0) + 1)
  const item = (n: Node): GtClassItem => ({
    name: n.name,
    ...(n.parent ? { parent: n.parent } : {}),
    kind: n.kind ?? 'object',
    ...(n.asset ? { asset: n.asset } : {}),
    ...(n.file ? { file: n.file } : {}),
    kids: kids.get(n.name) ?? 0,
  })
  let list: Node[]
  let dirs: { name: string; count: number }[] | undefined
  const q = args.q?.trim().toLowerCase()
  if (!q && args.lua && typeof args.dir === 'string') {
    const r = pickDir(nodes, args.dir)
    list = r.list
    dirs = r.dirs
  } else if (q) {
    // 档次：开头对上的命中和它的祖先是 0，其余 1；分页截掉的是后面那档（和 UE 侧 gt.classes 一致）
    const want = new Map<string, number>()
    const hits = [...nodes.values()]
      // 名字里含 q 就算（用户 2026-11-21：不要只按开头）
      .filter((n) => searchText(n.name, q).includes(q))
      .map((n) => ({ n, rank: searchText(n.name, q).startsWith(q) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank)
    for (const { n, rank } of hits) {
      const seen = new Set<string>()
      for (let cur: string | undefined = n.name; cur && !seen.has(cur); cur = nodes.get(cur)?.parent) {
        seen.add(cur)
        if (!want.has(cur)) want.set(cur, rank)
      }
    }
    const depth = (name: string) => {
      let d = 0
      const seen = new Set<string>()
      for (let cur = nodes.get(name)?.parent; cur && !seen.has(cur); cur = nodes.get(cur)?.parent) (seen.add(cur), d++)
      return d
    }
    // 先按档次，同档里祖先在前（按深度），同层按名字
    list = [...want.keys()]
      .map((x) => nodes.get(x)!)
      .filter(Boolean)
      .sort(
        (a, b) =>
          want.get(a.name)! - want.get(b.name)! || depth(a.name) - depth(b.name) || a.name.localeCompare(b.name),
      )
  } else {
    const parent = args.parent || rootName
    list = [...nodes.values()]
      .filter((n) => (parent ? n.parent === parent : !n.parent))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  const offset = Math.max(0, Number(args.offset ?? 0) || 0)
  const limit = Math.min(LIMIT_MAX, Math.max(1, Number(args.limit ?? LIMIT) || LIMIT))
  const items: GtClassItem[] = []
  let size = 0
  // 子目录只在第一页给，最多占预算的一半，太多时截断标 dirsMore（和 UE 侧一致）
  let shownDirs: typeof dirs
  let dirsMore = false
  if (dirs && !offset) {
    shownDirs = []
    for (const d of dirs) {
      const n = JSON.stringify(d).length + 1
      if (shownDirs.length && size + n > MAX_CHARS / 2) {
        dirsMore = true
        break
      }
      size += n
      shownDirs.push(d)
    }
  }
  for (const n of list.slice(offset, offset + limit)) {
    const it = item(n)
    size += JSON.stringify(it).length + 1
    if (items.length && size > MAX_CHARS) break
    items.push(it)
  }
  const next = offset + items.length
  return {
    items,
    total: list.length,
    hasMore: next < list.length,
    ...(next < list.length ? { nextOffset: next } : {}),
    ...(shownDirs ? { dirs: shownDirs } : {}),
    ...(dirsMore ? { dirsMore } : {}),
  }
}

/**
 * 建好的类表按项目缓存：面板逐层展开、再打开时定位会连着发好几次，每次都 stat 全部 Lua 文件 / 读 .uasset 标签很慢
 * （用户 2026-11-21 嫌慢）。15 秒内直接复用，过期后重建（文件头按修改时间各自缓存，只重读改过的）；fresh 强制重建
 */
const nodesMemo = ueMemo<{ p: UeProject; lua: boolean }, Map<string, Node>>({
  name: 'ue.class-tree',
  keyOf: ({ p, lua }) => `${lua ? 'lua' : 'ue'}:${p.root}`,
  load: ({ p, lua }) => (lua ? luaNodes(p) : ueNodes(p)),
  ttlMs: 15_000,
})
const cachedNodes = (p: UeProject, lua: boolean, fresh: boolean) => nodesMemo.get({ p, lua }, { fresh })

/** UE 没开时的类树；why 是连不上 UE 的原因，写进 note 给界面显示 */
export async function offlineClasses(p: UeProject, args: OfflineArgs, note: string): Promise<GtClassesResult> {
  const nodes = await cachedNodes(p, !!args.lua, !!args.fresh)
  return { ...pickClasses(nodes, args, args.lua ? undefined : ROOT), note }
}

/** 面板类索引（class-index/）要的整表：磁盘上的类表摊成行，形状和 UE 的 gt.classes all 一致，没有此刻实例数 */
export async function offlineRows(p: UeProject, lua: boolean, fresh: boolean): Promise<GtClassRow[]> {
  const nodes = await cachedNodes(p, lua, fresh)
  return [...nodes.values()].map((n) => [n.name, n.parent ?? '', n.kind ?? 'object', n.asset ?? n.file ?? '', 0])
}
