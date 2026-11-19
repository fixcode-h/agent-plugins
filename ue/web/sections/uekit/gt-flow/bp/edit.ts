import {
  getAt,
  idMaker,
  idPrefixOf,
  insert,
  isPrefix,
  samePath,
  slotsOf,
  usedIds,
  type EditResult,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../../shared/gt-script/index.ts'
import { LAYOUT_KEY, isLoosePath, layoutOf, looseSlot, type BpAt, type BpLayout, type BpNote } from './graph.ts'

/**
 * 蓝图式画布上的改动（纯函数，单测在 graph.test.ts）：都返回新脚本，原来的不动。
 * 语义照 UE 蓝图：一个输出引脚只接一根线——把线接到另一个节点上，那个节点连同它后面那串挪过来，
 * 这里原来接着的那串断开、变成「没连上」（留在画布上，不执行，随时能再连回去）。
 */

const clone = <T>(v: T): T => structuredClone(v)
const isStep = (v: unknown): v is GtStep => !!v && typeof v === 'object' && typeof (v as GtStep).action === 'string'

function slotArr(doc: GtScript, slot: GtPath): unknown[] {
  let cur: Record<string | number, unknown> = doc as Record<string, unknown>
  slot.forEach((k, i) => {
    let next = cur[k]
    if (i === slot.length - 1) {
      if (!Array.isArray(next)) cur[k] = next = []
    } else if (!next || typeof next !== 'object') cur[k] = next = typeof slot[i + 1] === 'number' ? [] : {}
    cur = next as Record<string | number, unknown>
  })
  return cur as unknown as unknown[]
}

function layoutMut(doc: GtScript): BpLayout {
  const l = layoutOf(doc)
  if (doc[LAYOUT_KEY] !== l) doc[LAYOUT_KEY] = l
  return l
}

/** 一棵步骤树里所有的步骤（含块里的） */
function eachStep(steps: unknown[], fn: (s: GtStep) => void) {
  for (const s of steps) {
    if (!isStep(s)) continue
    fn(s)
    for (const r of slotsOf(s)) {
      const a = getAt(s, r.key)
      if (Array.isArray(a)) eachStep(a, fn)
    }
  }
}

/** 没连上的步骤的 id（usedIds 只看流程里的） */
function looseIds(doc: GtScript) {
  const ids = new Set<string>()
  for (const c of layoutOf(doc).loose ?? []) eachStep(c?.steps ?? [], (s) => typeof s.id === 'string' && ids.add(s.id))
  return ids
}

/** 换 key 时位置跟着走（流程里的 key 是 id，没连上的是 ~id） */
function renamePos(doc: GtScript, steps: unknown[], from: (id: string) => string, to: (id: string) => string) {
  const pos = layoutOf(doc).pos
  if (!pos) return
  eachStep(steps, (s) => {
    if (typeof s.id !== 'string') return
    const p = pos[from(s.id)]
    if (!p) return
    delete pos[from(s.id)]
    pos[to(s.id)] = p
  })
}
const plain = (id: string) => id
const tilde = (id: string) => `~${id}`

/**
 * 收尾：去掉空的没连上的串；没连上的步骤 id 和流程里的撞了（流程里新插了步骤）就给没连上的换一个，位置跟着换
 */
export function tidyLoose(doc: GtScript): GtScript {
  const l = layoutOf(doc)
  if (!Array.isArray(l.loose)) return doc
  l.loose = l.loose.filter((c) => c && Array.isArray(c.steps) && c.steps.some(isStep))
  if (!l.loose.length) delete l.loose
  const used = usedIds(doc)
  const seen = new Set<string>()
  const next = idMaker(new Set([...used, ...looseIds(doc)]))
  for (const c of l.loose ?? [])
    eachStep(c.steps, (s) => {
      if (typeof s.id === 'string' && s.id && !used.has(s.id) && !seen.has(s.id)) return void seen.add(s.id)
      const old = s.id
      s.id = next(idPrefixOf(s))
      seen.add(s.id)
      const pos = l.pos
      if (old && pos?.[tilde(old)]) {
        pos[tilde(s.id)] = pos[tilde(old)]
        delete pos[tilde(old)]
      }
    })
  if (doc[LAYOUT_KEY] && !Object.keys(l).length) delete doc[LAYOUT_KEY]
  return doc
}

/** 把 at 处往后那串断开，挪成一串没连上的（Alt 点引脚、删掉连线） */
export function disconnect(doc: GtScript, at: BpAt): GtScript | undefined {
  const out = clone(doc)
  const a = slotArr(out, at.slot)
  if (at.index >= a.length) return undefined
  detachTail(out, at)
  return tidyLoose(out)
}

function detachTail(out: GtScript, at: BpAt) {
  const tail = slotArr(out, at.slot).splice(at.index)
  if (!tail.length) return
  const l = layoutMut(out)
  l.loose = [...(l.loose ?? []), { steps: tail as GtStep[] }]
  if (!isLoosePath(at.slot)) renamePos(out, tail, plain, tilde)
}

/**
 * 把输出引脚 at 接到 target 这一步上：target 连同它后面那串挪到 at，at 原来接着的那串变成没连上。
 * 不能接到自己里面（块的子槽接回块本身、下一步接回自己前面）：返回 undefined
 */
export function connect(doc: GtScript, at: BpAt, target: GtPath): EditResult | undefined {
  const tSlot = target.slice(0, -1)
  const tIndex = target[target.length - 1]
  if (typeof tIndex !== 'number') return undefined
  // 已经接着它了
  if (samePath(tSlot, at.slot) && tIndex === at.index) return undefined
  // at 在要挪的那串里面（同一槽里 target 之后，或者在那串某一步的子槽里）：成环
  if (isPrefix(tSlot, at.slot) && at.slot.length > tSlot.length) {
    const i = at.slot[tSlot.length]
    if (typeof i === 'number' && i >= tIndex) return undefined
  }
  if (samePath(tSlot, at.slot) && at.index > tIndex) return undefined
  const out = clone(doc)
  const from = slotArr(out, tSlot)
  if (!isStep(from[tIndex])) return undefined
  const chain = from.splice(tIndex)
  const fromLoose = isLoosePath(tSlot)
  const toLoose = isLoosePath(at.slot)
  // 先断开 at 后面原来那串，再把挪过来的接上
  detachTail(out, at)
  const dest = slotArr(out, at.slot)
  const index = Math.min(at.index, dest.length)
  // 流程里别的步骤占着的 id（挪进来的那串还没放进去）
  const used = usedIds(out)
  dest.push(...chain)
  if (fromLoose && !toLoose) {
    // 从没连上的接回流程：id 和流程里的撞了先换一个（别的视图插步骤时只看流程里的 id），位置从 ~id 换回 id
    const next = idMaker(new Set([...used, ...looseIds(out)]))
    const pos = layoutOf(out).pos
    eachStep(chain, (st) => {
      if (typeof st.id !== 'string' || !used.has(st.id)) return
      const old = st.id
      st.id = next(idPrefixOf(st))
      if (pos?.[tilde(old)]) {
        pos[tilde(st.id)] = pos[tilde(old)]
        delete pos[tilde(old)]
      }
    })
    renamePos(out, chain, tilde, plain)
  } else if (!fromLoose && toLoose) renamePos(out, chain, plain, tilde)
  tidyLoose(out)
  return { doc: out, path: [...(toLoose ? slotOfObject(out, dest) ?? at.slot : at.slot), index] }
}

/** 没连上的串删掉空的以后下标会变：按数组对象找回它现在是第几串 */
function slotOfObject(doc: GtScript, a: unknown[]): GtPath | undefined {
  const i = (layoutOf(doc).loose ?? []).findIndex((c) => c.steps === a)
  return i < 0 ? undefined : looseSlot(i)
}

/** 拖到空白处 / 右键加的节点：放进一串新的没连上的，记下位置 */
export function addLoose(doc: GtScript, steps: GtStep[], x: number, y: number): EditResult {
  const out = clone(doc)
  const next = idMaker(new Set([...usedIds(out), ...looseIds(out)]))
  const fresh = steps.map((s) => {
    const c = clone(s)
    eachStep([c], (st) => {
      st.id = next(idPrefixOf(st))
    })
    return c
  })
  const l = layoutMut(out)
  l.loose = [...(l.loose ?? []), { steps: fresh }]
  l.pos = { ...(l.pos ?? {}), [tilde(fresh[0].id!)]: [Math.round(x), Math.round(y)] }
  return { doc: out, path: [...looseSlot(l.loose.length - 1), 0] }
}

/** 在引脚处插入新步骤（从引脚拖到空白处选的节点）：插在中间，原来接着的接到新步骤后面；位置记在 (x, y) */
export function insertAtPin(doc: GtScript, at: BpAt, steps: GtStep[], x: number, y: number): EditResult | undefined {
  const r = insert(doc, at.slot, at.index, steps)
  if (!r) return undefined
  const out = r.doc
  const step = getAt(out, r.path) as GtStep
  const l = layoutMut(out)
  const key = isLoosePath(at.slot) ? tilde(step.id!) : step.id!
  l.pos = { ...(l.pos ?? {}), [key]: [Math.round(x), Math.round(y)] }
  return { doc: tidyLoose(out), path: r.path }
}

/** 拖完节点记位置（一次可以好几个：框选一起拖） */
export function setPositions(doc: GtScript, moved: { key: string; x: number; y: number }[]): GtScript | undefined {
  if (!moved.length) return undefined
  const out = clone(doc)
  const l = layoutMut(out)
  const pos = { ...(l.pos ?? {}) }
  const notes = Array.isArray(l.notes) ? l.notes : []
  for (const m of moved) {
    if (m.key.startsWith('n:')) {
      const n = notes.find((x) => `n:${x.id}` === m.key)
      if (n) Object.assign(n, { x: Math.round(m.x), y: Math.round(m.y) })
    } else pos[m.key] = [Math.round(m.x), Math.round(m.y)]
  }
  l.pos = pos
  return out
}

/** 整理布局：忘掉记下的位置，全部按自动布局重排（注释框不动） */
export function clearPositions(doc: GtScript): GtScript {
  const out = clone(doc)
  const l = layoutMut(out)
  delete l.pos
  return tidyLoose(out)
}

export function addNote(doc: GtScript, x: number, y: number, text: string): GtScript {
  const out = clone(doc)
  const l = layoutMut(out)
  const notes = Array.isArray(l.notes) ? l.notes : []
  let i = notes.length + 1
  while (notes.some((n) => n.id === `n${i}`)) i++
  l.notes = [...notes, { id: `n${i}`, x: Math.round(x), y: Math.round(y), text }]
  return out
}

export function updateNote(doc: GtScript, id: string, patch: Partial<BpNote> | undefined): GtScript {
  const out = clone(doc)
  const l = layoutMut(out)
  const notes = Array.isArray(l.notes) ? l.notes : []
  l.notes = patch ? notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) : notes.filter((n) => n.id !== id)
  if (!l.notes.length) delete l.notes
  return tidyLoose(out)
}
