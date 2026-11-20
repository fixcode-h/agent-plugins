import { nodeSize } from './ue-style.ts'

/**
 * 蓝图图表的画法（效果图 A2）：bp.graph format=json 回的节点和引脚连线 → 画布上的节点位置和连线。
 * UELink 2.18 起（bp.layout）列表里每个节点带 UE 里的坐标 x / y，注释节点带框的 w / h / color：照原位置画，注释画成框。
 * 旧桥接不给坐标时按连线自动排：沿连线分层（执行线和数据线都算，从左往右），只往外给数据的纯节点（Get 变量、Make…）
 * 挪到用它的节点左边一列，互不相连的几簇上下叠开，画布上标明「自动排布」。纯函数，单测在 blueprint.test.ts
 */

export interface GPin {
  name: string
  dir: 'in' | 'out' | string
  type: string
  default?: string
  /** 连到哪：「节点id.引脚名」 */
  to?: string[]
}

export interface GNode {
  id: string
  kind: string
  title: string
  member?: string
  comment?: string
  error?: string
  pins: GPin[]
  /** UE 图表坐标（bp.graph layout:true，2.18） */
  x?: number
  y?: number
  /** 注释框的尺寸和颜色（#rrggbb） */
  w?: number
  h?: number
  color?: string
}

/** 注释框（照 UE 的位置和大小画在节点下面） */
export interface CommentBox {
  node: GNode
  x: number
  y: number
  w: number
  h: number
  color?: string
}

export interface PlacedNode {
  node: GNode
  x: number
  y: number
  w: number
  h: number
  /** 每行左右各一个引脚（UE 节点的样子），行号从 0 起 */
  rows: { in?: GPin; out?: GPin }[]
}

export interface GEdge {
  id: string
  from: string
  fromPin: string
  to: string
  toPin: string
  exec: boolean
  type: string
}

const GAP_X = 70
const GAP_Y = 28
const CLUSTER_GAP = 80

/** 节点里的行：输入引脚靠左、输出引脚靠右，执行引脚各自排第一行（和 UE 一样） */
export function pinRows(n: GNode): { in?: GPin; out?: GPin }[] {
  const order = (ps: GPin[]) => [...ps.filter((p) => p.type === 'exec'), ...ps.filter((p) => p.type !== 'exec')]
  const ins = order(n.pins.filter((p) => p.dir === 'in'))
  const outs = order(n.pins.filter((p) => p.dir !== 'in'))
  return Array.from({ length: Math.max(ins.length, outs.length) }, (_, i) => ({ in: ins[i], out: outs[i] }))
}

/** 连线只从输出引脚的 to 取（输入引脚上的 to 是同一条线的另一头，不重复）；指向列表外节点的线丢掉 */
export function graphEdges(nodes: GNode[]): GEdge[] {
  const ids = new Set(nodes.map((n) => n.id))
  const out: GEdge[] = []
  for (const n of nodes)
    for (const p of n.pins) {
      if (p.dir === 'in') continue
      for (const link of p.to ?? []) {
        const dot = link.indexOf('.')
        if (dot < 0) continue
        const to = link.slice(0, dot)
        if (!ids.has(to)) continue
        out.push({
          id: `${n.id}.${p.name}>${link}`,
          from: n.id,
          fromPin: p.name,
          to,
          toPin: link.slice(dot + 1),
          exec: p.type === 'exec',
          type: p.type,
        })
      }
    }
  return out
}

/**
 * 分层：最长路径（有环时按节点数封顶，不会死循环），然后把「只往外给数据、没有执行引脚」的节点挪到
 * 它的下游里最靠左的那一列的左边一列（UE 里 Get 变量就摆在用它的节点旁边）
 */
export function rankNodes(nodes: GNode[], edges: GEdge[]): Map<string, number> {
  const rank = new Map(nodes.map((n) => [n.id, 0]))
  const cap = nodes.length
  for (let round = 0; round < cap; round++) {
    let changed = false
    for (const e of edges) {
      if (e.from === e.to) continue
      const want = Math.min((rank.get(e.from) ?? 0) + 1, cap)
      if ((rank.get(e.to) ?? 0) < want) {
        rank.set(e.to, want)
        changed = true
      }
    }
    if (!changed) break
  }
  const incoming = new Set(edges.map((e) => e.to))
  for (const n of nodes) {
    if (incoming.has(n.id) || n.pins.some((p) => p.type === 'exec')) continue
    const downs = edges.filter((e) => e.from === n.id).map((e) => rank.get(e.to) ?? 0)
    if (downs.length) rank.set(n.id, Math.max(0, Math.min(...downs) - 1))
  }
  return rank
}

