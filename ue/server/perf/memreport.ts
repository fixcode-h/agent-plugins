/**
 * memreport（Saved/Profiling/MemReports/…/*.memreport）的解析和查询。不依赖 node，纯文本处理。
 * 文件是一串控制台命令的输出拼起来的，每条命令的输出夹在 MemReport: Begin command "…" 和 End command "…" 之间。
 * 各命令的输出格式不一样、各引擎版本也有出入，所以不逐个命令写死：
 * - 表格统一用两种办法认：空白对齐的表（obj list）和逗号分隔的表（ListTextures 等）；
 * - 认不出表的段就按文字给，支持关键字筛和分页。
 */
export interface MemSection {
  /** 命令原文，例如 obj list -alphasort；文件开头命令之前的那段叫 (header) */
  command: string
  lines: string[]
}

export interface MemReport {
  sections: MemSection[]
}

export interface Table {
  columns: string[]
  rows: (string | number)[][]
  /** 表后面的合计行（原文） */
  total?: string
}

const BEGIN = /MemReport: Begin command "(.*)"/
const END = /MemReport: End command "(.*)"/

export function parseMemReport(text: string): MemReport {
  const sections: MemSection[] = [{ command: '(header)', lines: [] }]
  let cur = sections[0]
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const b = BEGIN.exec(raw)
    if (b) {
      cur = { command: b[1].trim(), lines: [] }
      sections.push(cur)
      continue
    }
    if (END.test(raw)) {
      // 两条命令之间的零散输出归到一个没名字的段，免得混进上一条命令的表里
      cur = { command: '', lines: [] }
      sections.push(cur)
      continue
    }
    cur.lines.push(raw)
  }
  const kept = sections.filter((s) => s.command === '(header)' || s.lines.some((l) => l.trim()))
  if (kept.length < 2 && !/MemReport|Memory|obj list/i.test(text.slice(0, 20000)))
    throw new Error('这不像 memreport 文件：里面没有 MemReport: Begin command 的分段')
  return { sections: kept.filter((s) => s.command !== '') }
}

const num = (s: string) => {
  const v = Number(s.replace(/,/g, ''))
  return Number.isFinite(v) && s.trim() !== '' ? v : undefined
}

/** 空白对齐的表：找到同时有 Class 和 Count 的表头行，之后列数相同、第二列起是数字的行都算数据 */
export function whitespaceTable(lines: string[]): Table | undefined {
  const h = lines.findIndex((l) => /\bClass\b/.test(l) && /\bCount\b/.test(l))
  if (h < 0) return undefined
  const columns = lines[h].trim().split(/\s+/)
  const rows: (string | number)[][] = []
  let total: string | undefined
  for (let i = h + 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/)
    if (parts.length !== columns.length) {
      if (/Objects \(Total/i.test(lines[i])) total = lines[i].trim()
      continue
    }
    const nums = parts.slice(1).map(num)
    if (nums.some((n) => n === undefined)) continue
    rows.push([parts[0], ...(nums as number[])])
  }
  return rows.length ? { columns, rows, total } : undefined
}

/** 逗号分隔的表：表头是第一行逗号数 ≥ 3 且后面至少有两行列数相同的；数字的单元格转成数字 */
export function commaTable(lines: string[]): Table | undefined {
  for (let h = 0; h < lines.length; h++) {
    const columns = lines[h].split(',').map((s) => s.trim())
    if (columns.length < 4 || columns.some((c) => num(c) !== undefined)) continue
    const rows: (string | number)[][] = []
    let total: string | undefined
    for (let i = h + 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((s) => s.trim())
      if (parts.length !== columns.length) {
        if (rows.length && /total/i.test(lines[i])) total = (total ? `${total}\n` : '') + lines[i].trim()
        continue
      }
      rows.push(parts.map((p) => num(p) ?? p))
    }
    if (rows.length >= 2) return { columns, rows, total }
  }
  return undefined
}

export const tableOf = (s: MemSection) => whitespaceTable(s.lines) ?? commaTable(s.lines)

/** 找段：按命令开头几个词匹配，不区分大小写（obj list、listtextures…） */
export function findSection(r: MemReport, name: string) {
  const n = name.trim().toLowerCase()
  return (
    r.sections.find((s) => s.command.toLowerCase() === n) ??
    r.sections.find((s) => s.command.toLowerCase().startsWith(n)) ??
    r.sections.find((s) => s.command.toLowerCase().includes(n))
  )
}

