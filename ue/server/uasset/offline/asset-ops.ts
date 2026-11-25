import { access, constants } from 'node:fs/promises'
import { nestedOf, type Asset } from '../../../shared/uasset/asset.ts'
import { readBlueprint } from '../../../shared/uasset/bp.ts'
import { prop, type UObj } from '../../../shared/uasset/objects.ts'
import { rowsOf } from '../../../shared/uasset/snap.ts'
import { BridgeError } from '../../instances.ts'
import { t } from '../../util.ts'
import { findObject, loadAsset, OfflineReadError } from '../read.ts'
import { registerOffline } from './registry.ts'
import { brief, clip, num, readOnlyWhy } from './shape.ts'
import { fullProps, layerNote } from '../defaults/resolve.ts'
import { parentBlueprints } from '../bp-chain.ts'

/** 资源的摘要、属性、组件（照 UELink 的 asset.describe / props / get / components） */

const pathArg = (args: Record<string, unknown>) => String(args.path ?? '').trim()

/**
 * 路径 → 对象。toCdo：和桥接 FindObjectByPath 一样，读改属性时蓝图资源换成它生成类的类默认对象（类默认值）；
 * 摘要（asset.describe）要蓝图本身
 */
export async function objectOf(project: Parameters<typeof loadAsset>[0], path: string, toCdo = false) {
  const loaded = await loadAsset(project, path)
  let o = findObject(loaded.asset, path)
  if (!o) throw new BridgeError(t('{pkg} 里没有对象 {p}', { pkg: path.split('.')[0], p: path }))
  if (toCdo && o === loaded.asset.main) {
    const cdo = readBlueprint(loaded.asset)?.cdo
    if (cdo) o = cdo
  }
  return { ...loaded, o }
}

/** 包依赖：导入表里的包 + 软引用的包（和资源注册表的依赖差不多，引用方要扫全项目才知道，离线不给） */
function dependencies(a: Asset): string[] {
  const out = new Set<string>()
  for (const im of a.pkg.imports) if (im.outer === 0 && im.className === 'Package') out.add(im.name)
  for (const p of a.pkg.softPackages) out.add(p)
  out.delete(a.pkg.packageName)
  return [...out]
}

registerOffline('asset.describe', async ({ project, args }) => {
  const { asset: a, o, file, size } = await objectOf(project, pathArg(args))
  const readOnly = await access(file, constants.W_OK).then(
    () => false,
    () => true,
  )
  const reg = a.pkg.registry.find((r) => r.objectPath === o.name || r.objectPath.endsWith(`.${o.name}`))
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(reg?.tags ?? {})) if (v.length <= 300) tags[k] = v
  const subs = nestedOf(a, o)
  const out: Record<string, unknown> = {
    path: o.path,
    name: o.name,
    class: o.class,
    classChain: [],
    package: a.pkg.packageName,
    file,
    onDisk: true,
    size,
    readOnly,
    dirty: false,
    tags,
    subobjects: subs.slice(0, 60).map(brief),
    subobjectCount: subs.length,
    dependencies: dependencies(a).length,
  }
  const bp = o === a.main ? readBlueprint(a) : undefined
  if (bp)
    out.blueprint = {
      parent: bp.parent,
      status: '',
      generatedClass: bp.gen?.path ?? '',
      graphs: bp.graphs.length,
      variables: bp.variables.length,
    }
  const rows = rowsOf(o)
  if (rows) out.dataTable = { rowStruct: String(prop(o, 'RowStruct') ?? ''), rows: rows.length }
  return { ...out, note: t('引用方（谁引用了它）要扫全项目，编辑器没开时不给') }
})

/** 属性：原型链合好的完整列表（resolve.ts），按名字开头筛（和桥接一样不分大小写） */
async function propsOf(project: Parameters<typeof loadAsset>[0], a: Asset, o: UObj, filter: string, maxChars: number) {
  const layer = await fullProps(project, a, o)
  const f = filter.toLowerCase()
  const why = readOnlyWhy()
  const props = layer.props
    .filter((p) => !f || p.name.toLowerCase().startsWith(f))
    .map((p) => {
      const { changed, ...rest } = p
      const count = Array.isArray(p.value)
        ? p.value.length
        : p.value && typeof p.value === 'object'
          ? Object.keys(p.value).length
          : 0
      return {
        ...rest,
        ...(p.container ? { count } : {}),
        readOnly: true,
        readOnlyWhy: why,
        ...(changed ? { changed: true } : {}),
        value: clip(p.value, maxChars),
      }
    })
  return { props, note: layerNote(layer) }
}

registerOffline('props', async ({ project, args }) => {
  const { asset: a, o } = await objectOf(project, pathArg(args), true)
  const { props, note } = await propsOf(project, a, o, String(args.filter ?? ''), num(args.maxChars, 2000))
  return {
    object: brief(o),
    kind: /Class$/.test(o.class) && !o.isCdo ? 'class' : 'asset',
    widget: false,
    readOnlyWhy: readOnlyWhy(),
    props,
    note,
  }
})

