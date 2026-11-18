import {
  getAt,
  pathStr,
  slotsOf,
  walkGuards,
  type GtGuard,
  type GtPath,
  type GtScript,
  type GtStep,
  type SlotKind,
} from '../../../../shared/gt-script/index.ts'
import { flowLookOf, type FrameTone } from './looks.ts'

/**
 * GameTest 流程图的自动布局（定稿 9.1）：场景是结构化的块数组，画布不存坐标，每次从数据算出来。
 * - 主流程从左到右；有子槽的块按槽数分两种画法：一个槽（步骤段、循环）画成框，框里接着从左到右；
 *   多个槽（如果 / 否则如果 / 否则）画成「判断 → 几条路上下排开 → 汇合」；
 * - 循环（looks 里 repeat）在框底画一条虚线「下一轮」；
 * - 守护在主流程下方竖着排成一列（同时盯着），每条一行；
 * - 每条连线带「插在哪」（槽 + 下标），画布上点 + 或把脚本拖到线上就插到那里。
 * 纯函数，不依赖界面，单测在 layout.test.ts。
 */

export const SIZE = {
  leafW: 208,
  leafH: 58,
  gapX: 64,
  /** 框的内边距、标题栏高度 */
  pad: 18,
  head: 30,
  /** 循环框底部给「下一轮」回线留的高度 */
  back: 30,
  branchGap: 26,
  mergeD: 12,
  termW: 64,
  termH: 30,
  emptyW: 132,
  emptyH: 44,
  /** 主流程和守护栏之间 */
  railGap: 64,
  guardW: 520,
  guardH: 54,
  guardGap: 10,
  railHead: 34,
  railFoot: 44,
} as const

export type FlowNodeKind = 'step' | 'frame' | 'branch' | 'merge' | 'term' | 'empty' | 'rail' | 'guard'

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  x: number
  y: number
  w: number
  h: number
  /** 连线进出的高度（相对节点顶部）：框和判断节点的入口不在正中 */
  anchorY: number
  /** 步骤的路径（step / frame / branch）；守护的路径（guard） */
  path?: GtPath
  /** 运行记录、断点、gt.flow 推送用的键：步骤 id，没有 id 时是路径（协议 1 节） */
  key?: string
  step?: GtStep
  guard?: GtGuard
  /** 守护来自哪：全局（运行设置）、本脚本、挂在某个块上 */
  scope?: 'global' | 'script' | 'block'
  tone?: FrameTone
  /** 折叠着的块：里面藏了几步 */
  hidden?: number
  /** 空槽占位、起止节点：往哪插 */
  insert?: InsertAt
  /** 起止节点、前置步骤框的名字（界面再翻译） */
  role?: 'start' | 'end' | 'setup'
  depth: number
}

export interface InsertAt {
  slot: GtPath
  index: number
}

export type FlowEdgeKind = 'next' | 'branch' | 'back'

export interface FlowEdge {
  id: string
  from: string
  to: string
  kind: FlowEdgeKind
  /** 分支线上的字：哪个槽 */
  slotKind?: SlotKind
  /** 第几个「否则如果」 */
  index?: number
  insert?: InsertAt
  /** 回线走的那条水平线（绝对坐标） */
  channelY?: number
}

export interface FlowLayout {
  nodes: FlowNode[]
  edges: FlowEdge[]
  w: number
  h: number
}

export interface LayoutOptions {
  /** 这块折不折叠（录制段默认折叠，见 defaultCollapsed） */
  collapsed?: (step: GtStep, key: string) => boolean
  /** 运行设置里的全局守护（原「阻挡界面」迁移来的），画在守护栏最上面 */
  globalGuards?: GtGuard[]
}

/** 录制录出来的段默认折叠成一个节点（定稿 10：双击展开） */
export const defaultCollapsed = (step: GtStep) => step.recorded === true

export const stepKey = (step: GtStep, path: GtPath) =>
  typeof step.id === 'string' && step.id ? step.id : pathStr(path)

/** 布局中途的一块：坐标相对这块的左上角，拼进外层时再整体平移 */
interface Box {
  nodes: FlowNode[]
  edges: FlowEdge[]
  w: number
  h: number
  /** 进出连线的高度 */
  ay: number
  inId: string
  outId: string
}

