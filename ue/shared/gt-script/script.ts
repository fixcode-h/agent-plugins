import { blockOf, idPrefixOf, isBlock, slotsOf } from './blocks/index.ts'
import { comparePath, ensureSlot, getAt, isPrefix, placeOf, samePath } from './path.ts'
import type { GtGuard, GtPath, GtScript, GtStep } from './types.ts'
import { idMaker, usedIds, walk } from './walk.ts'

/**
 * GameTest 脚本的读写和结构操作：插入、删除、移动、放进 / 移出块、包成块、展开、复制、补 id、存盘前整理。
 * 全部是纯函数：传入场景，返回新场景（不改传入的对象），撤销就是留着旧对象。界面、流程图、Agent 离线校验共用。
 * 失败（路径不对、操作不适用）返回 undefined，调用方按「做不了」处理，不抛异常。
 */

/**
 * 支持的 schemaVersion（比它高的文件只读，提示升级面板）。v5（属性路径 v5、in 数组、lua: 类）起只认 v5：
 * 旧版本不迁移（用户 2026-11-21），打开时只读并提示「旧格式不再支持，请按新写法重写」
 */
export const SCHEMA_VERSION = 5

const clone = <T>(v: T): T => structuredClone(v)

/** 结果：新场景 + 操作后关心的那一步的路径（选中跟着它走） */
export interface EditResult {
  doc: GtScript
  path: GtPath
}

// ---------- 读写 ----------

/** 读场景原文：去 BOM、解析、必须是对象。出错返回 error（带位置信息，原样给用户看） */
export function parseScript(text: string): { doc: GtScript } | { error: string } {
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'not an object' }
    return { doc: v as GtScript }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** 写回：UE 写场景用 tab 缩进（FJsonSerializer 的格式），照它写，diff 只有改了的行 */
export const serialize = (doc: GtScript) => JSON.stringify(doc, null, '\t') + '\n'

export const versionOf = (doc: GtScript) => (typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1)

// ---------- id ----------

/** 去掉一棵步骤树里所有的 id（复制、粘贴时重新发） */
function stripIds(step: GtStep) {
  delete step.id
  for (const r of slotsOf(step)) {
    const arr = getAt(step, r.key)
    if (Array.isArray(arr)) for (const s of arr) if (s && typeof s === 'object') stripIds(s as GtStep)
  }
  if (Array.isArray(step.guards))
    for (const g of step.guards as GtGuard[]) {
      delete g.id
      for (const s of g.do ?? []) stripIds(s)
    }
}

/** 给场景里没有 id 的步骤和守护补上（s3、if1、loop2、g1）。改的是传入的对象：内部用，外面用 ensureIds */
function fillIds(doc: GtScript) {
  const next = idMaker(usedIds(doc))
  walk(doc, (e) => {
    if (typeof e.step.id !== 'string' || !e.step.id) e.step.id = next(idPrefixOf(e.step))
    if (Array.isArray(e.step.guards))
      for (const g of e.step.guards as GtGuard[]) if (typeof g.id !== 'string' || !g.id) g.id = next('g')
  })
  for (const g of Array.isArray(doc.guards) ? doc.guards : []) if (typeof g.id !== 'string' || !g.id) g.id = next('g')
  return doc
}

export const ensureIds = (doc: GtScript) => fillIds(clone(doc))

