import { op } from './api.ts'
import type { Comp } from './CompTree.tsx'

interface ScsNode {
  name: string
  class: string
  template?: string
  children?: ScsNode[]
}

/** 旧桥接猜不出 SCS 组件是不是场景组件（bp.outline 不给），按类名认常见的非场景组件，其余当场景组件 */
const NOT_SCENE = /Movement|InputComponent|Perception|PawnNoise|^ActorComponent$/i

/**
 * 蓝图资源的组件树：UELink 2.2.0 起 `components` 直接给全（C++ 组件 + 蓝图组件列表，带挂接关系，回包有 scs）。
 * 旧桥接只给类默认对象上的 C++ 组件，这里用 bp.outline 的组件列表补上自己这一层蓝图加的，
 * 没写父组件的照 UE 的规矩挂到根组件上（父蓝图加的组件和显式指定的父组件旧桥接拿不到，升级桥接后才准）。
 * 不是 Actor 蓝图（控件蓝图、函数库）时返回 null，资源页就不显示组件栏
 */
export async function loadBlueprintComps(project: string, path: string): Promise<Comp[] | null> {
  type R = { items: Comp[]; scs?: boolean }
  const read = () => op<R>(project, 'components', { path }, undefined, 120000)
  let r: R
  try {
    r = await read()
  } catch {
    // 桥接的 components 只找内存里已有的对象、不加载（为 Actor 页设计的）：刚搜到、还没打开过的蓝图资源在这里会报「找不到对象」，
    // 和右边属性同时发出去时也会抢在属性加载它之前。先用属性读取（会加载，筛一个不存在的名字，几乎不回内容）把资源加载进来再读一次；
    // 再失败才算不是 Actor 蓝图（控件蓝图、函数库）
    try {
      await op(project, 'props', { path, filter: '__agent_panel_load__', maxChars: 1 }, undefined, 120000)
      r = await read()
    } catch {
      return null
    }
  }
  if (r.scs) return r.items
  const outline = await op<{ components?: ScsNode[] }>(project, 'bp.outline', { path }, undefined, 120000).catch(
    () => null,
  )
  const items = [...r.items]
  let root = items.find((c) => c.root)?.path ?? ''
  const add = (n: ScsNode, parent: string) => {
    const scene = !!n.children?.length || !NOT_SCENE.test(n.class)
    const p = n.template || `${path}#${n.name}`
    let par = scene ? parent : ''
    let isRoot = false
    if (scene && !par) {
      if (root) par = root
      else {
        root = p
        isRoot = true
      }
    }
    items.push({ path: p, name: n.name, class: n.class, parent: par, root: isRoot, scene, created: 'blueprint' })
    for (const k of n.children ?? []) add(k, scene ? p : par)
  }
  for (const n of outline?.components ?? []) {
    // 默认场景根在已经有根组件时不会建出来，它下面的直接挂到根上
    if (n.name === 'DefaultSceneRoot' && root) for (const k of n.children ?? []) add(k, root)
    else add(n, '')
  }
  return items
}
