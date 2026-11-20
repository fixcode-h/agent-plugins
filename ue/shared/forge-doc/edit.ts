import { pathKey, type PathSeg } from './locate.ts'
import { normalizeField } from './styles.ts'

/**
 * 按路径改配置原文里的一个值，其余文字一个字节不动（UMG 细节面板直接改配置用，用户 2026-11-20「修改直接改对应的 json 文件」）。
 * 配置是给人看和改的：允许 // 和 /* *\/ 注释、尾逗号，字段顺序和缩进都是人排的，所以不能 parse 再 stringify 整份写回，
 * 只把那一个值的原文换掉、插进一个新字段或删掉一个字段。
 * 字段名按导入的规则认（normalizeField：大小写不敏感、b 前缀可省），写回沿用原文的拼法。纯函数，网页和单测共用。
 */

interface Span {
  /** 值在原文里的起止（[start, end)） */
  start: number
  end: number
  /** 对象成员：键的引号开始的位置 */
  keyStart?: number
  /** 对象：成员的原文键 → 路径段（按出现顺序） */
  keys?: string[]
}

/** 扫一遍原文，记下每个路径的值所在（和 parseLocated 同一套语法，只多记位置）；读不懂抛 Error */
function scan(text: string) {
  const s = text
  const spans = new Map<string, Span>()
  let i = 0
  const fail = (what: string): never => {
    throw new Error(`${what}（第 ${s.slice(0, i).split('\n').length} 行）`)
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
    const a = i++
    while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1
    if (i >= s.length) fail('字符串没有闭合')
    i++
    return JSON.parse(s.slice(a, i)) as string
  }
  const value = (path: PathSeg[], keyStart?: number) => {
    ws()
    const start = i
    const c = s[i]
    const span: Span = { start, end: start, keyStart }
    spans.set(pathKey(path), span)
    if (c === '{') {
      i++
      span.keys = []
      for (;;) {
        ws()
        if (s[i] === '}') break
        if (s[i] !== '"') fail('这里应该是字段名')
        const ks = i
        const k = str()
        ws()
        if (s[i] !== ':') fail(`字段 ${k} 后面少了冒号`)
        i++
        span.keys.push(k)
        value([...path, k], ks)
        ws()
        if (s[i] === ',') i++
        else if (s[i] !== '}') fail('少了逗号或右花括号')
      }
      i++
    } else if (c === '[') {
      i++
      let n = 0
      for (;;) {
        ws()
        if (s[i] === ']') break
        value([...path, n++])
        ws()
        if (s[i] === ',') i++
        else if (s[i] !== ']') fail('少了逗号或右方括号')
      }
      i++
    } else if (c === '"') str()
    else {
      const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 40))
      if (!m) fail('读不懂这里的值')
      i += m![0].length
    }
    span.end = i
  }
  value([])
  return spans
}

