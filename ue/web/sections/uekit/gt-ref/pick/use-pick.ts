import { AppWindow } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GtIdentItem, GtPropGroup, GtPropItem, GtRef, GtTreeNode } from '../../../../../shared/gt-script/index.ts'
import { classShort } from '../describe.ts'
import { classOnly, useProps, useRefHits, useTree, type PropsArgs, type RefHits } from '../live.ts'
import { KIND_ICON } from './ClassPicker.tsx'
import { SOURCES, sourcesFor, useClassInfo, useSubtree, itemsOf, type ClassKind, type Source } from './data.ts'
import { fromGroups, fromTree, type StructNode } from './StructurePane.tsx'

/** 选对象面板的输入：项目、连没连游戏、正在编辑的引用、场景的 objects（名字引用展开） */
export interface PickInput {
  project: string
  live: boolean
  ref: GtRef
  objects?: Record<string, unknown>
  /** 打开时选中的子控件 / 组件（动作落点原来的部件，`Header/BtnClose`） */
  initialPart?: string
}

/** 此刻实例名 → gt.tree 里的 UserWidget 节点（只有 UMG 有树；名字对得上才算） */
const treeNodeOf = (screen: GtTreeNode[], name: string | undefined) =>
  name ? screen.find((n) => n.user && (n.name === name || n.id === name)) : undefined

/** 自己的那几组（不含部件组）：部件组是子控件 / 组件的属性，点结构栏的子项时再看 */
const ownItems = (groups: GtPropGroup[] | undefined, part?: string) =>
  itemsOf(
    (groups ?? []).filter((g) => !g.part),
    part,
  )

/**
 * 选对象面板的数据（一页四栏共用）：类的种类、此刻实例（gt.resolve 推送）、结构（UMG 用 gt.tree 子树，其余按 gt.props 的部件组）、
 * 细节栏读哪个对象的属性（gt.props：选中的树节点 > 按引用找此刻的对象 > 只按类）。界面状态（选了哪个实例、哪个子项）也在这里
 */
