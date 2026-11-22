import { useEffect, useMemo, useState } from 'react'
import { luaClassOf, type GtPropGroup } from '../../../../../shared/gt-script/index.ts'
import { loadBlueprintComps, NOT_SCENE } from '../../../../bp-comps.ts'
import { iconOf, type Comp } from '../../../../CompTree.tsx'
import { useRefRpc } from '../live.ts'
import { useClassInfo, type ClassKind } from './data.ts'
import type { StructNode } from './StructurePane.tsx'

/** gt.props 里的组件组：Actor 每个组件一个部件组（part = 组件名，一段，不是 UserWidget） */
const compGroups = (groups: GtPropGroup[] | undefined) =>
  (groups ?? []).filter((g) => g.part && !g.user && !/[./]/.test(g.part))

/**
 * Actor 的组件树（挂接关系）：gt.props 的部件组是平铺的，没有父子。和资源页 / AssetForge 的组件树一样，
 * 点了实例按实例读 `components`（蓝图里加的、关卡里加的都在），只有类时按蓝图资产读（bp-comps.ts，旧桥接用 bp.outline 补）。
 * Lua 类（UnLua 绑在蓝图上的）没有资产路径：按去掉 lua: 的类名再查一次类树拿资产。读不到返回 null，结构栏退回平铺
 */
export function useActorComps(
  project: string,
  o: { cls: string; kind: ClassKind | undefined; asset?: string; path?: string; groups?: GtPropGroup[] },
) {
  const rpc = useRefRpc()
  const parts = compGroups(o.groups).length
  const on = o.kind === 'actor' || (o.kind !== 'umg' && parts > 0)
  const lua = on && !o.asset ? luaClassOf(o.cls) : undefined
  const alt = useClassInfo(project, lua ?? '')
  const asset = o.asset ?? alt?.asset
  const [comps, setComps] = useState<Comp[] | null>()
  useEffect(() => {
    setComps(undefined)
    if (!on || (!o.path && !asset)) return
    let off = false
    const run = o.path
      ? rpc<{ items: Comp[] }>(project, 'components', { path: o.path }).then((r) => r.items)
      : loadBlueprintComps(project, asset!, rpc)
    run.then(
      (c) => !off && setComps(c),
      () => !off && setComps(null),
    )
    return () => {
      off = true
    }
  }, [project, on, o.path, asset, rpc])
  return useMemo(() => (on ? mergeComps(comps, o.groups) : undefined), [on, comps, o.groups])
}

/**
 * 组件树 + gt.props 的组件组合在一起：树里没有的组件（旧桥接漏的、按类读才有的）补成没挂接的，
 * 场景组件放根上、移动 / 输入这类放分隔线下面（和 UE 组件面板一样）。两边都没有组件时返回 undefined
 */
export function mergeComps(comps: Comp[] | null | undefined, groups: GtPropGroup[] | undefined): Comp[] | undefined {
  const list = [...(comps ?? [])]
  const names = new Set(list.map((c) => c.name))
  for (const g of compGroups(groups)) {
    if (names.has(g.part!)) continue
    const cls = g.class ?? ''
    list.push({
      path: `part:${g.part}`,
      name: g.part!,
      class: cls,
      parent: '',
      root: false,
      scene: !NOT_SCENE.test(cls),
    })
  }
  return list.length ? list : undefined
}

/** 组件树摊成结构节点（按挂接顺序深度优先）：选中项、底栏拿类都按它找；part 就是组件名 */
export function fromComps(comps: Comp[], self: StructNode): StructNode[] {
  const paths = new Set(comps.map((c) => c.path))
  const out: StructNode[] = [{ ...self, kids: comps.length > 0 }]
  const seen = new Set<string>()
  const walk = (c: Comp, depth: number) => {
    if (seen.has(c.path)) return
    seen.add(c.path)
    const kids = comps.filter((k) => k.parent === c.path)
    out.push({
      key: c.path,
      part: c.name,
      depth,
      name: c.name,
      class: c.class,
      icon: iconOf(c.class),
      kids: kids.length > 0,
    })
    for (const k of kids) walk(k, depth + 1)
  }
  for (const c of comps) if (!c.parent || !paths.has(c.parent)) walk(c, 1)
  for (const c of comps) walk(c, 1)
  return out
}
