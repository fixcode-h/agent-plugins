/**
 * AssetForge 配置按段组织（设计稿 4.3）：一个资源一个 JSON，段 = 顶层字段，顺序固定：
 * 头（`//`、`$schema`、kind、asset… 以及没登记成段的小字段）→ styles → root → animations → kind 以后登记的大段。
 * 这里全按原文的字符位置做（不是重新序列化）：找每段的行号范围、只换某一段的文本（其他段一个字节不动）、
 * 按登记顺序重排顶层字段（字段原文连同上面的注释整块搬，内容不动）。
 * 面板网页（段导航、只编辑这一段）和服务端（ue_forge 的 section 读写）共用。
 */

/** 头段的 id：头不是一个字段，是所有没登记成段的顶层字段（和 UEKit ForgeSections::HeaderSection 同名，ue_forge section=header） */
export const HEAD = 'header'

/** 头里固定在前面的字段，按这个顺序；其余小字段跟在后面、保持原顺序（UEKit ForgeSections.cpp） */
const HEAD_FIXED = ['$schema', '//', 'kind', 'schemaVersion', 'revision', 'asset', 'parent']

/** 内置段表（头之后的顺序，和 UEKit ForgeKindSchema::GetBodySections 一致）；schema 里有 x-forge.sections 时用它的 */
const BUILTIN: Record<string, string[]> = {
  'umg-widget': ['styles', 'root', 'animations'],
  'state-tree': ['styles', 'root', 'parameters', 'evaluators', 'globalTasks', 'bindings'],
}
const DEFAULT_IDS = ['styles', 'root']

/**
 * 某种 kind 的段（不含头），按顺序。schema 是 forge.kinds kind=<kind> 回的 JSON Schema，
 * 认 `x-forge.sections`（UEKit：`[{name, description}]`）或顶层 `sections`；字符串数组也认；头（header）不算。
 * 没有 schema 时按 kind 查内置表
 */
export function sectionIds(schema?: unknown, kind?: unknown): string[] {
  const BUILT = (typeof kind === 'string' && BUILTIN[kind]) || DEFAULT_IDS
  const s = schema && typeof schema === 'object' ? (schema as Record<string, unknown>) : {}
  const xf = s['x-forge'] && typeof s['x-forge'] === 'object' ? (s['x-forge'] as Record<string, unknown>) : {}
  const list = Array.isArray(s.sections) ? s.sections : Array.isArray(xf.sections) ? xf.sections : undefined
  if (!list) return BUILT
  const ids = list
    .map((x) =>
      typeof x === 'string'
        ? x
        : x && typeof x === 'object'
          ? ((x as { name?: unknown; id?: unknown }).name ?? (x as { id?: unknown }).id)
          : '',
    )
    .filter((x): x is string => typeof x === 'string' && !!x && !['head', 'header', HEAD].includes(x))
  return ids.length ? ids : BUILT
}

