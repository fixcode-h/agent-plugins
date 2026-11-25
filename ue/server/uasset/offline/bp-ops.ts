import { shortName, type Asset } from '../../../shared/uasset/asset.ts'
import { readBlueprint, type Bp, type BpComp } from '../../../shared/uasset/bp.ts'
import { isExec, pinDefault, type GGraph, type GNode } from '../../../shared/uasset/graph.ts'
import { prop } from '../../../shared/uasset/objects.ts'
import { pinTypeText, type RawPin } from '../../../shared/uasset/pins.ts'
import { graphPseudo } from '../../../shared/uasset/pseudo.ts'
import { BridgeError } from '../../instances.ts'
import { t } from '../../util.ts'
import { loadAsset } from '../read.ts'
import { registerOffline } from './registry.ts'
import { clean, num } from './shape.ts'

/** 蓝图的大纲和图表（照 UELink 的 bp.outline / bp.graph；节点标题是按节点类型拼的，和编辑器里不一定逐字一样） */

async function blueprintOf(project: Parameters<typeof loadAsset>[0], path: string): Promise<{ a: Asset; bp: Bp }> {
  const { asset: a } = await loadAsset(project, path)
  const bp = readBlueprint(a)
  if (!bp) throw new BridgeError(t('{p} 不是蓝图', { p: path }))
  return { a, bp }
}

// 函数标志（EFunctionFlags）：入口节点的 ExtraFlags
const FUNC_PRIVATE = 0x40000
const FUNC_PROTECTED = 0x80000
const FUNC_PURE = 0x10000000
const FUNC_CONST = 0x40000000

const params = (n: GNode | undefined, dir: number) =>
  (n?.pins ?? [])
    .filter((p) => p.direction === dir && !isExec(p) && !p.hidden && p.name !== 'self')
    .map((p) => ({ name: p.name, type: pinTypeText(p) }))

function graphBrief(g: GGraph) {
  const o: Record<string, unknown> = { name: g.name, kind: g.kind, nodes: g.nodes.length }
  const entry = g.nodes.find((n) => n.class === 'K2Node_FunctionEntry')
  if (entry) {
    o.inputs = params(entry, 1)
    const flags = Number(prop(entry.obj, 'ExtraFlags') ?? 0)
    if (flags & FUNC_PURE) o.pure = true
    if (g.kind === 'function') {
      const meta = prop(entry.obj, 'MetaData') as Record<string, unknown> | undefined
      const cat = String(meta?.category ?? '')
      if (cat && cat !== 'Default') o.category = cat
      if (flags & FUNC_PRIVATE) o.access = 'private'
      else if (flags & FUNC_PROTECTED) o.access = 'protected'
      if (flags & FUNC_CONST) o.const = true
    }
  }
  const ret = g.nodes.find((n) => n.class === 'K2Node_FunctionResult')
  if (ret) o.outputs = params(ret, 0)
  const events = g.nodes
    .filter((n) => n.class === 'K2Node_Event' || n.class === 'K2Node_CustomEvent')
    .map((n) => {
      const ref = prop(n.obj, 'EventReference') as Record<string, unknown> | undefined
      return {
        name: String(prop(n.obj, 'CustomFunctionName') ?? ref?.memberName ?? n.title),
        node: n.id,
        custom: n.class === 'K2Node_CustomEvent',
      }
    })
  if (events.length) o.events = events
  return o
}

/** SCS 组件树：{name, class, template, children} */
function scsTree(comps: BpComp[]) {
  const scs = comps.filter((c) => c.source === 'scs')
  const node = (c: BpComp): Record<string, unknown> => {
    const kids = scs.filter((x) => x.parent === c.name)
    return { name: c.name, class: c.class, template: c.obj.path, ...(kids.length ? { children: kids.map(node) } : {}) }
  }
  const names = new Set(scs.map((c) => c.name))
  return scs.filter((c) => !names.has(c.parent)).map(node)
}

