/**
 * 解析带注释的 AssetForge 配置，同时记下每个值在原文的第几行（标记视图「点标签跳到原文」用）。
 * JSON.parse 不给位置，配置又允许 // 和 /* *\/ 注释，所以自己扫一遍：只多记行号，值和 JSON.parse 的一样。
 * 路径用 pathKey(['root','children',0,'props','Text']) 的形式当键；对象成员记的是键所在的行（人眼找的就是那一行）。
 */
export type PathSeg = string | number

export const pathKey = (segs: readonly PathSeg[]) => segs.join('\u0001')

export interface Located {
  value: unknown
  /** pathKey → 行（从 1 数） */
  lines: Map<string, number>
}

/** 解析失败抛 Error，message 带「第 N 行」（和 UEKit 报解析错的说法一致，ForgeConfig 认这个标红） */
export function parseLocated(text: string): Located {
  const s = text.replace(/^﻿/, '')
  const lines = new Map<string, number>()
  let i = 0
  let line = 1
  const fail = (what: string): never => {
    throw new Error(`第 ${line} 行：${what}`)
  }
  const ws = () => {
    for (;;) {
      const c = s[i]
      if (c === '\n') {
        line++
        i++
      } else if (c === ' ' || c === '\t' || c === '\r') i++
      else if (c === '/' && s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i++
      } else if (c === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2)
        const stop = end < 0 ? s.length : end + 2
        for (let j = i; j < stop; j++) if (s[j] === '\n') line++
        i = stop
      } else return
    }
  }
  const str = (): string => {
    const start = i
    i++
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\n') fail('字符串没有闭合')
      i += s[i] === '\\' ? 2 : 1
    }
    if (i >= s.length) fail('字符串没有闭合')
    i++
    return JSON.parse(s.slice(start, i)) as string
  }
  const value = (path: PathSeg[]): unknown => {
    ws()
    const c = s[i]
    if (!lines.has(pathKey(path))) lines.set(pathKey(path), line)
    if (c === '{') {
      i++
      const out: Record<string, unknown> = {}
      ws()
      if (s[i] === '}') {
        i++
        return out
      }
      for (;;) {
        ws()
        if (s[i] !== '"') fail('这里应该是用双引号括起来的字段名')
        const at = line
        const k = str()
        ws()
        if (s[i] !== ':') fail(`字段 ${k} 后面少了冒号`)
        i++
        const p = [...path, k]
        lines.set(pathKey(p), at)
        out[k] = value(p)
        ws()
        if (s[i] === ',') {
          i++
          ws()
          // 容忍尾逗号：UEKit 的读取层也认
          if (s[i] === '}') {
            i++
            return out
          }
        } else if (s[i] === '}') {
          i++
          return out
        } else fail('少了逗号或右花括号')
      }
    }
    if (c === '[') {
      i++
      const out: unknown[] = []
      ws()
      if (s[i] === ']') {
        i++
        return out
      }
      for (;;) {
        out.push(value([...path, out.length]))
        ws()
        if (s[i] === ',') {
          i++
          ws()
          if (s[i] === ']') {
            i++
            return out
          }
        } else if (s[i] === ']') {
          i++
          return out
        } else fail('少了逗号或右方括号')
      }
    }
    if (c === '"') return str()
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 40))
    if (!m) return fail('读不懂这里的值')
    i += m[0].length
    return JSON.parse(m[0]) as unknown
  }
  const v = value([])
  ws()
  if (i < s.length) fail('配置结尾后面还有多余的内容')
  return { value: v, lines }
}

/** 找一个路径在原文的行：路径本身没记（比如数组里套样式后的值）时退到最近的上一级 */
export function lineOf(lines: Map<string, number>, segs: readonly PathSeg[]): number | undefined {
  for (let n = segs.length; n >= 0; n--) {
    const hit = lines.get(pathKey(segs.slice(0, n)))
    if (hit !== undefined) return hit
  }
  return undefined
}