/** 连通的几簇（并查集），按列表里第一次出现的顺序 */
function clusters(nodes: GNode[], edges: GEdge[]): string[][] {
  const up = new Map(nodes.map((n) => [n.id, n.id]))
  const find = (x: string): string => {
    let r = x
    while (up.get(r) !== r) r = up.get(r)!
    up.set(x, r)
    return r
  }
  for (const e of edges) up.set(find(e.from), find(e.to))
  const groups = new Map<string, string[]>()
  for (const n of nodes) {
    const r = find(n.id)
    groups.set(r, [...(groups.get(r) ?? []), n.id])
  }
  return [...groups.values()]
}

/**
 * 摆位置：每簇按列（分层）从左往右，列里按上游节点的平均高度排（少交叉），簇和簇上下叠开
 */
function autoPlace(nodes: GNode[], edges: GEdge[]): PlacedNode[] {
  const rank = rankNodes(nodes, edges)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // 节点宽窄照 UE 估（ue-style.ts），每列的 x 按前面各列最宽的节点累加，宽节点不会压到右边一列
  const sized = new Map(
    nodes.map((n) => {
      const rows = pinRows(n)
      return [n.id, { rows, ...nodeSize(n, rows) }]
    }),
  )
  const colW = new Map<number, number>()
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0
    colW.set(r, Math.max(colW.get(r) ?? 0, sized.get(n.id)!.w))
  }
  const colX = new Map<number, number>()
  let x = 0
  for (const r of [...colW.keys()].sort((a, b) => a - b)) {
    colX.set(r, x)
    x += colW.get(r)! + GAP_X
  }
  const placed = new Map<string, PlacedNode>()
  let top = 0
  for (const ids of clusters(nodes, edges)) {
    const cols = new Map<number, string[]>()
    for (const id of ids) {
      const r = rank.get(id) ?? 0
      cols.set(r, [...(cols.get(r) ?? []), id])
    }
    let bottom = top
    for (const r of [...cols.keys()].sort((a, b) => a - b)) {
      const center = (id: string) => {
        const ys = edges
          .filter((e) => e.to === id && placed.has(e.from))
          .map((e) => placed.get(e.from)!.y + placed.get(e.from)!.h / 2)
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.POSITIVE_INFINITY
      }
      const col = [...cols.get(r)!].sort((a, b) => center(a) - center(b))
      let y = top
      for (const id of col) {
        const { rows, w, h } = sized.get(id)!
        // 尽量和上游对齐，但不和同列上一个重叠
        const want = center(id)
        const at = Number.isFinite(want) ? Math.max(y, Math.round(want - h / 2)) : y
        placed.set(id, { node: byId.get(id)!, x: colX.get(r) ?? 0, y: at, w, h, rows })
        y = at + h + GAP_Y
        bottom = Math.max(bottom, y)
      }
    }
    top = bottom + CLUSTER_GAP
  }
  return nodes.map((n) => placed.get(n.id)!)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 除注释外每个节点都有坐标：照 UE 的位置画（有一个没有就整张自动排，不混着来） */
export const hasPositions = (nodes: GNode[]) =>
  nodes.some((n) => n.kind !== 'comment') && nodes.every((n) => n.kind === 'comment' || (isNum(n.x) && isNum(n.y)))

/**
 * 整张图：有坐标（UELink 2.18 bp.layout）时照 UE 的位置，注释节点有框的位置和大小时画成框（boxes）；
 * 没坐标时自动排，注释节点没有位置，单独列在画布上方（comments）
 */
export function layoutGraph(all: GNode[]): {
  nodes: PlacedNode[]
  edges: GEdge[]
  comments: GNode[]
  boxes: CommentBox[]
  positioned: boolean
} {
  const notes = all.filter((n) => n.kind === 'comment')
  const nodes = all.filter((n) => n.kind !== 'comment')
  const edges = graphEdges(nodes)
  const positioned = hasPositions(all)
  if (!positioned) return { nodes: autoPlace(nodes, edges), edges, comments: notes, boxes: [], positioned }
  const placed = nodes.map((node) => {
    const rows = pinRows(node)
    return { node, x: node.x!, y: node.y!, ...nodeSize(node, rows), rows }
  })
  const framed = (n: GNode) => isNum(n.x) && isNum(n.y) && isNum(n.w) && isNum(n.h) && n.w > 0 && n.h > 0
  return {
    nodes: placed,
    edges,
    comments: notes.filter((n) => !framed(n)),
    boxes: notes.filter(framed).map((n) => ({ node: n, x: n.x!, y: n.y!, w: n.w!, h: n.h!, color: n.color })),
    positioned,
  }
}