export function usePick({ project, live, ref, objects, initialPart }: PickInput) {
  const cls = ref.class.trim()
  const info = useClassInfo(project, cls)
  const kind: ClassKind | undefined = cls ? info?.kind : undefined
  const [inst, setInst] = useState<string>()
  const [part, setPart] = useState(initialPart ?? '')
  // 换类时清掉选中的实例和子项（打开时那一次不清：要留着原来的部件）
  const firstCls = useRef(cls)
  useEffect(() => {
    if (cls === firstCls.current) return
    firstCls.current = ''
    setInst(undefined)
    setPart('')
  }, [cls])

  // 此刻屏上的界面：没定类时按类分组列出来，UMG 的实例靠它找到树节点
  const screen = useTree(project, live && (!cls || kind === 'umg' || kind === 'lua'), {})
  const ident = ref.ident ?? []
  const allowed = sourcesFor(kind)
  const hits = useRefHits(
    project,
    live && !!cls,
    [
      { id: 'me', ref },
      { id: 'all', ref: classOnly(ref) },
      // 三个开关各自能找到几个（开关上的数字）
      ...SOURCES.filter((s) => allowed.includes(s)).map((s) => ({ id: s, ref: { class: cls, in: s } as GtRef })),
    ],
    objects,
    ident.map((i) => i.prop),
  )
  const me = hits.hits.me
  const all = hits.hits.all
  const counts: Partial<Record<Source, number>> = {}
  for (const s of SOURCES) if (hits.hits[s]) counts[s] = hits.hits[s]!.count
  // 没点过实例时默认看命中的那个（只有一个时）
  const shown = inst ?? (me?.count === 1 ? me.candidates?.[0]?.name : undefined)
  const rootNode = treeNodeOf(screen.nodes, shown)
  const sub = useSubtree(project, live ? rootNode?.id : undefined)

  // 细节栏读哪个：树里选中的节点 > 按引用找此刻那个（命中正好一个时）> 只按类（游戏没开、找不到实例）
  const [byClass, setByClass] = useState(false)
  const tree = rootNode && sub.nodes.length ? fromTree(sub.nodes, rootNode.id) : undefined
  const treeSel = tree?.find((n) => n.part === part)
  // 点中（或唯一命中）的那个实例的对象路径：Actor 的组件树要按实例读，类默认对象上没有蓝图里加的组件
  const shownPath = shown ? (all?.candidates ?? me?.candidates)?.find((c) => c.name === shown)?.path : undefined
  const args: PropsArgs | undefined = !cls
    ? undefined
    : treeSel?.node
      ? { node: treeSel.node }
      : live && !byClass && shownPath
        ? { path: shownPath }
        : live && !byClass && me?.count === 1
        ? { target: { obj: ref } }
        : // 蓝图类按资产路径读：类名只在资产已加载时找得到，给路径 UE 会先加载它（GameTest 2.1.3 起）
          { class: info?.asset && !cls.startsWith('lua:') ? info.asset : cls }
  const props = useProps(project, args)
  useEffect(() => {
    if (props.error && args && ('target' in args || 'path' in args)) setByClass(true)
    // args 每次渲染都是新对象：只看出错和读法
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [props.error])
  useEffect(() => setByClass(false), [cls, shown])
  const groups = props.data?.groups

  // 结构：UMG 实例有树就用树；其余按部件组摊开（组件树、没开游戏时的控件树）
  const structure: StructNode[] = useMemo(
    () =>
      tree ??
      (cls ? fromGroups(groups, { name: classShort(cls), class: cls, icon: kind ? KIND_ICON[kind] : AppWindow }) : []),
    [tree, groups, cls, kind],
  )

  // 部件组折叠着（UE 没随整个对象一起给）时按 part 再读一次
  const [partGroups, setPartGroups] = useState<Record<string, GtPropGroup[]>>({})
  useEffect(() => setPartGroups({}), [cls, shown])
  const partGroup =
    !treeSel && part ? groups?.find((g) => g.part && g.part.split(/[./]/).join('/') === part) : undefined
  useEffect(() => {
    if (!partGroup || partGroup.items.length || partGroups[part]) return
    let off = false
    void props
      .loadPart(partGroup.part!)
      .then((g) => !off && g && setPartGroups((m) => ({ ...m, [part]: g })))
      .catch(() => undefined)
    return () => {
      off = true
    }
    // props.loadPart 每次渲染都是新函数：按选中的部件读
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [partGroup, part])

  const items: GtPropItem[] = useMemo(() => {
    if (!groups) return []
    if (treeSel) return ownItems(groups, part || undefined)
    if (!part) return ownItems(groups)
    // 带 part 读回来的 prop 相对部件：拼上 /部件（已经从外层写的不重复拼）
    if (partGroup?.items.length) return itemsOf([partGroup], part)
    return itemsOf(partGroups[part], part)
  }, [groups, treeSel, part, partGroup, partGroups])
  const groupTitle = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of [...(groups ?? []), ...(partGroups[part] ?? [])]) for (const it of g.items) m.set(it.prop, g.title)
    return (it: GtPropItem) => m.get(it.prop) ?? ''
  }, [groups, partGroups, part])

  // 加过标识的项记下来：换了子项、换了实例，卡片上还认得它的类型、枚举成员
  const [seen, setSeen] = useState<Record<string, GtPropItem>>({})
  useEffect(() => {
    if (!items.length) return
    setSeen((s) => {
      const out = { ...s }
      for (const it of items) out[it.prop] = it
      return out
    })
  }, [items])
  useEffect(() => setSeen({}), [cls])
  const known = useMemo(() => Object.values(seen), [seen])

  // 此刻的值：选中的那个实例 gt.resolve 带回来的 > 细节栏读到的
  const cand = (all?.candidates ?? []).find((c) => c.name === shown)
  const actual = (prop: string): unknown => {
    const hit = cand?.ident?.find((x) => x.prop === prop)
    if (hit) return hit.actual
    return seen[prop]?.value
  }
  const toggleIdent = (it: GtIdentItem, on: boolean): GtIdentItem[] =>
    on ? ident.filter((x) => x.prop !== it.prop) : [...ident, it]

  return {
    cls,
    kind,
    info,
    allowed,
    counts,
    screen,
    hits: { me, all, error: hits.error } as { me?: RefHits; all?: RefHits; error: string },
    shown,
    setInst,
    part,
    setPart,
    structure,
    structureFromTree: !!tree,
    rootNode,
    /** 结构栏选中的那一项（对象自己时是第一行） */
    selectedNode: structure.find((n) => n.part === part) ?? structure[0],
    subError: sub.error,
    props,
    items,
    groupTitle,
    known,
    actual,
    toggleIdent,
  }
}
