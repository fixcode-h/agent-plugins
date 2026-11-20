import { condsOf } from '../blocks/index.ts'
import { walkChecks } from '../cond.ts'
import { getAt } from '../path.ts'
import type { GtPath, GtScript, GtStep } from '../types.ts'
import { walk, walkGuards } from '../walk.ts'
import { inObj, refForm } from './ref.ts'

/**
 * 场景里所有写引用的地方（协议第 1、2、4、5 节）：步骤的 target / toTarget、loop 的 each、obj.* 的 obj、
 * 条件里对象判断的 obj（含 skipIf、守护 when），以及内联引用里的 in.obj / near、顶层 objects。
 * 校验、「这个对象在哪些步骤用了」、改名都按这一份；加了新的放引用的字段，在 STEP_FIELDS 里加一行。
 */
export type RefRole = 'object' | 'target' | 'obj' | 'each' | 'check' | 'in' | 'near'

export interface RefSite {
  /** 引用这个值在场景里的位置（改名时按它写回） */
  path: GtPath
  ref: unknown
  role: RefRole
  /** 在哪一步（步骤路径）；守护 when 里的是守护路径；objects 里的没有 */
  owner?: GtPath
  /** target 写法时：部件 / Slate 段（显示用） */
  part?: string
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 步骤上放引用的字段：target 写法（{obj, part} 或直接一个引用）还是引用本身 */
export const STEP_FIELDS: { key: string; role: 'target' | 'obj' | 'each'; when?: (s: GtStep) => boolean }[] = [
  { key: 'target', role: 'target' },
  { key: 'toTarget', role: 'target' },
  { key: 'each', role: 'each', when: (s) => s.action === 'loop' },
  { key: 'obj', role: 'obj', when: (s) => typeof s.action === 'string' && s.action.startsWith('obj.') },
]

/** 一个引用值里面嵌着的：内联的 in.obj、near */
function inner(ref: unknown, path: GtPath, owner: GtPath | undefined, out: RefSite[]) {
  if (refForm(ref) !== 'inline') return
  const r = ref as Obj
  const i = inObj(r.in)
  if (i) push(i.obj, [...path, 'in', 'obj'], 'in', owner, out)
  if (r.near !== undefined && !Array.isArray(r.near) && refForm(r.near))
    push(r.near, [...path, 'near'], 'near', owner, out)
}

function push(ref: unknown, path: GtPath, role: RefRole, owner: GtPath | undefined, out: RefSite[], part?: string) {
  out.push({ path, ref, role, ...(owner ? { owner } : {}), ...(part ? { part } : {}) })
  inner(ref, path, owner, out)
}

/** target 写法：`{obj, part?, slate?}` 记 obj；直接写的引用记它自己 */
function pushTarget(v: unknown, path: GtPath, role: RefRole, owner: GtPath, out: RefSite[]) {
  if (isObj(v) && 'obj' in v) {
    const part = [v.part, v.slate].filter((x) => typeof x === 'string' && x).join(' / ')
    push(v.obj, [...path, 'obj'], role, owner, out, part || undefined)
  } else if (v !== undefined) push(v, path, role, owner, out)
}

/** 一棵条件里的对象判断 */
function condSites(cond: unknown, base: GtPath, owner: GtPath, out: RefSite[]) {
  walkChecks(cond, (c, p) => {
    if ('obj' in c) push(c.obj, [...base, ...p, 'obj'], 'check', owner, out)
  })
}

export function refSites(doc: GtScript): RefSite[] {
  const out: RefSite[] = []
  if (isObj(doc.objects))
    for (const [name, ref] of Object.entries(doc.objects)) push(ref, ['objects', name], 'object', undefined, out)
  walk(doc, (e) => {
    const s = e.step
    for (const f of STEP_FIELDS)
      if (f.key in s && (!f.when || f.when(s))) pushTarget(s[f.key], [...e.path, f.key], f.role, e.path, out)
    for (const c of condsOf(s)) condSites(getAt(s, c.key), [...e.path, ...c.key], e.path, out)
    // obj.wait 自己就是一条对象判断（obj 已经按 STEP_FIELDS 记过）
  })
  walkGuards(doc, (g) => condSites(g.guard.when, [...g.path, 'when'], g.path, out))
  return out
}

/** 某个命名引用在哪些地方用了（objects 里它自己的定义不算） */
export const usesOf = (doc: GtScript, name: string) =>
  refSites(doc).filter((x) => x.role !== 'object' && x.ref === name)

/** 没被任何步骤、条件用到的命名引用（校验给警告，编辑器可以提示删掉） */
export function unusedObjects(doc: GtScript): string[] {
  if (!isObj(doc.objects)) return []
  const used = new Set(
    refSites(doc)
      .filter((x) => x.role !== 'object')
      .map((x) => x.ref),
  )
  return Object.keys(doc.objects).filter((n) => !used.has(n))
}

const setAt = (root: unknown, p: GtPath, v: unknown) => {
  const parent = getAt(root, p.slice(0, -1)) as Record<string | number, unknown> | undefined
  if (parent) parent[p[p.length - 1]] = v
}

/** 命名引用改名：objects 的键和所有用到它的地方一起改（返回新场景，不改传入的；新名字已被占用时返回 undefined） */
export function renameObject(doc: GtScript, from: string, to: string): GtScript | undefined {
  if (!isObj(doc.objects) || !(from in doc.objects) || !to || to.startsWith('$')) return undefined
  if (from === to) return doc
  if (to in doc.objects) return undefined
  const out = structuredClone(doc)
  for (const site of refSites(out)) if (site.role !== 'object' && site.ref === from) setAt(out, site.path, to)
  out.objects = Object.fromEntries(Object.entries(out.objects as Obj).map(([k, v]) => [k === from ? to : k, v]))
  return out
}
