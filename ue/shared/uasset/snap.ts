/**
 * 读好的资源 → 版本差异用的 AssetSnap（ue/shared/asset-diff/types.ts，和桥接 asset.snapshot 同一个形状），
 * diff.ts 不用改。和编辑器读的差别：只有改过的属性（没有 C++ 默认值）、没有显示名和分类、节点标题是拼的、
 * 控件动画还没读（设计文档第 6 节），这些写进 note，界面上提示一句。
 */
import type { AssetSnap, SnapComponent, SnapGraph, SnapNode, SnapProp, SnapWidget } from '../asset-diff/types.ts'
import { nestedOf, readAsset, relPath, type Asset } from './asset.ts'
import { readBlueprint } from './bp.ts'
import { isExec, pinDefault, type GGraph } from './graph.ts'
import { t } from './i18n.ts'
import { registerTail, type UObj } from './objects.ts'
import { readName } from './package.ts'
import { readTagged } from './props.ts'
import { graphPseudo } from './pseudo.ts'

// 数据表：属性之后是行数 + 每行「行名 + 按行结构带标签的数据」
registerTail(
  (cls) => cls === 'DataTable' || cls === 'CompositeDataTable',
  (r, pkg, obj, end) => {
    const n = r.i32()
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < n; i++) {
      const name = readName(r, pkg.names)
      const props = readTagged(r, pkg, end)
      const row: Record<string, unknown> = { Name: name }
      for (const p of props) row[p.name] = p.value
      rows.push(row)
    }
    ;(obj as UObj & { rows?: Record<string, unknown>[] }).rows = rows
  },
)

export const rowsOf = (o: UObj | undefined) => (o as (UObj & { rows?: Record<string, unknown>[] }) | undefined)?.rows

export function snapProps(o: UObj | undefined): SnapProp[] {
  return (o?.props ?? []).map((p) => ({
    name: p.arrayIndex ? `${p.name}[${p.arrayIndex}]` : p.name,
    type: p.type,
    value: p.value,
  }))
}

const objSnap = (o: UObj, name = o.name) => ({ name, class: o.class, props: snapProps(o) })

function graphSnap(g: GGraph): SnapGraph {
  const nodes: SnapNode[] = g.nodes.map((n) => {
    const pins: Record<string, string> = {}
    for (const p of n.pins)
      if (p.direction === 0 && !p.hidden && !isExec(p) && !g.links.some((l) => l.toPin === p))
        pins[p.name] = pinDefault(p)
    const links = g.links.filter((l) => l.from === n).map((l) => `${l.fromPin.name}->${l.to.id}.${l.toPin.name}`)
    return {
      id: n.id,
      guid: n.guid,
      title: n.title,
      class: n.class,
      ...(n.comment ? { comment: n.comment } : {}),
      pins,
      links,
    }
  })
  return { name: g.name, kind: g.kind, nodes, pseudo: graphPseudo(g) }
}

/** 快照里的限制说明：两条路读出来的内容不一样，界面上说清楚。按当前界面语言拼，缓存里读回来的也要重拼 */
export function fileNote(snap: AssetSnap): string {
  const out = [t('从文件读取（没开编辑器）：只含改过的属性，没有 C++ 默认值和显示名，节点标题是按节点类型拼的')]
  if (snap.blueprint?.widgets?.length) out.push(t('控件动画还不能离线读，动画差异要开着编辑器看'))
  const failed = snap.fileRead?.failed ?? 0
  if (failed) out.push(t('{n} 个对象没读通，差异里不含它们', { n: failed }))
  return out.join('；')
}

export function assetToSnap(a: Asset): AssetSnap {
  const snap = buildSnap(a)
  snap.fileRead = { failed: a.failed }
  snap.note = fileNote(snap)
  return snap
}

function buildSnap(a: Asset): AssetSnap {
  const main = a.main
  if (!main) return { class: '', props: [], note: t('文件里找不到资源本体') }
  const bp = readBlueprint(a)
  if (bp) {
    const components: SnapComponent[] = bp.components.map((c) => ({
      ...objSnap(c.obj, c.name),
      parent: c.parent,
      source: c.source,
    }))
    const widgets: SnapWidget[] = bp.widgets.map((w) => ({
      ...objSnap(w.obj),
      path: w.path,
      parent: w.parent,
      ...(w.slot ? { slotClass: w.slot.class, slot: snapProps(w.slot) } : {}),
    }))
    return {
      class: main.class,
      props: snapProps(bp.cdo),
      blueprint: {
        parent: bp.parent,
        interfaces: bp.interfaces,
        variables: bp.variables.map((v) => ({ name: v.name, type: v.type, category: v.category, flags: v.flags })),
        components,
        graphs: bp.graphs.map(graphSnap),
        ...(widgets.length ? { widgets, anims: [] } : {}),
      },
    }
  }
  const subs = nestedOf(a, main)
    .map((o) => objSnap(o, relPath(a, o, main)))
    .sort((x, y) => x.name.localeCompare(y.name))
  const snap: AssetSnap = { class: main.class, props: snapProps(main), subobjects: subs }
  const rows = rowsOf(main)
  if (rows) {
    snap.rowStruct = String(main.props.find((p) => p.name === 'RowStruct')?.value ?? '')
    snap.rows = JSON.stringify(rows)
  }
  return snap
}

export const fileSnapshot = (buf: Uint8Array) => assetToSnap(readAsset(buf))