registerOffline('bp.outline', async ({ project, args }) => {
  const { a, bp } = await blueprintOf(project, String(args.path ?? ''))
  const variables: Record<string, unknown>[] = []
  const dispatchers: Record<string, unknown>[] = []
  for (const v of bp.variables) {
    if (v.type === 'Event Dispatcher') {
      const sig = bp.graphs.find((g) => g.kind === 'delegate' && g.name === v.name)
      const ps = params(
        sig?.nodes.find((n) => n.class === 'K2Node_FunctionEntry'),
        1,
      )
      dispatchers.push({ name: v.name, type: v.type, ...(ps.length ? { params: ps } : {}) })
      continue
    }
    const onCdo = bp.cdo?.props.find((p) => p.name === v.name)
    const rep = v.flags.find((f) => f === 'replicated' || f === 'repNotify')
    variables.push({
      name: v.name,
      type: v.type,
      ...(v.category ? { category: v.category } : {}),
      ...(rep ? { replication: rep } : {}),
      instanceEditable: v.flags.includes('instanceEditable'),
      ...(v.flags.includes('exposeOnSpawn') ? { exposeOnSpawn: true } : {}),
      ...(onCdo ? { default: clean(onCdo.value) } : v.defaultValue ? { default: v.defaultValue } : {}),
    })
  }
  const timelines = (Array.isArray(prop(bp.bp, 'Timelines')) ? (prop(bp.bp, 'Timelines') as unknown[]) : []).map((x) =>
    shortName(x).replace(/_Template$/, ''),
  )
  return {
    path: bp.bp.path,
    name: bp.bp.name,
    blueprintClass: bp.bp.class,
    parent: bp.parent,
    generatedClass: bp.gen?.path ?? '',
    status: '',
    dirty: false,
    interfaces: bp.interfaces,
    variables,
    dispatchers,
    components: scsTree(bp.components),
    graphs: bp.graphs.map(graphBrief),
    timelines,
    ...(a.failed ? { note: t('{n} 个对象没读通', { n: a.failed }) } : {}),
  }
})

const KIND: Record<string, string> = {
  EdGraphNode_Comment: 'comment',
  K2Node_CustomEvent: 'custom_event',
  K2Node_Event: 'event',
  K2Node_FunctionEntry: 'entry',
  K2Node_FunctionResult: 'return',
  K2Node_CallFunction: 'call',
  K2Node_CallParentFunction: 'call',
  K2Node_CallArrayFunction: 'call',
  K2Node_CommutativeAssociativeBinaryOperator: 'call',
  K2Node_VariableGet: 'get',
  K2Node_VariableSet: 'set',
  K2Node_IfThenElse: 'branch',
  K2Node_DynamicCast: 'cast',
  K2Node_MacroInstance: 'macro',
}

function member(n: GNode): string {
  const ref = (name: string) => prop(n.obj, name) as Record<string, unknown> | undefined
  switch (KIND[n.class]) {
    case 'call': {
      const r = ref('FunctionReference')
      const owner = shortName(r?.memberParent)
      return `${owner ? `${owner}.` : ''}${String(r?.memberName ?? '')}`
    }
    case 'get':
    case 'set':
      return String(ref('VariableReference')?.memberName ?? '')
    case 'event':
      return String(ref('EventReference')?.memberName ?? '')
    case 'custom_event':
      return String(prop(n.obj, 'CustomFunctionName') ?? '')
    case 'cast':
      return shortName(prop(n.obj, 'TargetType'))
    case 'macro':
      return shortName((prop(n.obj, 'MacroGraphReference') as Record<string, unknown> | undefined)?.macroGraph)
    default:
      return ''
  }
}

function pinJson(g: GGraph, p: RawPin) {
  const o: Record<string, unknown> = {
    name: p.name,
    dir: p.direction === 0 ? 'in' : 'out',
    type: isExec(p) ? 'exec' : pinTypeText(p),
  }
  const linked = p.linkedTo.length > 0
  if (p.direction === 0 && !isExec(p) && !linked) {
    const d = pinDefault(p)
    if (d) o.default = d
  }
  if (linked) {
    const byRef = new Map(g.nodes.map((x) => [x.obj.ref, x]))
    o.to = p.linkedTo
      .map((l) => {
        const other = byRef.get(l.node)
        const op = other?.pins.find((x) => x.id === l.pin)
        return other && op ? `${other.id}.${op.name}` : ''
      })
      .filter(Boolean)
  }
  return o
}