/** get 只认顶层属性名（文件里没有类型信息，嵌套路径 A.B[2] 按读出的值往下取） */
registerOffline('get', async ({ project, args }) => {
  const { asset: a, o } = await objectOf(project, pathArg(args), true)
  const name = String(args.prop ?? '')
  const head = /^[^.[]+/.exec(name)?.[0] ?? ''
  const layer = await fullProps(project, a, o)
  const p = layer.props.find((x) => x.name.toLowerCase() === head.toLowerCase())
  if (!p)
    throw new BridgeError(
      layer.missing.length
        ? t('{o} 的文件里没有 {p}：可能是没改过（用的是 C++ 默认值），要看默认值请打开编辑器', { o: o.name, p: name })
        : t('{o} 没有属性 {p}', { o: o.name, p: name }),
    )
  let v: unknown = p.value
  for (const m of name.slice(head.length).matchAll(/\.([^.[]+)|\[(\d+)\]/g)) {
    const key = m[1] ?? Number(m[2])
    const pick = (x: unknown) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[key] : undefined)
    // 结构体成员是小写开头（照 FJsonObjectConverter），用户照 UE 写大写开头也认
    v = pick(v) ?? (typeof key === 'string' ? pickCi(v, key) : undefined)
  }
  return { value: v ?? null, type: String(p.type ?? '') }
})

function pickCi(v: unknown, key: string) {
  if (!v || typeof v !== 'object') return undefined
  const k = Object.keys(v).find((x) => x.toLowerCase() === key.toLowerCase())
  return k === undefined ? undefined : (v as Record<string, unknown>)[k]
}

/** 和网页 bp-comps.ts 一样按类名认常见的非场景组件 */
const NOT_SCENE = /Movement|InputComponent|Perception|PawnNoise|^ActorComponent$/i

interface CompItem {
  path: string
  name: string
  class: string
  parent: string
  root: boolean
  scene: boolean
  created: string
  inherited?: boolean
}

registerOffline('components', async ({ project, args }) => {
  const path = pathArg(args)
  const { asset: a } = await loadAsset(project, path)
  const bp = readBlueprint(a)
  if (!bp) throw new BridgeError(t('这不是 Actor'))
  if (!bp.components.length && !bp.cdo) throw new OfflineReadError(t('文件里找不到类默认对象'))
  const pathOf = new Map(bp.components.map((c) => [c.name, c.obj.path]))
  const rootPath = typeof prop(bp.cdo, 'RootComponent') === 'string' ? String(prop(bp.cdo, 'RootComponent')) : ''
  const items: CompItem[] = bp.components.map((c) => {
    const scene = !NOT_SCENE.test(c.class)
    const parentPath = c.parent ? (pathOf.get(c.parent) ?? '') : ''
    return {
      path: c.obj.path,
      name: c.name,
      class: c.class,
      parent: scene ? parentPath : '',
      root: c.obj.path === rootPath,
      scene,
      created: c.source === 'native' ? 'native' : 'blueprint',
      ...(c.source === 'inherited' ? { inherited: true } : {}),
    }
  })
  // 父蓝图加的组件：子蓝图没改过的在子蓝图文件里根本没有，要去父蓝图的文件里读（bp-chain.ts）；改过的上面已经有了，补上挂在谁下面
  const { chain } = await parentBlueprints(project, bp)
  const byName = new Map(items.map((x) => [x.name, x]))
  for (const link of chain) {
    const pathIn = new Map(link.bp.components.map((c) => [c.name, c.obj.path]))
    for (const c of link.bp.components) {
      if (c.source === 'native') continue
      const scene = !NOT_SCENE.test(c.class)
      const mine = byName.get(c.name)
      const parentName = c.parent
      if (mine) {
        if (!mine.parent && scene && parentName)
          mine.parent = pathOf.get(parentName) ?? byName.get(parentName)?.path ?? pathIn.get(parentName) ?? ''
        continue
      }
      const item: CompItem = {
        path: c.obj.path,
        name: c.name,
        class: c.class,
        parent:
          scene && parentName
            ? (pathOf.get(parentName) ?? byName.get(parentName)?.path ?? pathIn.get(parentName) ?? '')
            : '',
        root: false,
        scene,
        created: 'blueprint',
        inherited: true,
      }
      items.push(item)
      byName.set(c.name, item)
    }
  }
  // 文件里没写根组件（C++ 父类建的根组件没改过就不在 CDO 下面）：第一个没有父组件的场景组件当根
  if (!items.some((x) => x.root)) {
    const first = items.find((x) => x.scene && !x.parent)
    if (first) first.root = true
  }
  return { items, scs: true }
})