const shift = (b: Box, dx: number, dy: number): Box => ({
  ...b,
  nodes: b.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
  edges: b.edges.map((e) => (e.channelY === undefined ? e : { ...e, channelY: e.channelY + dy })),
})

const stepsAt = (doc: GtScript, slot: GtPath): GtStep[] => {
  const v = getAt(doc, slot)
  return Array.isArray(v) ? (v as GtStep[]) : []
}

/** 一个槽里一共几步（含块里的），折叠的块显示「N 步」 */
function countIn(steps: unknown[]): number {
  return steps.reduce<number>((n, s) => {
    if (!s || typeof s !== 'object') return n
    const st = s as GtStep
    return n + 1 + slotsOf(st).reduce((m, r) => m + countIn((getAt(st, r.key) as unknown[]) ?? []), 0)
  }, 0)
}

interface Ctx {
  doc: GtScript
  collapsed: (step: GtStep, key: string) => boolean
}

function leaf(node: Omit<FlowNode, 'x' | 'y' | 'anchorY'>): Box {
  return {
    nodes: [{ ...node, x: 0, y: 0, anchorY: node.h / 2 }],
    edges: [],
    w: node.w,
    h: node.h,
    ay: node.h / 2,
    inId: node.id,
    outId: node.id,
  }
}

const emptySlot = (slot: GtPath, depth: number): Box =>
  leaf({
    id: `empty:${pathStr(slot)}`,
    kind: 'empty',
    w: SIZE.emptyW,
    h: SIZE.emptyH,
    insert: { slot, index: 0 },
    depth,
  })

/** 一个槽：从左到右排，各块的进出线对齐在同一高度 */
function sequence(ctx: Ctx, slot: GtPath, depth: number): Box {
  const steps = stepsAt(ctx.doc, slot)
  const boxes: { box: Box; index: number }[] = []
  steps.forEach((s, i) => {
    if (s && typeof s === 'object') boxes.push({ box: stepBox(ctx, s, [...slot, i], depth), index: i })
  })
  if (!boxes.length) return emptySlot(slot, depth)
  const ay = Math.max(...boxes.map((b) => b.box.ay))
  const out: Box = { nodes: [], edges: [], w: 0, h: 0, ay, inId: boxes[0].box.inId, outId: '' }
  let x = 0
  boxes.forEach(({ box, index }, k) => {
    const placed = shift(box, x, ay - box.ay)
    out.nodes.push(...placed.nodes)
    out.edges.push(...placed.edges)
    out.h = Math.max(out.h, ay - box.ay + box.h)
    if (k > 0) {
      const prev = boxes[k - 1].box
      out.edges.push({
        id: `next:${prev.outId}>${box.inId}`,
        from: prev.outId,
        to: box.inId,
        kind: 'next',
        insert: { slot, index },
      })
    }
    x += box.w + SIZE.gapX
    out.outId = box.outId
  })
  out.w = x - SIZE.gapX
  return out
}

function stepBox(ctx: Ctx, step: GtStep, path: GtPath, depth: number): Box {
  const key = stepKey(step, path)
  const slots = slotsOf(step)
  const look = flowLookOf(step.action)
  if (!slots.length) return leaf({ id: key, kind: 'step', w: SIZE.leafW, h: SIZE.leafH, path, key, step, depth })
  if (ctx.collapsed(step, key)) {
    const hidden = slots.reduce((n, r) => n + countIn((getAt(step, r.key) as unknown[]) ?? []), 0)
    return leaf({
      id: key,
      kind: 'step',
      w: SIZE.leafW,
      h: SIZE.leafH,
      path,
      key,
      step,
      hidden,
      tone: look.tone,
      depth,
    })
  }
  if (slots.length === 1) return frameBox(ctx, step, path, key, [...path, ...slots[0].key], depth)
  return branchBox(ctx, step, path, key, depth)
}

