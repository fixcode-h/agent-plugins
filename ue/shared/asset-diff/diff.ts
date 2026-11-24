import { animDiffs, widgetDiffs } from './umg.ts'
import type {
  AssetDiff,
  AssetSnap,
  Change,
  DiffStats,
  GraphDiff,
  LeafDiff,
  LineRow,
  NodeMod,
  ObjDiff,
  PropDiff,
  SnapComponent,
  SnapGraph,
  SnapNode,
  SnapObject,
  SnapProp,
  SnapVar,
  VarDiff,
} from './types.ts'

/**
 * 两版资源快照逐项比：属性按名字（值里再按成员、下标、键往下比），组件按变量名，内嵌子对象按相对路径，
 * 变量按名字，节点按 GUID，数据表的行按行名；伪代码按行比（LCS）。纯函数，服务端算好交给网页。
 * a 是旧版、b 是新版；某一版里没有这个文件时传 null（整份算新加或删掉）。
 */

const LEAF_MAX = 50
/** 伪代码超过这么多行就不做 LCS（O(n·m)），只掐掉相同的头尾、中间整段算删加 */
const LCS_MAX = 4000
/** 改动前后各留几行上下文，再远的折成一条「⋯」 */
const CONTEXT = 3

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 值里改了的几处：结构体 / 映射按键、数组按下标；不是容器或类型变了就整个值算一处 */
export function leafDiffs(a: unknown, b: unknown, path = '', out: LeafDiff[] = []): LeafDiff[] {
  if (same(a, b)) return out
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`
      if (i >= a.length) out.push({ path: p, change: 'add', b: b[i] })
      else if (i >= b.length) out.push({ path: p, change: 'del', a: a[i] })
      else leafDiffs(a[i], b[i], p, out)
    }
    return out
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k
      if (!(k in a)) out.push({ path: p, change: 'add', b: b[k] })
      else if (!(k in b)) out.push({ path: p, change: 'del', a: a[k] })
      else leafDiffs(a[k], b[k], p, out)
    }
    return out
  }
  out.push({ path, change: 'mod', a, b })
  return out
}

function propDiff(name: string, pa: SnapProp | undefined, pb: SnapProp | undefined): PropDiff {
  const meta = pb ?? pa!
  const base = { name, label: meta.displayName ?? '', category: meta.category ?? '' }
  if (!pa) return { ...base, change: 'add', b: pb!.value }
  if (!pb) return { ...base, change: 'del', a: pa.value }
  if (same(pa.value, pb.value)) return { ...base, change: 'same', a: pa.value, b: pb.value }
  const d: PropDiff = { ...base, change: 'mod', a: pa.value, b: pb.value }
  // 容器和结构体才往下拆：标量本身就是一处
  if (typeof pa.value === 'object' && pa.value && typeof pb.value === 'object' && pb.value) {
    const leaves = leafDiffs(pa.value, pb.value)
    d.leaves = leaves.slice(0, LEAF_MAX)
    if (leaves.length > LEAF_MAX) d.more = leaves.length - LEAF_MAX
  }
  return d
}

/** 一个对象的属性差异；保留没变的项（网页的「全部」要看），按原来的顺序 */
export function objDiff(key: string, a: SnapObject | undefined, b: SnapObject | undefined): ObjDiff {
  const pa = new Map((a?.props ?? []).map((p) => [p.name, p]))
  const pb = new Map((b?.props ?? []).map((p) => [p.name, p]))
  const names = [...new Set([...(b?.props ?? []).map((p) => p.name), ...(a?.props ?? []).map((p) => p.name)])]
  // 新加 / 删掉的整个对象：属性全都算加 / 删，但不计进属性改动数（对象本身已经算一处）
  const props = names.map((n) => propDiff(n, pa.get(n), pb.get(n)))
  const change: Change = !a ? 'add' : !b ? 'del' : props.some((p) => p.change !== 'same') ? 'mod' : 'same'
  return {
    key,
    class: (b ?? a)!.class,
    change,
    props,
    count: change === 'mod' ? props.filter((p) => p.change !== 'same').length : 0,
  }
}

function byKey<T>(list: T[] | undefined, key: (x: T) => string) {
  const m = new Map<string, T>()
  for (const x of list ?? []) m.set(key(x), x)
  return m
}

/** 两张表按键配对：先按新版的顺序，再补上只在旧版里的 */
function pairs<T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string) {
  const ma = byKey(a, key)
  const mb = byKey(b, key)
  const keys = [...new Set([...mb.keys(), ...ma.keys()])]
  return keys.map((k) => [k, ma.get(k), mb.get(k)] as const)
}

function compDiffs(a: SnapComponent[] | undefined, b: SnapComponent[] | undefined): ObjDiff[] {
  // 同名的组件在 native / scs / inherited 里不会重；配对键带上来源，免得父蓝图改过的模板和自己加的撞名
  return pairs(a, b, (c) => `${c.source}:${c.name}`).map(([, ca, cb]) => {
    const d = objDiff((cb ?? ca)!.name, ca, cb)
    d.parent = (cb ?? ca)!.parent
    d.source = (cb ?? ca)!.source
    return d
  })
}

function varDiffs(a: SnapVar[] | undefined, b: SnapVar[] | undefined): VarDiff[] {
  return pairs(a, b, (v) => v.name).map(([name, va, vb]) => ({
    name,
    a: va,
    b: vb,
    change: !va ? 'add' : !vb ? 'del' : same(va, vb) ? 'same' : 'mod',
  }))
}

// ---------- 伪代码逐行比 ----------

type Op = { kind: 'add' | 'del' | 'ctx'; text: string; na?: number; nb?: number }

/** 行级 LCS：太长时掐头去尾后中间整段算删加 */
export function lineOps(a: string[], b: string[]): Op[] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const ma = a.slice(s, a.length - e)
  const mb = b.slice(s, b.length - e)
  const ops: Op[] = []
  for (let i = 0; i < s; i++) ops.push({ kind: 'ctx', text: a[i], na: i + 1, nb: i + 1 })
  if (ma.length * mb.length > (LCS_MAX * LCS_MAX) / 4 || ma.length > LCS_MAX || mb.length > LCS_MAX) {
    ma.forEach((text, i) => ops.push({ kind: 'del', text, na: s + i + 1 }))
    mb.forEach((text, i) => ops.push({ kind: 'add', text, nb: s + i + 1 }))
  } else {
    const n = ma.length
    const m = mb.length
    // dp[i][j] = ma[i..] 和 mb[j..] 的最长公共子序列长度
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = ma[i] === mb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        ops.push({ kind: 'ctx', text: ma[i], na: s + i + 1, nb: s + j + 1 })
        i++
        j++
      } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
        // 同样长时先删后加：和常见 diff 一样，旧行在上新行在下
        ops.push({ kind: 'del', text: ma[i], na: s + i + 1 })
        i++
      } else {
        ops.push({ kind: 'add', text: mb[j], nb: s + j + 1 })
        j++
      }
    }
  }
  for (let k = 0; k < e; k++)
    ops.push({ kind: 'ctx', text: a[a.length - e + k], na: a.length - e + k + 1, nb: b.length - e + k + 1 })
  return ops
}

/** 只留改动附近的上下文，远处的折成一条段头（text 写「第 n 行」由网页翻译，这里放行号） */
export function lineRows(a: string, b: string): LineRow[] {
  const split = (s: string) => (s ? s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') : [])
  const ops = lineOps(split(a), split(b))
  const keep = ops.map(() => false)
  ops.forEach((o, i) => {
    if (o.kind === 'ctx') return
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) keep[k] = true
  })
  const rows: LineRow[] = []
  let gap = false
  ops.forEach((o, i) => {
    if (!keep[i]) {
      gap = true
      return
    }
    if (gap || (rows.length === 0 && i > 0)) rows.push({ kind: 'hunk', text: '', n: o.nb ?? o.na })
    gap = false
    rows.push({ kind: o.kind, text: o.text, n: o.kind === 'del' ? o.na : o.nb })
  })
  return rows
}

// ---------- 图 ----------

function nodeMod(a: SnapNode, b: SnapNode): NodeMod | null {
  const pins: NodeMod['pins'] = []
  for (const p of new Set([...Object.keys(b.pins ?? {}), ...Object.keys(a.pins ?? {})]))
    if ((a.pins ?? {})[p] !== (b.pins ?? {})[p]) pins.push({ pin: p, a: a.pins?.[p], b: b.pins?.[p] })
  const la = new Set(a.links ?? [])
  const lb = new Set(b.links ?? [])
  const linksAdd = [...lb].filter((l) => !la.has(l))
  const linksDel = [...la].filter((l) => !lb.has(l))
  const comment = (a.comment ?? '') !== (b.comment ?? '')
  if (!pins.length && !linksAdd.length && !linksDel.length && !comment && a.title === b.title) return null
  return {
    id: b.id,
    title: b.title,
    pins,
    linksAdd,
    linksDel,
    ...(comment ? { commentA: a.comment ?? '', commentB: b.comment ?? '' } : {}),
  }
}

function graphDiff(name: string, a: SnapGraph | undefined, b: SnapGraph | undefined): GraphDiff {
  const na = byKey(a?.nodes, (n) => n.guid)
  const nb = byKey(b?.nodes, (n) => n.guid)
  const added = [...nb.values()].filter((n) => !na.has(n.guid))
  const removed = [...na.values()].filter((n) => !nb.has(n.guid))
  const modified: NodeMod[] = []
  for (const [g, x] of nb) {
    const y = na.get(g)
    const m = y && nodeMod(y, x)
    if (m) modified.push(m)
  }
  const lines = lineRows(a?.pseudo ?? '', b?.pseudo ?? '')
  const changed =
    added.length || removed.length || modified.length || lines.some((l) => l.kind === 'add' || l.kind === 'del')
  return {
    name,
    kind: (b ?? a)!.kind,
    change: !a ? 'add' : !b ? 'del' : changed ? 'mod' : 'same',
    added,
    removed,
    modified,
    lines,
  }
}

// ---------- 数据表的行 ----------

/** GetTableAsJSON 的原文 → 行对象（键 Name 是行名）；读不出来时返回 null */
export function parseRows(text: string | undefined): SnapObject[] | null {
  if (!text) return null
  try {
    const rows = JSON.parse(text) as Record<string, unknown>[]
    if (!Array.isArray(rows)) return null
    return rows.map((r) => ({
      name: String(r.Name ?? r.name ?? ''),
      class: 'Row',
      props: Object.entries(r)
        .filter(([k]) => k !== 'Name' && k !== 'name')
        .map(([name, value]) => ({ name, value })),
    }))
  } catch {
    return null
  }
}

// ---------- 整份 ----------


export function assetDiff(a: AssetSnap | null, b: AssetSnap | null): AssetDiff {
  const top = (b ?? a)!
  const bp = !!(b?.blueprint ?? a?.blueprint)
  const defaults = objDiff(
    'defaults',
    a ? { name: 'defaults', class: a.class, props: a.props } : undefined,
    b ? { name: 'defaults', class: b.class, props: b.props } : undefined,
  )
  const components = compDiffs(a?.blueprint?.components, b?.blueprint?.components)
  const subobjects = pairs(a?.subobjects, b?.subobjects, (s) => s.name).map(([k, sa, sb]) => objDiff(k, sa, sb))
  const ra = parseRows(a?.rows)
  const rb = parseRows(b?.rows)
  const rows = ra || rb ? pairs(ra ?? [], rb ?? [], (r) => r.name).map(([k, x, y]) => objDiff(k, x, y)) : []
  const variables = varDiffs(a?.blueprint?.variables, b?.blueprint?.variables)
  const settings: AssetDiff['settings'] = []
  if (a && b && a.class !== b.class) settings.push({ label: 'class', a: a.class, b: b.class })
  if (a?.blueprint && b?.blueprint) {
    if (a.blueprint.parent !== b.blueprint.parent)
      settings.push({ label: 'parent', a: a.blueprint.parent, b: b.blueprint.parent })
    const ia = a.blueprint.interfaces.join('\n')
    const ib = b.blueprint.interfaces.join('\n')
    if (ia !== ib) settings.push({ label: 'interfaces', a: ia, b: ib })
  }
  if (a && b && (a.rowStruct ?? '') !== (b.rowStruct ?? ''))
    settings.push({ label: 'rowStruct', a: a.rowStruct ?? '', b: b.rowStruct ?? '' })
  const graphs = pairs(a?.blueprint?.graphs, b?.blueprint?.graphs, (g) => g.name).map(([k, ga, gb]) =>
    graphDiff(k, ga, gb),
  )
  const changedGraphs = graphs.filter((g) => g.change !== 'same')
  const widgets = widgetDiffs(a?.blueprint?.widgets, b?.blueprint?.widgets, objDiff)
  const anims = animDiffs(a?.blueprint?.anims, b?.blueprint?.anims)
  const stats: DiffStats = {
    props:
      defaults.count +
      components.reduce((n, c) => n + c.count, 0) +
      subobjects.reduce((n, c) => n + (c.change === 'same' ? 0 : Math.max(1, c.count)), 0),
    compAdd: components.filter((c) => c.change === 'add').length,
    compDel: components.filter((c) => c.change === 'del').length,
    compMod: components.filter((c) => c.change === 'mod').length,
    vars: variables.filter((v) => v.change !== 'same').length,
    graphs: changedGraphs.length,
    nodesAdd: changedGraphs.reduce((n, g) => n + g.added.length, 0),
    nodesDel: changedGraphs.reduce((n, g) => n + g.removed.length, 0),
    nodesMod: changedGraphs.reduce((n, g) => n + g.modified.length, 0),
    rows: rows.filter((r) => r.change !== 'same').length,
    settings: settings.length,
    widgetAdd: widgets.filter((w) => w.change === 'add').length,
    widgetDel: widgets.filter((w) => w.change === 'del').length,
    widgetMod: widgets.filter((w) => w.change === 'mod').length,
    anims: anims.filter((x) => x.change !== 'same').length,
  }
  const notes = [a?.note, b?.note].filter((x): x is string => !!x)
  return {
    class: top.class,
    blueprint: bp,
    ...(a ? {} : { created: true }),
    ...(b ? {} : { deleted: true }),
    defaults,
    components,
    subobjects,
    rows,
    variables,
    settings,
    graphs,
    widgets,
    anims,
    stats,
    notes: [...new Set(notes)],
  }
}

/** 有没有任何变化（左栏小标签、「两版结构一样」的说明用） */
export function diffEmpty(d: AssetDiff) {
  const s = d.stats
  return !d.created && !d.deleted && !Object.values(s).some((n) => n > 0)
}