/** 值写成原文：标量和数组照 JSON，对象写成一行 `{ "A": 1, "B": 2 }`（配置里结构体多是一行写完） */
export function inlineJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(', ')}]`
  if (v && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>)
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`).join(', ')} }` : '{}'
  }
  return JSON.stringify(v ?? null)
}

const lineStart = (s: string, at: number) => s.lastIndexOf('\n', at - 1) + 1
const indentAt = (s: string, at: number) => /^[ \t]*/.exec(s.slice(lineStart(s, at)))![0]

/** 原文里实际的路径：每一段对象键按 normalizeField 找原文的拼法（数组下标原样）；找不到的段原样留着 */
function resolvePath(spans: Map<string, Span>, path: readonly PathSeg[]) {
  const out: PathSeg[] = []
  let missingAt = -1
  for (let n = 0; n < path.length; n++) {
    const seg = path[n]
    const parent = spans.get(pathKey(out))
    if (typeof seg === 'string' && parent?.keys) {
      const hit = parent.keys.find((k) => normalizeField(k) === normalizeField(seg))
      if (hit !== undefined) {
        out.push(hit)
        continue
      }
    } else if (typeof seg === 'number' && spans.has(pathKey([...out, seg]))) {
      out.push(seg)
      continue
    }
    if (missingAt < 0) missingAt = n
    out.push(seg)
  }
  return { real: out, missingAt }
}

/** 往对象（span）里加一个成员：多行的对象另起一行、跟最后一个成员的缩进；一行写完的对象接在后面 */
function insertMember(s: string, obj: Span, key: string, val: unknown, spans: Map<string, Span>, path: PathSeg[]) {
  const member = `${JSON.stringify(key)}: ${inlineJson(val)}`
  const last = obj.keys?.length ? spans.get(pathKey([...path, obj.keys[obj.keys.length - 1]])) : undefined
  if (!last) {
    // 空对象 {} → { "k": v }
    return s.slice(0, obj.start) + `{ ${member} }` + s.slice(obj.end)
  }
  const multi = s.slice(obj.start, last.keyStart).includes('\n')
  const glue = multi ? `,\n${indentAt(s, last.keyStart!)}` : ', '
  return s.slice(0, last.end) + glue + member + s.slice(last.end)
}

/** 删掉对象成员（键到值，连同一个逗号）；成员独占的行整行去掉，不留空行 */
function removeMember(s: string, parent: Span, key: string, spans: Map<string, Span>, path: PathSeg[]) {
  const me = spans.get(pathKey([...path, key]))!
  const idx = parent.keys!.indexOf(key)
  const next = parent.keys![idx + 1]
  let a = me.keyStart!
  let b = me.end
  if (next !== undefined) {
    // 删到下一个成员的键前面（逗号和中间的空白、换行一起走）
    b = spans.get(pathKey([...path, next]))!.keyStart!
    if (s.slice(a, b).includes('\n')) a = lineStart(s, a)
    if (s.slice(a, b).includes('\n')) b = lineStart(s, b)
  } else if (idx > 0) {
    // 最后一个：从上一个成员的值后面删起（带走它后面的逗号），尾逗号原样留在后面
    a = spans.get(pathKey([...path, parent.keys![idx - 1]]))!.end
    const tail = /^\s*,/.exec(s.slice(b))
    if (tail && !s.slice(a, me.keyStart).includes(',')) b += tail[0].length
  } else {
    // 唯一一个：清成 {}
    return s.slice(0, parent.start) + '{}' + s.slice(parent.end)
  }
  return s.slice(0, a) + s.slice(b)
}

/**
 * 把 path 的值设成 value（undefined = 删掉这个字段）。中间缺的对象一层层补上；
 * deleteEmpty 给的那几层（比如节点的 props、slot）删到空了连自己一起删。路径中间不是对象（是字符串、数组）时抛错
 */
export function setJsonAt(
  text: string,
  path: readonly PathSeg[],
  value: unknown,
  opts: { pruneEmpty?: number } = {},
): string {
  const spans = scan(text)
  const { real, missingAt } = resolvePath(spans, path)
  if (value === undefined) {
    if (missingAt >= 0) return text
    let s = text
    let p = real
    // 删掉之后父对象空了：往上删到 pruneEmpty 那一层（含）为止
    for (;;) {
      const sp = scan(s)
      const parentPath = p.slice(0, -1)
      const parent = sp.get(pathKey(parentPath))
      if (!parent?.keys) throw new Error(`${parentPath.join('.')} 不是对象，删不了 ${String(p[p.length - 1])}`)
      s = removeMember(s, parent, String(p[p.length - 1]), sp, parentPath)
      const left = scan(s).get(pathKey(parentPath))
      if (opts.pruneEmpty === undefined || parentPath.length <= opts.pruneEmpty || left?.keys?.length) return s
      p = parentPath
    }
  }
  if (missingAt < 0) {
    const sp = spans.get(pathKey(real))!
    if (text.slice(sp.start, sp.end) === inlineJson(value)) return text
    return text.slice(0, sp.start) + inlineJson(value) + text.slice(sp.end)
  }
  // 从第一个缺的段起，把剩下的路径包成一个对象插进最后一个已有的对象
  const parentPath = real.slice(0, missingAt)
  const parent = spans.get(pathKey(parentPath))
  if (!parent?.keys)
    throw new Error(`${parentPath.join('.') || '配置'} 不是对象，没法在里面加 ${String(real[missingAt])}`)
  let v = value
  for (let n = real.length - 1; n > missingAt; n--) {
    if (typeof real[n] === 'number') throw new Error(`数组里没有第 ${String(real[n])} 项`)
    v = { [real[n]]: v }
  }
  if (typeof real[missingAt] === 'number') throw new Error(`数组里没有第 ${String(real[missingAt])} 项`)
  return insertMember(text, parent, String(real[missingAt]), v, spans, parentPath)
}

/** 原文里这个路径现在的值（按 normalizeField 认字段名）；没有回 undefined。给「改之前是不是字符串写法」这类判断用 */
export function valueAt(doc: unknown, path: readonly PathSeg[]): unknown {
  let cur: unknown = doc
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      cur = typeof seg === 'number' ? cur[seg] : undefined
      continue
    }
    const o = cur as Record<string, unknown>
    const k = Object.keys(o).find((x) => normalizeField(x) === normalizeField(String(seg)))
    cur = k === undefined ? undefined : o[k]
  }
  return cur
}
