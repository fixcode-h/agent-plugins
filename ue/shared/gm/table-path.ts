/**
 * GM 参数关联表格的路径（用户 2026-11-21）：gm.json 的 tableBindings[].table、Lua GM 设置的 bindings[].table 存相对路径，
 * 团队里每个人的检出位置不一样也能用。相对的根（base）：项目在版本管理里时是版本管理根（服务端 server/gm-custom/table-base.ts 找），
 * 不在时是 UE 项目根。表格不在这个根里时只能存绝对路径。
 *
 * 表格插件（table.list / table.query）认的写法是另一种：相对面板项目目录，或项目目录外的绝对路径（正斜杠）。
 * 网页调表格插件前用 toPlugin 换过去，从表格插件拿到路径后用toStored 换回来；界面只显示存的写法。
 * 这里只做字符串运算（网页也要用，不能 import node:path），Windows 盘符、反斜杠都认，Windows 路径比较不分大小写。
 */

const slash = (p: string) => p.replace(/\\/g, '/')

/** 绝对路径：/开头、盘符开头、UNC */
export const isAbs = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p) || /^[a-zA-Z]:$/.test(p)

/** 规整：正斜杠、去掉 . 段、处理 ..、去掉结尾斜杠 */
export function normPath(p: string) {
  const s = slash(p)
  const m = /^([a-zA-Z]:)?(\/*)/.exec(s)!
  const head = (m[1] ?? '') + (m[2] ? '/' : '')
  const out: string[] = []
  for (const seg of s.slice(m[0].length).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..' && out.length && out[out.length - 1] !== '..') out.pop()
    else if (seg !== '..' || !head) out.push(seg)
  }
  return head + out.join('/') || (head ? head : '.')
}

const winLike = (p: string) => /^[a-zA-Z]:/.test(p)
const same = (a: string, b: string, win: boolean) => (win ? a.toLowerCase() === b.toLowerCase() : a === b)

/** child 在 parent 里时返回相对路径（'' 表示同一个），不在返回 undefined */
export function relInside(parent: string, child: string): string | undefined {
  const p = normPath(parent)
  const c = normPath(child)
  const win = winLike(p) || winLike(c)
  if (same(p, c, win)) return ''
  const pre = p.endsWith('/') ? p : `${p}/`
  return same(c.slice(0, pre.length), pre, win) ? c.slice(pre.length) : undefined
}

export const joinPath = (base: string, rel: string) => normPath(`${slash(base).replace(/\/+$/, '')}/${rel}`)

/** 存的写法 → 绝对路径：相对的拼 base，绝对的原样（旧数据） */
export const storedToAbs = (stored: string, base: string) => (isAbs(stored) ? normPath(stored) : joinPath(base, stored))

/** 绝对路径 → 存的写法：在 base 里存相对的，不在存绝对的 */
export const absToStored = (abs: string, base: string) => relInside(base, abs) ?? normPath(abs)

/** 两个根：base 是存盘相对的根，panelDir 是表格插件相对的面板项目目录 */
export interface TableRoots {
  base: string
  panelDir: string
}

/** 表格插件给的路径 → 存的写法 */
export const pluginToStored = (p: string, r: TableRoots) => absToStored(isAbs(p) ? p : joinPath(r.panelDir, p), r.base)

/** 存的写法 → 表格插件认的路径（面板项目目录里的给相对的，外面的给绝对的） */
export function storedToPlugin(stored: string, r: TableRoots) {
  const abs = storedToAbs(stored, r.base)
  return relInside(r.panelDir, abs) ?? abs
}