function nodeJson(g: GGraph, n: GNode, full: boolean, layout: boolean) {
  const o: Record<string, unknown> = { id: n.id, kind: KIND[n.class] ?? 'other', title: n.title }
  const m = member(n)
  if (m) o.member = m
  if (n.comment) o.comment = n.comment
  if (full) Object.assign(o, { guid: n.guid, class: n.class, x: n.x, y: n.y })
  else if (layout) Object.assign(o, { x: n.x, y: n.y })
  if ((full || layout) && n.class === 'EdGraphNode_Comment') {
    o.w = Number(prop(n.obj, 'NodeWidth') ?? 400)
    o.h = Number(prop(n.obj, 'NodeHeight') ?? 100)
    o.color = hexColor(prop(n.obj, 'CommentColor'))
  }
  o.pins = n.pins.filter((p) => full || !p.hidden || p.linkedTo.length).map((p) => pinJson(g, p))
  return o
}

/** LinearColor（线性）→ sRGB 的 #rrggbb，和桥接 ToFColor(true) 一样；没存（默认白）时给白 */
function hexColor(v: unknown) {
  const c = (v ?? { r: 1, g: 1, b: 1 }) as Record<string, number>
  const s = (x: number) => {
    const l = Math.min(1, Math.max(0, Number(x ?? 1)))
    const e = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
    return Math.round(e * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${s(c.r)}${s(c.g)}${s(c.b)}`
}

function findGraph(bp: Bp, name: string): GGraph {
  if (!name) {
    const g = bp.graphs.find((x) => x.kind === 'event') ?? bp.graphs[0]
    if (g) return g
  }
  const g = bp.graphs.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (g) return g
  throw new BridgeError(
    t('{bp} 里没有图 {g}，有：{list}', { bp: bp.bp.name, g: name, list: bp.graphs.map((x) => x.name).join('、') }),
  )
}

function findNode(graphs: GGraph[], id: string): { g: GGraph; n: GNode } {
  const want = id.trim().replace(/[#-]/g, '').toLowerCase()
  for (const g of graphs) for (const n of g.nodes) if (want && n.guid.startsWith(want)) return { g, n }
  throw new BridgeError(t('找不到节点 {id}', { id }))
}

registerOffline('bp.graph', async ({ project, args }) => {
  const { bp } = await blueprintOf(project, String(args.path ?? ''))
  const graphName = String(args.graph ?? '')
  if (args.node) {
    const scope = graphName ? [findGraph(bp, graphName)] : bp.graphs
    const { g, n } = findNode(scope, String(args.node))
    return { graph: g.name, node: nodeJson(g, n, true, true) }
  }
  const g = findGraph(bp, graphName)
  const base = { graph: g.name, kind: g.kind, total: g.nodes.length }
  if (String(args.format ?? 'pseudo') !== 'json') {
    const max = Math.min(4000, Math.max(20, num(args.maxLines, 400)))
    const lines = graphPseudo(g).split('\n')
    return { ...base, pseudo: lines.slice(0, max).join('\n'), more: lines.length > max }
  }
  let pick = g.nodes
  if (args.around) {
    const center = findNode([g], String(args.around)).n
    const hops = Math.min(6, Math.max(0, num(args.hops, 2)))
    const seen = new Set<GNode>([center])
    let layer = [center]
    for (let i = 0; i < hops; i++) {
      const next: GNode[] = []
      for (const l of g.links)
        for (const [a, b] of [
          [l.from, l.to],
          [l.to, l.from],
        ])
          if (layer.includes(a) && !seen.has(b)) {
            seen.add(b)
            next.push(b)
          }
      layer = next
    }
    pick = [...seen]
  }
  // 位置总是带上：网页按 UELink 的能力表决定要不要 layout，文件里本来就有坐标，没必要退回自动排布
  const offset = Math.max(0, num(args.offset, 0))
  const limit = Math.min(300, Math.max(1, num(args.limit, 40)))
  const nodes = pick.slice(offset, offset + limit).map((n) => nodeJson(g, n, false, true))
  return {
    ...base,
    nodes,
    matched: pick.length,
    ...(offset + nodes.length < pick.length ? { next: offset + nodes.length } : {}),
  }
})
