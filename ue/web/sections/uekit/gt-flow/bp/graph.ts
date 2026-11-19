import {
  getAt,
  pathStr,
  slotsOf,
  type GtGuard,
  type GtPath,
  type GtScript,
  type GtStep,
  type SlotKind,
} from '../../../../../shared/gt-script/index.ts'

/**
 * GameTest 蓝图式流程图的图模型（设计稿 designs/GameTest整页编辑器与蓝图画布-设计稿.md 第 3 节）。
 * 数据还是结构化的块数组，画法照 UE 蓝图：每一步一个节点，左边一个输入引脚，右边的输出引脚就是「接下来做什么」——
 * 一步接着一步走「下一步」引脚；块（如果、循环、步骤段）的每个子槽一个引脚（是 / 否 / 每轮…），外加「之后」接块后面那步。
 * 开始、每条守护是事件节点（守护后面接它的处理步骤）。
 *
 * 画布上的东西存在脚本顶层的 `_layout` 里（GameTest 读脚本不校验顶层下划线开头的字段，跑的时候不管它）：
 * - pos：节点位置，键是节点 key（步骤 id；没连上的步骤前面加 ~；守护 g:id；开始 #start）
 * - loose：没连上的几串步骤（蓝图里没连线的节点），不执行，连回去就回到流程里
 * - notes：注释框
 * 没记位置的节点按自动布局摆（新插进来的跟着前一个节点走），所以旧脚本打开就是整齐的。纯函数，单测在 graph.test.ts
 */

export interface BpNote {
  id: string
  /** 在哪个块里面（同 loose 的 scope） */
  scope?: string
  x: number
  y: number
  w?: number
  h?: number
  text: string
}

export interface BpLayout {
  pos?: Record<string, [number, number]>
  /** scope：在哪个块里面（块的 key，见 scopeKey）；不写是最外层 */
  loose?: { steps: GtStep[]; scope?: string }[]
  notes?: BpNote[]
}

export const LAYOUT_KEY = '_layout'
export const START_KEY = '#start'
export const SETUP_KEY = '#setup'

export function layoutOf(doc: GtScript): BpLayout {
  const l = doc[LAYOUT_KEY]
  return l && typeof l === 'object' && !Array.isArray(l) ? (l as BpLayout) : {}
}

/** 没连上的第 i 串步骤所在的槽 */
export const looseSlot = (i: number): GtPath => [LAYOUT_KEY, 'loose', i, 'steps']
export const isLoosePath = (p: GtPath) => p[0] === LAYOUT_KEY && p[1] === 'loose'

/** 输出引脚接到哪：槽 + 下标（往这里接的步骤插在这个位置） */
export interface BpAt {
  slot: GtPath
  index: number
}

/** 引脚的种类：next 下一步 / 之后；then、elif、else、do 是块的子槽 */
export interface BpPin {
  id: string
  kind: 'next' | SlotKind
  /** 第几个「否则如果」 */
  index?: number
  at: BpAt
}

/** entry：进到块里面时，块的每个子槽一个入口事件节点（照 UE 蓝图折叠图的输入节点） */
export type BpKind = 'start' | 'setup' | 'step' | 'guard' | 'note' | 'entry'

export interface BpNode {
  id: string
  kind: BpKind
  x: number
  y: number
  /** 步骤（step）：路径（没连上的在 _layout.loose 里）和步骤本身 */
  path?: GtPath
  step?: GtStep
  /** 没连上，不执行 */
  loose?: boolean
  /** 块：里面有几步（块在画布上只画一个节点，双击进到里面看） */
  folded?: number
  /** 入口节点：是哪个子槽（then / else / do…）和第几个「否则如果」，块是什么（循环的 do 叫「每轮」） */
  entry?: { kind: SlotKind; index?: number; action: string }
  /** 守护：路径（guards.N）和守护本身；global 是运行设置里的全局守护（只读，没有处理步骤） */
  guard?: GtGuard
  guardPath?: GtPath
  global?: boolean
  note?: BpNote
  outs: BpPin[]
  /** 有输入引脚（事件节点、注释框没有） */
  input: boolean
}

export interface BpEdge {
  id: string
  from: string
  pin: string
  to: string
  at: BpAt
}

