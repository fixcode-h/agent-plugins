/**
 * GameTest 脚本里的 `call` 引用（协议 UEKit docs/game-test-script.md 第 2 节：`script` 相对场景根、`.json` 可省）。
 * 场景库移动 / 改名 / 删除脚本或文件夹时，要找出哪些脚本在 `call` 被动到的脚本，并把路径跟着改（设计稿 12.1）。
 * 纯函数、不碰磁盘：读写文件在 gt-library.ts，这里单测不用起文件系统。
 *
 * `call` 可以出现在任何一层：主流程、`setup`、块的 `do` / `then` / `else`、守护的 `do`、`_settings.json` 的全局守护……
 * 所以不按字段名找，整份 JSON 递归走一遍，凡是 `action: "call"` 且 `script` 是字符串的对象都算。
 */

/** 一处 call：所在文件里的 JSON 路径（给人看，例如 steps.3.do.0）和写的 script 原文 */
export interface CallRef {
  at: string
  script: string
}

/** 路径映射：from → to，都是相对场景根、用 / 分隔；dir 为 true 时是文件夹（下面的全部脚本跟着走） */
export interface PathMove {
  from: string
  to: string
  dir: boolean
}

const slash = (p: string) => p.replace(/\\/g, '/')

/** 比较用的写法：/ 分隔、去掉开头的 ./ 和 /、去掉 .json、忽略大小写（项目在 Windows 上，文件名不分大小写） */
export function callKey(script: string) {
  return slash(script.trim())
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\.json$/i, '')
    .toLowerCase()
}

/** 场景文件的相对路径（带 .json）落成比较用的写法 */
export const fileKey = (rel: string) => callKey(rel)

/** 整份 JSON 里的全部 call */
export function findCalls(doc: unknown): CallRef[] {
  const out: CallRef[] = []
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, at ? `${at}.${i}` : String(i)))
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (o.action === 'call' && typeof o.script === 'string') out.push({ at: at || '.', script: o.script })
      for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object') walk(x, at ? `${at}.${k}` : k)
    }
  }
  walk(doc, '')
  return out
}

/** 一处 call 是不是指着这个路径（文件夹时指着它下面的任何脚本） */
export function callHits(script: string, target: string, dir: boolean) {
  const k = callKey(script)
  const t = callKey(target)
  return dir ? k.startsWith(`${t}/`) : k === t
}

/**
 * 按映射算一处 call 的新写法；不受影响时返回 undefined。
 * 保留原来的写法习惯：原来写了 .json 的新路径也带，原来没写的也不带
 */
export function remapCall(script: string, moves: PathMove[]): string | undefined {
  const k = callKey(script)
  const withExt = /\.json\s*$/i.test(script)
  for (const m of moves) {
    const from = callKey(m.from)
    const to = slash(m.to).replace(/\.json$/i, '')
    let next: string | undefined
    if (m.dir) {
      if (k.startsWith(`${from}/`)) {
        // 文件夹下面的部分照原文保留（大小写跟着原来写的）
        const rest = slash(script.trim())
          .replace(/^(\.\/)+/, '')
          .replace(/^\/+/, '')
          .slice(from.length + 1)
          .replace(/\.json$/i, '')
        next = to ? `${to}/${rest}` : rest
      }
    } else if (k === from) next = to
    if (next !== undefined) return withExt ? `${next}.json` : next
  }
  return undefined
}

/**
 * 按映射改一份 JSON 里的全部 call（原地改），返回改了的几处（旧 → 新）。
 * 没有受影响的 call 时返回空数组，调用方据此决定要不要写回文件
 */
export function rewriteCalls(doc: unknown, moves: PathMove[]) {
  const changed: { at: string; from: string; to: string }[] = []
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, at ? `${at}.${i}` : String(i)))
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (o.action === 'call' && typeof o.script === 'string') {
        const next = remapCall(o.script, moves)
        if (next !== undefined && next !== o.script) {
          changed.push({ at: at || '.', from: o.script, to: next })
          o.script = next
        }
      }
      for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object') walk(x, at ? `${at}.${k}` : k)
    }
  }
  walk(doc, '')
  return changed
}

/** 场景相对路径按映射换成新的（history.json 的键、页面上选中的场景）；不受影响原样返回 */
export function remapPath(rel: string, moves: PathMove[]) {
  const s = slash(rel)
  const low = s.toLowerCase()
  for (const m of moves) {
    const from = slash(m.from)
    const f = from.toLowerCase()
    if (m.dir ? low.startsWith(`${f}/`) : low === f)
      return m.dir ? `${slash(m.to)}${s.slice(from.length)}` : slash(m.to)
  }
  return rel
}