/** 一个槽的块（步骤段、循环）：框 + 框里的步骤 */
function frameBox(ctx: Ctx, step: GtStep, path: GtPath, key: string, slot: GtPath, depth: number): Box {
  const look = flowLookOf(step.action)
  const inner = sequence(ctx, slot, depth + 1)
  const bottom = look.repeat ? SIZE.back : 0
  const w = inner.w + SIZE.pad * 2
  const h = SIZE.head + SIZE.pad * 2 + inner.h + bottom
  const ay = SIZE.head + SIZE.pad + inner.ay
  const placed = shift(inner, SIZE.pad, SIZE.head + SIZE.pad)
  const edges = [...placed.edges]
  if (look.repeat && inner.inId !== inner.outId)
    edges.push({
      id: `back:${key}`,
      from: inner.outId,
      to: inner.inId,
      kind: 'back',
      channelY: h - SIZE.back / 2 - 4,
    })
  return {
    nodes: [
      { id: key, kind: 'frame', x: 0, y: 0, w, h, anchorY: ay, path, key, step, tone: look.tone, depth },
      ...placed.nodes,
    ],
    edges,
    w,
    h,
    ay,
    inId: key,
    outId: key,
  }
}

/** 多个槽的块（如果）：判断节点 → 每个槽一条路，上下排开 → 汇合点 */
function branchBox(ctx: Ctx, step: GtStep, path: GtPath, key: string, depth: number): Box {
  const merge = `${key}#merge`
  const lanes: { box?: Box; slot: GtPath; kind: SlotKind; index?: number }[] = slotsOf(step).map((r) => {
    const slot = [...path, ...r.key]
    // 空的「否则」不画占位：判断节点直接连到汇合点，线上点 + 往里插
    const empty = !stepsAt(ctx.doc, slot).length
    return {
      slot,
      kind: r.kind,
      index: r.index,
      box: empty && r.kind === 'else' ? undefined : sequence(ctx, slot, depth + 1),
    }
  })
  const laneW = Math.max(SIZE.emptyW, ...lanes.map((l) => l.box?.w ?? 0))
  const laneH = (l: (typeof lanes)[number]) => l.box?.h ?? SIZE.emptyH
  const total = lanes.reduce((n, l) => n + laneH(l), 0) + SIZE.branchGap * (lanes.length - 1)
  const h = Math.max(total, SIZE.leafH)
  const ay = h / 2
  const laneX = SIZE.leafW + SIZE.gapX
  const mergeX = laneX + laneW + SIZE.gapX
  const out: Box = {
    nodes: [
      {
        id: key,
        kind: 'branch',
        x: 0,
        y: ay - SIZE.leafH / 2,
        w: SIZE.leafW,
        h: SIZE.leafH,
        anchorY: SIZE.leafH / 2,
        path,
        key,
        step,
        tone: 'branch',
        depth,
      },
      {
        id: merge,
        kind: 'merge',
        x: mergeX,
        y: ay - SIZE.mergeD / 2,
        w: SIZE.mergeD,
        h: SIZE.mergeD,
        anchorY: SIZE.mergeD / 2,
        depth,
      },
    ],
    edges: [],
    w: mergeX + SIZE.mergeD,
    h,
    ay,
    inId: key,
    outId: merge,
  }
  let y = (h - total) / 2
  for (const l of lanes) {
    const tag = { kind: 'branch' as const, slotKind: l.kind, index: l.index }
    if (!l.box) {
      out.edges.push({
        id: `branch:${key}>${pathStr(l.slot)}`,
        from: key,
        to: merge,
        ...tag,
        insert: { slot: l.slot, index: 0 },
      })
    } else {
      const placed = shift(l.box, laneX, y)
      out.nodes.push(...placed.nodes)
      out.edges.push(...placed.edges)
      out.edges.push({ id: `branch:${key}>${pathStr(l.slot)}`, from: key, to: l.box.inId, ...tag })
      out.edges.push({
        id: `join:${pathStr(l.slot)}`,
        from: l.box.outId,
        to: merge,
        kind: 'next',
        insert: { slot: l.slot, index: stepsAt(ctx.doc, l.slot).length },
      })
    }
    y += laneH(l) + SIZE.branchGap
  }
  return out
}

const term = (role: 'start' | 'end', insert: InsertAt): Box =>
  leaf({ id: `#${role}`, kind: 'term', w: SIZE.termW, h: SIZE.termH, role, insert, depth: 0 })

/** 前置步骤（setup）画成主流程最前面的一个框 */
function setupBox(ctx: Ctx): Box | undefined {
  if (!stepsAt(ctx.doc, ['setup']).length) return undefined
  const inner = sequence(ctx, ['setup'], 1)
  const w = inner.w + SIZE.pad * 2
  const h = SIZE.head + SIZE.pad * 2 + inner.h
  const ay = SIZE.head + SIZE.pad + inner.ay
  const placed = shift(inner, SIZE.pad, SIZE.head + SIZE.pad)
  return {
    nodes: [
      { id: '#setup', kind: 'frame', x: 0, y: 0, w, h, anchorY: ay, role: 'setup', tone: 'group', depth: 0 },
      ...placed.nodes,
    ],
    edges: placed.edges,
    w,
    h,
    ay,
    inId: '#setup',
    outId: '#setup',
  }
}