export interface BpGraph {
  nodes: BpNode[]
  edges: BpEdge[]
}

/** 自动布局用的估计尺寸（真实尺寸由画布量，这里只要排得开） */
export const BP = { w: 220, eventW: 240, head: 34, body: 26, row: 24, gx: 64, gy: 36, start: 120 } as const

const nodeH = (n: BpNode) => {
  // 「下一步 / 之后」在头部，子槽一行一个
  const rows = n.outs.filter((p) => p.kind !== 'next').length
  return BP.head + BP.body + rows * BP.row
}
const nodeW = (n: BpNode) =>
  n.kind === 'start' || n.kind === 'setup' || n.kind === 'entry' ? BP.start : n.kind === 'guard' ? BP.eventW : BP.w

const arr = (doc: unknown, p: GtPath) => {
  const a = getAt(doc, p)
  return Array.isArray(a) ? (a as unknown[]) : []
}
const isStep = (v: unknown): v is GtStep => !!v && typeof v === 'object' && typeof (v as GtStep).action === 'string'

/** 步骤节点的 key：步骤 id（没有 id 时用路径）；没连上的前面加 ~，和流程里的不会撞 */
export function bpKey(step: GtStep, path: GtPath) {
  const base = typeof step.id === 'string' && step.id ? step.id : pathStr(path)
  return isLoosePath(path) ? `~${base}` : base
}
export const guardKey = (g: GtGuard, i: number) => `g:${typeof g.id === 'string' && g.id ? g.id : i}`

/** 一个块的输出引脚：每个子槽一个，再加「之后」；叶子只有「下一步」 */
function pinsOf(step: GtStep, path: GtPath, folded: boolean): BpPin[] {
  const slot = path.slice(0, -1)
  const index = path[path.length - 1] as number
  const next: BpPin = { id: 'next', kind: 'next', at: { slot, index: index + 1 } }
  const slots = folded ? [] : slotsOf(step)
  return [
    ...slots.map(
      (r): BpPin => ({
        id: `s:${pathStr(r.key)}`,
        kind: r.kind,
        index: r.index,
        at: { slot: [...path, ...r.key], index: 0 },
      }),
    ),
    next,
  ]
}

/** 块里一共多少步（折叠时显示） */
function countInside(step: GtStep): number {
  let n = 0
  for (const r of slotsOf(step)) for (const s of arr(step, r.key)) if (isStep(s)) n += 1 + countInside(s)
  return n
}

export interface GraphOptions {
  /** 进到哪个块里面看（块的路径）；不给是最外层 */
  scope?: GtPath
  globalGuards?: GtGuard[]
}

/** 块当作「里面」时的 key：步骤 id，没有 id 用路径（没连上的串、注释框按它记属于哪一层） */
export const scopeKey = (step: GtStep, path: GtPath) =>
  typeof step.id === 'string' && step.id ? step.id : pathStr(path)

/**
 * 一个步骤槽在哪一层：最近的外层块的 key；最外层（steps、setup、顶层守护）是 ''。
 * 没连上的串的最外一层按它记的 scope
 */
export function scopeOfSlot(doc: GtScript, slot: GtPath): string {
  for (let i = slot.length - 1; i > 0; i--) {
    const p = slot.slice(0, i)
    if (isLoosePath(slot) && p.length < 4) break
    const v = getAt(doc, p)
    if (isStep(v)) return scopeKey(v, p)
  }
  if (isLoosePath(slot)) return layoutOf(doc).loose?.[slot[2] as number]?.scope ?? ''
  return ''
}

/** 按块的 key 找回它现在的路径（找不到返回 undefined：块被删了或换了 id） */
export function findScope(doc: GtScript, key: string): GtPath | undefined {
  let hit: GtPath | undefined
  const visit = (slot: GtPath) => {
    arr(doc, slot).forEach((raw, i) => {
      if (hit || !isStep(raw)) return
      const p = [...slot, i]
      if (scopeKey(raw, p) === key && slotsOf(raw).length) return void (hit = p)
      for (const r of slotsOf(raw)) visit([...p, ...r.key])
    })
  }
  visit(['steps'])
  visit(['setup'])
  arr(doc, ['guards']).forEach((_, i) => visit(['guards', i, 'do']))
  ;(layoutOf(doc).loose ?? []).forEach((_, i) => visit(looseSlot(i)))
  return hit
}