/** 顶层某个字符串字段的值（读不懂回 undefined） */
function topString(text: string, key: string): string | undefined {
  try {
    const top = topMembers(text)
    const m = top.members.find((x) => x.key === key)
    const v = m ? (JSON.parse(text.slice(m.valueStart, m.valueEnd)) as unknown) : undefined
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

/** 从配置原文里取 kind：段表要按 kind 选 */
export const kindOf = (text: string) => topString(text, 'kind')

/**
 * 一份文件的段表：资源配置按 kind（有 schema 用 schema 的）；片段文件（顶层 fragment、没有 kind）只有头和
 * 和 fragment 同名的那一段（节点片段是 node）
 */
export function sectionIdsOf(text: string, schema?: unknown): string[] {
  const kind = kindOf(text)
  if (kind) return sectionIds(schema, kind)
  const frag = topString(text, 'fragment')
  return frag ? [frag] : sectionIds(schema)
}

/** 顶层字段属于哪段 */
export const sectionOf = (key: string, ids: readonly string[]) => (ids.includes(key) ? key : HEAD)

export interface Member {
  key: string
  /** 这个字段上面紧挨着的注释行从这里开始（没有注释就是 keyStart） */
  leadStart: number
  keyStart: number
  valueStart: number
  valueEnd: number
  /** 后面有逗号时逗号之后的位置，否则 = valueEnd */
  commaEnd: number
  hasComma: boolean
  /** 同一行行尾的 // 注释算这个字段的：到这里为止（不含换行） */
  trailEnd: number
}

export interface TopLevel {
  open: number
  close: number
  members: Member[]
}

/** 扫顶层对象的每个字段在原文的位置；不是对象或结构坏了抛 Error（调用方先用 parseLocated 校验过更好） */
export function topMembers(text: string): TopLevel {
  const s = text
  let i = 0
  const fail = (what: string): never => {
    throw new Error(`第 ${lineAt(s, i)} 行：${what}`)
  }
  const ws = () => {
    for (;;) {
      const c = s[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿') i++
      else if (c === '/' && s[i + 1] === '/') while (i < s.length && s[i] !== '\n') i++
      else if (c === '/' && s[i + 1] === '*') {
        const e = s.indexOf('*/', i + 2)
        i = e < 0 ? s.length : e + 2
      } else return
    }
  }
  const str = () => {
    i++
    while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1
    if (i >= s.length) fail('字符串没有闭合')
    i++
  }
  const value = () => {
    ws()
    const c = s[i]
    if (c === '"') return str()
    if (c === '{' || c === '[') {
      let depth = 0
      while (i < s.length) {
        const d = s[i]
        if (d === '"') {
          str()
          continue
        }
        if (d === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) {
          ws()
          continue
        }
        if (d === '{' || d === '[') depth++
        else if (d === '}' || d === ']') {
          depth--
          if (depth === 0) {
            i++
            return
          }
        }
        i++
      }
      fail('括号没有闭合')
    }
    const m = /^[^\s,}\]/]+/.exec(s.slice(i, i + 64))
    if (!m) fail('读不懂这里的值')
    i += m![0].length
  }
  ws()
  if (s[i] !== '{') fail('配置顶层应该是一个 { } 对象')
  const open = i
  i++
  const members: Member[] = []
  let prevEnd = i
  for (;;) {
    ws()
    if (s[i] === '}') break
    if (s[i] !== '"') fail('这里应该是用双引号括起来的字段名')
    const keyStart = i
    str()
    const key = JSON.parse(s.slice(keyStart, i)) as string
    ws()
    if (s[i] !== ':') fail(`字段 ${key} 后面少了冒号`)
    i++
    ws()
    const valueStart = i
    value()
    const valueEnd = i
    let j = i
    while (s[j] === ' ' || s[j] === '\t') j++
    const hasComma = s[j] === ','
    const commaEnd = hasComma ? j + 1 : valueEnd
    let k = commaEnd
    while (s[k] === ' ' || s[k] === '\t') k++
    let trailEnd = commaEnd
    if (s[k] === '/' && s[k + 1] === '/') {
      while (k < s.length && s[k] !== '\n') k++
      trailEnd = k
    }
    members.push({
      key,
      leadStart: leadOf(s, prevEnd, keyStart),
      keyStart,
      valueStart,
      valueEnd,
      commaEnd,
      hasComma,
      trailEnd,
    })
    i = trailEnd
    prevEnd = trailEnd
    if (!hasComma) {
      ws()
      if (s[i] !== '}') fail('少了逗号或右花括号')
      break
    }
  }
  return { open, close: i, members }
}

/** gap（上一个字段结束到这个字段名之间）里第一行有内容的行的行首：注释跟着字段走 */
function leadOf(s: string, gapStart: number, keyStart: number) {
  const nl = s.indexOf('\n', gapStart)
  if (nl < 0 || nl >= keyStart) return keyStart
  let p = nl + 1
  while (p < keyStart) {
    const e = s.indexOf('\n', p)
    const end = e < 0 || e > keyStart ? keyStart : e
    if (s.slice(p, end).trim()) return p
    p = end + 1
  }
  return keyStart
}

/** 第几行（从 1 数） */
export function lineAt(text: string, offset: number) {
  let n = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

export interface SectionInfo {
  id: string
  /** 这段包含的顶层字段（头段可能有好几个） */
  fields: string[]
  startLine: number
  endLine: number
  /** 段原文（字段名开始到值结束）的字符范围；头段的字段不挨着时 contiguous = false */
  start: number
  end: number
  contiguous: boolean
  /** 整段是 `{ "include": "…" }`：片段文件路径（原文写的，相对这份配置） */
  include?: string
}

/** 原文里有哪些段，按原文出现的先后 */
export function findSections(text: string, ids: readonly string[]): SectionInfo[] {
  const top = topMembers(text)
  const nl: number[] = []
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) nl.push(i)
  const line = (off: number) => {
    let lo = 0
    let hi = nl.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nl[mid] < off) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
  const out: SectionInfo[] = []
  const byId = new Map<string, { info: SectionInfo; idx: number[] }>()
  top.members.forEach((m, idx) => {
    const id = sectionOf(m.key, ids)
    let g = byId.get(id)
    if (!g) {
      g = {
        info: {
          id,
          fields: [],
          startLine: line(m.leadStart),
          endLine: 0,
          start: m.keyStart,
          end: m.valueEnd,
          contiguous: true,
        },
        idx: [],
      }
      byId.set(id, g)
      out.push(g.info)
    }
    g.info.fields.push(m.key)
    g.info.end = m.valueEnd
    g.info.endLine = line(Math.max(m.valueEnd - 1, m.keyStart))
    g.info.startLine = Math.min(g.info.startLine, line(m.leadStart))
    if (g.idx.length && g.idx[g.idx.length - 1] !== idx - 1) g.info.contiguous = false
    g.idx.push(idx)
    if (id !== HEAD) {
      const inc = includeOf(text.slice(m.valueStart, m.valueEnd))
      if (inc) g.info.include = inc
    }
  })
  return out
}

/** 值原文是不是 `{ "include": "…" }`（可以带 "//" 说明）：是就回路径 */
export function includeOf(valueText: string): string | undefined {
  if (!/^\s*\{/.test(valueText) || !valueText.includes('"include"')) return undefined
  try {
    const t = topMembers(valueText)
    const keys = t.members.map((m) => m.key).filter((k) => k !== '//')
    if (keys.length !== 1 || keys[0] !== 'include') return undefined
    const m = t.members.find((x) => x.key === 'include')!
    const v = JSON.parse(valueText.slice(m.valueStart, m.valueEnd)) as unknown
    return typeof v === 'string' && v ? v : undefined
  } catch {
    return undefined
  }
}

/** 某一段的原文（`"animations": [ … ]`，带字段名，头段是几个字段连着）；没有这段回 undefined，头段字段不挨着时抛错 */
export function sectionText(text: string, id: string, ids: readonly string[]) {
  const s = findSections(text, ids).find((x) => x.id === id)
  if (!s) return undefined
  if (!s.contiguous) throw new Error('头段的字段被别的段隔开了：先整理顶层字段顺序（保存一次整份配置）再单独改')
  return text.slice(s.start, s.end)
}

/** 校验交上来的一段原文：拼成 { } 能读、字段都属于这一段；返回字段名 */
export function checkSectionText(id: string, part: string, ids: readonly string[]) {
  let keys: string[]
  try {
    keys = topMembers(`{\n${part}\n}`).members.map((m) => m.key)
  } catch (e) {
    throw new Error(
      `这一段读不懂（写成 "${id === HEAD ? 'kind' : id}": … 这样带字段名的片段）：${(e as Error).message}`,
    )
  }
  if (!keys.length) throw new Error('这一段是空的')
  const wrong = keys.filter((k) => sectionOf(k, ids) !== id)
  if (wrong.length) throw new Error(`这一段里不能有字段 ${wrong.join('、')}：只写 ${id === HEAD ? '头部字段' : id}`)
  if (id !== HEAD && keys.length > 1) throw new Error(`${id} 写了 ${keys.length} 次`)
  return keys
}

/**
 * 只换某一段：段原文换成 part，其他字节不动。原来没有这段时按段的顺序插到合适的位置（缩进照第一个字段）。
 * part 先过 checkSectionText
 */
export function replaceSection(text: string, id: string, part: string, ids: readonly string[]) {
  checkSectionText(id, part, ids)
  const body = part.trim()
  const s = findSections(text, ids).find((x) => x.id === id)
  if (s) {
    if (!s.contiguous) throw new Error('头段的字段被别的段隔开了：先整理顶层字段顺序（保存一次整份配置）再单独改')
    return text.slice(0, s.start) + body + text.slice(s.end)
  }
  const top = topMembers(text)
  const rank = (k: string) => (sectionOf(k, ids) === HEAD ? -1 : ids.indexOf(sectionOf(k, ids)))
  const me = id === HEAD ? -1 : ids.indexOf(id)
  const first = top.members[0]
  const indent = first ? /[ \t]*$/.exec(text.slice(0, first.keyStart))![0] : '  '
  let prev: Member | undefined
  for (const m of top.members) if (rank(m.key) <= me) prev = m
  if (prev) {
    if (prev.hasComma) return text.slice(0, prev.trailEnd) + `\n${indent}${body},` + text.slice(prev.trailEnd)
    return text.slice(0, prev.valueEnd) + `,\n${indent}${body}` + text.slice(prev.valueEnd)
  }
  const at = top.open + 1
  return text.slice(0, at) + `\n${indent}${body}${top.members.length ? ',' : '\n'}` + text.slice(at)
}

/**
 * 按段的顺序重排顶层字段：头（$schema、//、kind、schemaVersion、revision、asset、parent，其余小字段保持原顺序）→ 登记的段。每个字段连同上面的注释、行尾注释整块搬，内容不动；
 * 顺序本来就对时原样返回（同一个字符串）
 */
export function orderSections(text: string, ids: readonly string[]) {
  const top = topMembers(text)
  const ms = top.members
  // 头里固定字段排前面：-100 + 在 HEAD_FIXED 里的位置；其余头字段 -1；段按段表
  const rank = (k: string) => {
    if (sectionOf(k, ids) !== HEAD) return ids.indexOf(k)
    const f = HEAD_FIXED.indexOf(k)
    return f >= 0 ? -100 + f : -1
  }
  const order = ms.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m.key) - rank(b.m.key) || a.i - b.i)
  if (order.every((x, i) => x.i === i)) return text
  // 每块 = 前面的空白和注释（gap）+ 字段原文 + 行尾注释；逗号重新按新顺序放
  const gapStart = (i: number) => (i === 0 ? top.open + 1 : ms[i - 1].trailEnd)
  const blocks = ms.map((m, i) => ({
    gap: text.slice(gapStart(i), m.keyStart),
    body: text.slice(m.keyStart, m.valueEnd),
    trail: text.slice(m.commaEnd, m.trailEnd),
  }))
  const last = ms[ms.length - 1]
  let out = text.slice(0, top.open + 1)
  order.forEach(({ i }, n) => {
    const b = blocks[i]
    out += b.gap + b.body + (n < order.length - 1 ? ',' : '') + b.trail
  })
  return out + text.slice(last.trailEnd)
}