/** 主流程：开始 →（前置）→ 步骤 → 结束 */
function mainFlow(ctx: Ctx): Box {
  const steps = stepsAt(ctx.doc, ['steps'])
  const parts: Box[] = [term('start', { slot: ['steps'], index: 0 })]
  const setup = setupBox(ctx)
  if (setup) parts.push(setup)
  const body = steps.length ? sequence(ctx, ['steps'], 0) : undefined
  if (body) parts.push(body)
  parts.push(term('end', { slot: ['steps'], index: steps.length }))
  const ay = Math.max(...parts.map((p) => p.ay))
  const out: Box = { nodes: [], edges: [], w: 0, h: 0, ay, inId: parts[0].inId, outId: '' }
  let x = 0
  parts.forEach((p, k) => {
    const placed = shift(p, x, ay - p.ay)
    out.nodes.push(...placed.nodes)
    out.edges.push(...placed.edges)
    out.h = Math.max(out.h, ay - p.ay + p.h)
    if (k > 0) {
      const prev = parts[k - 1]
      // 线插到哪：进前置框之前插进 setup 开头；进主流程第一步之前插进 steps 开头；到「结束」之前插到 steps 末尾
      const insert: InsertAt =
        p === setup ? { slot: ['setup'], index: 0 } : { slot: ['steps'], index: p === body ? 0 : steps.length }
      out.edges.push({ id: `next:${prev.outId}>${p.inId}`, from: prev.outId, to: p.inId, kind: 'next', insert })
    }
    x += p.w + SIZE.gapX
    out.outId = p.outId
  })
  out.w = x - SIZE.gapX
  return out
}

/** 守护栏：全局的在上，本脚本的、挂在块上的在下，同时成立时按这个先后处理（协议 5 节） */
function guardRail(ctx: Ctx, globals: GtGuard[], top: number): FlowNode[] {
  const rows: Omit<FlowNode, 'x' | 'y' | 'anchorY'>[] = []
  globals.forEach((g, i) =>
    rows.push({
      id: `guard:global:${g.id ?? i}`,
      kind: 'guard',
      w: SIZE.guardW,
      h: SIZE.guardH,
      guard: g,
      key: g.id,
      scope: 'global',
      depth: 1,
    }),
  )
  walkGuards(ctx.doc, (e) =>
    rows.push({
      id: `guard:${pathStr(e.path)}`,
      kind: 'guard',
      w: SIZE.guardW,
      h: SIZE.guardH,
      guard: e.guard,
      path: e.path,
      key: e.guard.id,
      scope: e.owner ? 'block' : 'script',
      depth: 1,
    }),
  )
  const body = rows.length * SIZE.guardH + Math.max(0, rows.length - 1) * SIZE.guardGap
  const h = SIZE.railHead + body + SIZE.pad + SIZE.railFoot
  const w = SIZE.guardW + SIZE.pad * 2
  const out: FlowNode[] = [
    {
      id: '#guards',
      kind: 'rail',
      x: 0,
      y: top,
      w,
      h,
      anchorY: 0,
      insert: { slot: ['guards'], index: ctx.doc.guards?.length ?? 0 },
      depth: 0,
    },
  ]
  rows.forEach((r, i) =>
    out.push({
      ...r,
      x: SIZE.pad,
      y: top + SIZE.railHead + i * (SIZE.guardH + SIZE.guardGap),
      anchorY: SIZE.guardH / 2,
    }),
  )
  return out
}

export function layoutFlow(doc: GtScript, o: LayoutOptions = {}): FlowLayout {
  const ctx: Ctx = { doc, collapsed: o.collapsed ?? defaultCollapsed }
  const main = mainFlow(ctx)
  const rail = guardRail(ctx, o.globalGuards ?? [], main.h + SIZE.railGap)
  const nodes = [...main.nodes, ...rail]
  const railNode = rail[0]
  return {
    nodes,
    edges: main.edges,
    w: Math.max(main.w, railNode.w),
    h: railNode.y + railNode.h,
  }
}