/** 同一个 id 出现几次（JSON 视图手改出来的）：校验报 dup_id */
export function duplicateIds(doc: GtScript) {
  const seen = new Map<string, number>()
  walk(doc, (e) => {
    if (typeof e.step.id === 'string' && e.step.id) seen.set(e.step.id, (seen.get(e.step.id) ?? 0) + 1)
  })
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

// ---------- 结构操作 ----------

/** 在槽 slot 的 index 处插入几步（新步骤的 id 重新发，和场景里已有的不撞） */
export function insert(doc: GtScript, slot: GtPath, index: number, steps: GtStep[]): EditResult | undefined {
  const out = clone(doc)
  const arr = ensureSlot(out as Record<string, unknown>, slot)
  const at = Math.max(0, Math.min(index, arr.length))
  const fresh = steps.map((s) => {
    const c = clone(s)
    stripIds(c)
    return c
  })
  arr.splice(at, 0, ...fresh)
  fillIds(out)
  return { doc: out, path: [...slot, at] }
}

/** 删掉几步（可以跨槽；同时选了块和它里面的步骤也没关系） */
export function remove(doc: GtScript, paths: GtPath[]): GtScript | undefined {
  const out = clone(doc)
  const sorted = [...paths].sort(comparePath).reverse()
  for (const p of sorted) {
    const place = placeOf(out, p)
    if (!place) continue
    ;(getAt(out, place.slot) as unknown[]).splice(place.index, 1)
  }
  return out
}

/** 换掉一步（检查器改字段）。id 留原来的，除非新步骤自己带了 */
export function replace(doc: GtScript, path: GtPath, step: GtStep): EditResult | undefined {
  const place = placeOf(doc, path)
  if (!place) return undefined
  const out = clone(doc)
  const old = getAt(out, path) as GtStep
  const next = clone(step)
  if (!next.id && old.id) next.id = old.id
  ;(getAt(out, place.slot) as unknown[])[place.index] = next
  fillIds(out)
  return { doc: out, path }
}

/** 删掉一步后，原来指向它后面兄弟（及其子孙）的路径要减一 */
function shiftAfterRemoval(target: GtPath, removedSlot: GtPath, removedIndex: number): GtPath {
  if (!isPrefix(removedSlot, target) || target.length <= removedSlot.length) return target
  const k = removedSlot.length
  const i = target[k]
  if (typeof i !== 'number' || i <= removedIndex) return target
  const out = [...target]
  out[k] = i - 1
  return out
}

/** 把一步挪到另一个槽的 index 处（拖动、移进移出块都走它）。不能挪进自己里面。id 不变 */
export function move(doc: GtScript, from: GtPath, toSlot: GtPath, toIndex: number): EditResult | undefined {
  const place = placeOf(doc, from)
  if (!place || isPrefix(from, toSlot)) return undefined
  const out = clone(doc)
  const step = (getAt(out, place.slot) as unknown[]).splice(place.index, 1)[0]
  const slot = shiftAfterRemoval(toSlot, place.slot, place.index)
  let index = toIndex
  if (samePath(slot, place.slot) && index > place.index) index--
  const arr = ensureSlot(out as Record<string, unknown>, slot)
  index = Math.max(0, Math.min(index, arr.length))
  arr.splice(index, 0, step)
  return { doc: out, path: [...slot, index] }
}

/** 往上 / 往下挪一格（Alt+↑↓）：在兄弟里换位置；到了槽的边上就移出这个块，放到块的前面 / 后面 */
export function moveBy(doc: GtScript, path: GtPath, dir: -1 | 1): EditResult | undefined {
  const place = placeOf(doc, path)
  if (!place) return undefined
  const len = (getAt(doc, place.slot) as unknown[]).length
  const to = place.index + dir
  if (to >= 0 && to < len) return move(doc, path, place.slot, dir > 0 ? to + 1 : to)
  if (!place.parent || place.inGuard) return undefined
  const pp = placeOf(doc, place.parent)
  if (!pp) return undefined
  return move(doc, path, pp.slot, dir > 0 ? pp.index + 1 : pp.index)
}

/** 块最后一个已经有内容的槽（放进块时接在它末尾）：if 有 else 就是 else，否则最后一个否则如果，再否则 then */
function lastSlot(block: GtStep): GtPath | undefined {
  const refs = slotsOf(block)
  for (let i = refs.length - 1; i >= 0; i--) if (Array.isArray(getAt(block, refs[i].key))) return refs[i].key
  return blockOf(block.action)?.wrapSlot ?? refs[0]?.key
}

/** 放进上面那个块（Tab）：上一个兄弟是块时接到它最后一个槽的末尾；否则做不了 */
export function indent(doc: GtScript, path: GtPath): EditResult | undefined {
  const place = placeOf(doc, path)
  if (!place || place.index === 0) return undefined
  const prevPath = [...place.slot, place.index - 1]
  const prev = getAt(doc, prevPath) as GtStep
  if (!isBlock(prev)) return undefined
  const key = lastSlot(prev)
  if (!key) return undefined
  const slot = [...prevPath, ...key]
  const len = Array.isArray(getAt(doc, slot)) ? (getAt(doc, slot) as unknown[]).length : 0
  return move(doc, path, slot, len)
}

/** 移出块（Shift+Tab）：放到父块的后面。在场景根或守护的 do 里时做不了 */
export function outdent(doc: GtScript, path: GtPath): EditResult | undefined {
  const place = placeOf(doc, path)
  if (!place?.parent || place.inGuard) return undefined
  const pp = placeOf(doc, place.parent)
  if (!pp) return undefined
  return move(doc, path, pp.slot, pp.index + 1)
}

/**
 * 把同一个槽里的几步包成一个块（Ctrl+G 包成段，右键「包进如果 / 循环」）。选中的步骤要在同一个槽里，
 * 中间隔开的也一起包进去（从第一个到最后一个）
 */
export function wrap(doc: GtScript, paths: GtPath[], action = 'group'): EditResult | undefined {
  const def = blockOf(action)
  if (!def?.wrapSlot || !paths.length) return undefined
  const places = paths.map((p) => placeOf(doc, p))
  if (places.some((p) => !p)) return undefined
  const slot = places[0]!.slot
  if (places.some((p) => !samePath(p!.slot, slot))) return undefined
  const first = Math.min(...places.map((p) => p!.index))
  const last = Math.max(...places.map((p) => p!.index))
  const out = clone(doc)
  const arr = getAt(out, slot) as GtStep[]
  const inner = arr.slice(first, last + 1)
  const block = def.make()
  ensureSlot(block as Record<string, unknown>, def.wrapSlot).push(...inner)
  arr.splice(first, last - first + 1, block)
  fillIds(out)
  return { doc: out, path: [...slot, first] }
}

/**
 * 展开块：把里面的步骤放回原处、去掉这一层（9.7「展开」）。if 只在其余分支都是空的时候能展开（不然会丢步骤）。
 * 子步骤的 id 不变，报告和历史还对得上
 */
export function unwrap(doc: GtScript, path: GtPath): EditResult | undefined {
  const place = placeOf(doc, path)
  const block = getAt(doc, path) as GtStep | undefined
  if (!place || !block || !isBlock(block)) return undefined
  const def = blockOf(block.action)!
  const main = def.wrapSlot ?? slotsOf(block)[0]?.key
  if (!main) return undefined
  const others = slotsOf(block).filter((r) => !samePath(r.key, main))
  if (others.some((r) => ((getAt(block, r.key) as unknown[] | undefined) ?? []).length)) return undefined
  const inner = (getAt(block, main) as GtStep[] | undefined) ?? []
  const out = clone(doc)
  ;(getAt(out, place.slot) as unknown[]).splice(place.index, 1, ...clone(inner))
  return { doc: out, path: [...place.slot, place.index] }
}

/** 复制一份放在下面（Ctrl+D）：里面所有步骤重新发 id */
export function duplicate(doc: GtScript, path: GtPath): EditResult | undefined {
  const place = placeOf(doc, path)
  if (!place) return undefined
  return insert(doc, place.slot, place.index + 1, [getAt(doc, path) as GtStep])
}

// ---------- 版本 ----------

/**
 * 存盘前整理：补 kind、补 id；没写 schemaVersion 的（新建的）写成当前版本。
 * 写了旧版本号的不改版本号：旧脚本不迁移，改个版本号会让旧写法冒充新格式
 */
export function tidyScript(doc: GtScript): GtScript {
  const out = clone(doc)
  out.kind = out.kind ?? 'gametest-scenario'
  if (typeof out.schemaVersion !== 'number') out.schemaVersion = SCHEMA_VERSION
  return fillIds(out)
}