/** 从脚本算出画布上的节点和连线（位置：记过的照记的，没记的自动摆） */
export function bpGraph(doc: GtScript, o: GraphOptions = {}): BpGraph {
  const layout = layoutOf(doc)
  const scopeStep = o.scope ? (getAt(doc, o.scope) as GtStep | undefined) : undefined
  const scope = o.scope && isStep(scopeStep) ? o.scope : undefined
  const here = scope ? scopeKey(scopeStep!, scope) : ''
  const nodes: BpNode[] = []
  const edges: BpEdge[] = []
  const byId = new Map<string, BpNode>()
  const add = (n: BpNode) => {
    nodes.push(n)
    byId.set(n.id, n)
    return n
  }
  // 自动布局：每串从 (x, y) 往右排成一行，「之后」接着往右走直线；块的子槽（是 / 否 / 每轮…）排在块右下方，
  // 一个槽一行往下排开。块连同它展开的子槽算一整块：后面那步排在整块的右边，不和别的块的子槽挤在同几列里
  // （用户 2026-11-19：以前后面那步紧挨着块，几个块的子槽交错排在同几列、连线交叉，看不出谁属于哪个块）
  const auto = new Map<string, [number, number]>()
  /** 前一个节点（新插进来、没记位置的节点跟着它摆） */
  const prev = new Map<string, string>()

  const chain = (slot: GtPath, x: number, y: number, from?: { node: string; pin: BpPin }): { w: number; h: number } => {
    let cx = x
    let right = x
    let bottom = y
    let link = from
    arr(doc, slot).forEach((raw, i) => {
      if (!isStep(raw)) return
      const path = [...slot, i]
      const key = bpKey(raw, path)
      // 块只画一个节点（用户 2026-11-19：不在原地展开，双击进到里面看，顶上路径显示在第几层）
      const folded = slotsOf(raw).length > 0
      const n = add({
        id: key,
        kind: 'step',
        x: 0,
        y: 0,
        path,
        step: raw,
        loose: isLoosePath(path),
        folded: folded ? countInside(raw) : undefined,
        outs: pinsOf(raw, path, folded),
        input: true,
      })
      auto.set(key, [cx, y])
      if (link) {
        edges.push({
          id: `${link.node}:${link.pin.id}>${key}`,
          from: link.node,
          pin: link.pin.id,
          to: key,
          at: link.pin.at,
        })
        prev.set(key, link.node)
      }
      const bw = nodeW(n)
      const bh = nodeH(n)
      right = Math.max(right, cx + bw)
      bottom = Math.max(bottom, y + bh)
      // 这一块占到的右边界：块自己，展开了再加上子槽
      let blockRight = cx + bw
      const subs = n.outs.filter((p) => p.kind !== 'next')
      if (subs.length) {
        const sx = cx + bw + BP.gx
        let sy = y + bh + BP.gy
        for (const p of subs) {
          const r = chain(p.at.slot, sx, sy, { node: key, pin: p })
          blockRight = Math.max(blockRight, sx + r.w)
          sy += Math.max(r.h, BP.row) + BP.gy
        }
        right = Math.max(right, blockRight)
        bottom = Math.max(bottom, sy - BP.gy)
      }
      cx = blockRight + BP.gx
      link = { node: key, pin: n.outs[n.outs.length - 1] }
    })
    return { w: Math.max(0, right - x), h: bottom - y }
  }

  let y = 0
  if (scope) {
    // 进到块里面：块的每个子槽一个入口节点，后面接这个槽里的步骤
    for (const r of slotsOf(scopeStep!)) {
      const key = `#in:${pathStr(r.key)}`
      const pin: BpPin = { id: 'next', kind: 'next', at: { slot: [...scope, ...r.key], index: 0 } }
      add({
        id: key,
        kind: 'entry',
        x: 0,
        y: 0,
        entry: { kind: r.kind, index: r.index, action: scopeStep!.action },
        outs: [pin],
        input: false,
      })
      auto.set(key, [0, y])
      const c = chain(pin.at.slot, BP.start + BP.gx, y, { node: key, pin })
      y += Math.max(c.h, BP.head) + BP.gy * 2
    }
  } else y = root(y)
  // 没连上的：一串一行，排在最下面（只画这一层的）
  y += BP.gy
  ;(layout.loose ?? []).forEach((c, i) => {
    if ((c?.scope ?? '') !== here) return
    const r = chain(looseSlot(i), 0, y)
    y += Math.max(r.h, BP.head) + BP.gy
  })
  for (const note of Array.isArray(layout.notes) ? layout.notes : []) {
    if (!note || typeof note.id !== 'string' || (note.scope ?? '') !== here) continue
    add({ id: `n:${note.id}`, kind: 'note', x: note.x, y: note.y, note, outs: [], input: false })
  }

  function root(y: number) {
    // 主流程：开始 → steps；有 setup 时多一个「准备」事件
    const startPin: BpPin = { id: 'next', kind: 'next', at: { slot: ['steps'], index: 0 } }
    add({ id: START_KEY, kind: 'start', x: 0, y: 0, outs: [startPin], input: false })
    auto.set(START_KEY, [0, y])
    const main = chain(['steps'], BP.start + BP.gx, y, { node: START_KEY, pin: startPin })
    y += Math.max(main.h, BP.head) + BP.gy * 2
    if (arr(doc, ['setup']).length) {
      const pin: BpPin = { id: 'next', kind: 'next', at: { slot: ['setup'], index: 0 } }
      add({ id: SETUP_KEY, kind: 'setup', x: 0, y: 0, outs: [pin], input: false })
      auto.set(SETUP_KEY, [0, y])
      const r = chain(['setup'], BP.start + BP.gx, y, { node: SETUP_KEY, pin })
      y += Math.max(r.h, BP.head) + BP.gy * 2
    }
    // 守护：一条一个事件节点，后面接它的处理步骤
    arr(doc, ['guards']).forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const g = raw as GtGuard
      const key = guardKey(g, i)
      const pin: BpPin = { id: 'next', kind: 'next', at: { slot: ['guards', i, 'do'], index: 0 } }
      add({ id: key, kind: 'guard', x: 0, y: 0, guard: g, guardPath: ['guards', i], outs: [pin], input: false })
      auto.set(key, [0, y])
      const r = chain(['guards', i, 'do'], BP.eventW + BP.gx, y, { node: key, pin })
      y += Math.max(r.h, BP.head + BP.body) + BP.gy
    })
    ;(o.globalGuards ?? []).forEach((g, i) => {
      const key = `gg:${i}`
      add({ id: key, kind: 'guard', x: 0, y: 0, guard: g, global: true, outs: [], input: false })
      auto.set(key, [0, y])
      y += BP.head + BP.body + BP.gy
    })
    return y
  }

  // 定位置：记过的照记的；没记的跟着前一个节点挪（保持自动布局里的相对位置），前面也没有就用自动布局
  const pos = layout.pos ?? {}
  const done = new Map<string, [number, number]>()
  const place = (n: BpNode): [number, number] => {
    const hit = done.get(n.id)
    if (hit) return hit
    let p: [number, number]
    const saved = pos[n.id]
    const a = auto.get(n.id) ?? [0, 0]
    const before = prev.get(n.id)
    if (Array.isArray(saved) && saved.length === 2) p = [saved[0], saved[1]]
    else if (before && byId.has(before)) {
      const bp = place(byId.get(before)!)
      const ba = auto.get(before) ?? [0, 0]
      p = [bp[0] + a[0] - ba[0], bp[1] + a[1] - ba[1]]
    } else p = a
    done.set(n.id, p)
    return p
  }
  for (const n of nodes) {
    if (n.kind === 'note') continue
    ;[n.x, n.y] = place(n)
  }
  return { nodes, edges }
}

/** 给定节点 key 找它在图里的输出引脚（连线、拖出来新建时用） */
export function pinOf(g: BpGraph, node: string, pin: string | null | undefined) {
  return g.nodes.find((n) => n.id === node)?.outs.find((p) => p.id === (pin ?? 'next'))
}