/** obj list 可能出现好几次（全量一次，按类再各一次）：取没有 class= 条件、行数最多的那张 */
export function objectTable(r: MemReport): Table | undefined {
  let best: Table | undefined
  for (const s of r.sections) {
    if (!/^obj list/i.test(s.command) || /class=/i.test(s.command)) continue
    const t = whitespaceTable(s.lines)
    if (t && (!best || t.rows.length > best.rows.length)) best = t
  }
  return best
}

function sortTable(t: Table, sort: string | undefined, top: number, filter?: string, offset = 0) {
  let col = sort ? t.columns.findIndex((c) => c.toLowerCase() === sort.toLowerCase()) : -1
  if (sort && col < 0) throw new Error(`没有「${sort}」这一列，有：${t.columns.join('、')}`)
  // 没指定时按大小从大到小：优先 ResExcKB（对象持有的贴图、网格数据，内存的大头），再是 NumKB，再是别的带大小的列
  for (const re of [/^ResExcKB$/i, /^NumKB$/i, /Size|KB/i]) if (col < 0) col = t.columns.findIndex((c) => re.test(c))
  if (col < 0) col = t.columns.findIndex((_, i) => typeof t.rows[0]?.[i] === 'number')
  const f = filter?.toLowerCase()
  let rows = f ? t.rows.filter((r) => r.some((v) => String(v).toLowerCase().includes(f))) : [...t.rows]
  if (col >= 0)
    rows = rows.sort((a, b) =>
      typeof a[col] === 'number' && typeof b[col] === 'number'
        ? (b[col] as number) - (a[col] as number)
        : String(a[col]).localeCompare(String(b[col])),
    )
  const page = rows.slice(offset, offset + top)
  return {
    columns: t.columns,
    sortedBy: col >= 0 ? t.columns[col] : undefined,
    total: rows.length,
    offset,
    rows: page,
    next: offset + page.length < rows.length ? offset + page.length : undefined,
    totalLine: t.total,
  }
}

export function memSummary(r: MemReport) {
  const header = r.sections.find((s) => s.command === '(header)')
  const objs = objectTable(r)
  return {
    // 文件开头是平台内存和启动信息，原样给前 40 行（各平台格式不同，不解析）
    header: (header?.lines ?? [])
      .filter((l) => l.trim())
      .slice(0, 40)
      .map((l) => l.trimEnd()),
    sections: r.sections
      .filter((s) => s.command !== '(header)')
      .map((s) => {
        const t = tableOf(s)
        return { command: s.command, lines: s.lines.length, table: t ? { rows: t.rows.length, columns: t.columns } : undefined }
      }),
    objects: objs ? { ...sortTable(objs, undefined, 15), note: '按占用从大到小的前 15 个类；全表用 what=objects' } : undefined,
  }
}

export interface MemQuery {
  what: string
  name?: string
  sort?: string
  top?: number
  offset?: number
  contains?: string
}

/** 常用段的别名：what 直接写这些词时去找对应命令的段 */
const ALIASES: Record<string, string[]> = {
  textures: ['listtextures'],
  meshes: ['liststaticmeshes', 'obj list class=staticmesh'],
  skeletalmeshes: ['listskeletalmeshes', 'obj list class=skeletalmesh'],
  sounds: ['listsounds', 'obj list class=soundwave'],
  rendertargets: ['r.dumprendertargetpoolmemory'],
  rhi: ['rhi.dumpresourcememory', 'rhi.dumpmemory'],
  llm: ['stat llm', 'llm'],
  particles: ['listparticlesystems'],
  levels: ['log logoutstatlevels', 'statlevels'],
}

export function memQuery(r: MemReport, q: MemQuery): unknown {
  const top = Math.min(Math.max(1, q.top ?? 40), 300)
  const offset = Math.max(0, q.offset ?? 0)
  if (q.what === 'objects') {
    const t = objectTable(r)
    if (!t) throw new Error('这份 memreport 里没有能认出来的 obj list 表（用 what=section 看原文）')
    return sortTable(t, q.sort, top, q.name ?? q.contains, offset)
  }
  let section: MemSection | undefined
  if (q.what === 'section') {
    if (!q.name) return { sections: r.sections.map((s) => ({ command: s.command, lines: s.lines.length })) }
    section = findSection(r, q.name)
    if (!section) throw new Error(`没有「${q.name}」这一段，有：${r.sections.map((s) => s.command).join('、')}`)
  } else if (ALIASES[q.what]) {
    for (const name of ALIASES[q.what]) {
      section = findSection(r, name)
      if (section) break
    }
    if (!section)
      throw new Error(
        `这份 memreport 里没有 ${q.what} 对应的段（找过：${ALIASES[q.what].join('、')}）。有的段：${r.sections.map((s) => s.command).join('、')}`,
      )
  } else
    throw new Error(
      `memreport 的 what 可以是 objects、section、${Object.keys(ALIASES).join('、')}，没有「${q.what}」`,
    )
  const t = tableOf(section)
  // 有表且没要求按文字筛时按表给；否则给原文（筛关键字、分页）
  if (t && q.what !== 'section') return { command: section.command, ...sortTable(t, q.sort, top, q.name ?? q.contains, offset) }
  const f = q.contains?.toLowerCase()
  const lines = section.lines.filter((l) => l.trim() && (!f || l.toLowerCase().includes(f)))
  const page = lines.slice(offset, offset + top).map((l) => (l.length > 400 ? `${l.slice(0, 400)}…` : l.trimEnd()))
  return {
    command: section.command,
    total: lines.length,
    offset,
    lines: page,
    next: offset + page.length < lines.length ? offset + page.length : undefined,
    table: t ? { columns: t.columns, rows: t.rows.length, hint: '这一段能按表看：用对应的 what（如 textures）并可加 sort' } : undefined,
  }
}

/** 两份 memreport 按类对比：数量和大小的增量，查「只涨不回」的类 */
export function memCompare(a: MemReport, b: MemReport, top = 30) {
  const ta = objectTable(a)
  const tb = objectTable(b)
  if (!ta || !tb) throw new Error('两份 memreport 都要有 obj list 表才能按类对比')
  const col = (t: Table, re: RegExp) => t.columns.findIndex((c) => re.test(c))
  const [ca, cb] = [col(ta, /^Count$/i), col(tb, /^Count$/i)]
  const [ka, kb] = [col(ta, /^NumKB$/i), col(tb, /^NumKB$/i)]
  const [ra, rb] = [col(ta, /^ResExcKB$/i), col(tb, /^ResExcKB$/i)]
  const get = (row: (string | number)[] | undefined, i: number) => (row && i >= 0 ? Number(row[i]) || 0 : 0)
  const ma = new Map(ta.rows.map((r) => [String(r[0]), r]))
  const mb = new Map(tb.rows.map((r) => [String(r[0]), r]))
  const rows = [...new Set([...ma.keys(), ...mb.keys()])].map((cls) => {
    const x = ma.get(cls)
    const y = mb.get(cls)
    return {
      class: cls,
      countA: get(x, ca),
      countB: get(y, cb),
      countDelta: get(y, cb) - get(x, ca),
      kbDelta: Math.round((get(y, kb) - get(x, ka)) * 100) / 100,
      resKbDelta: Math.round((get(y, rb) - get(x, ra)) * 100) / 100,
    }
  })
  const n = Math.min(top, 100)
  const sum = (k: 'countDelta' | 'kbDelta' | 'resKbDelta') => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100
  return {
    totals: { countDelta: sum('countDelta'), kbDelta: sum('kbDelta'), resKbDelta: sum('resKbDelta') },
    byCount: rows
      .filter((r) => r.countDelta !== 0)
      .sort((x, y) => y.countDelta - x.countDelta)
      .slice(0, n),
    bySize: rows
      .filter((r) => r.kbDelta + r.resKbDelta !== 0)
      .sort((x, y) => y.kbDelta + y.resKbDelta - (x.kbDelta + x.resKbDelta))
      .slice(0, n),
    shrunk: rows
      .filter((r) => r.countDelta < 0)
      .sort((x, y) => x.countDelta - y.countDelta)
      .slice(0, 10),
    note: 'A 是先抓的、B 是后抓的；kbDelta 是对象本身大小的变化，resKbDelta 是它们持有的资源（贴图、网格数据）大小的变化，单位 KB',
  }
}
