/**
 * 快速执行栏（GM 页梳理 F6）的纯逻辑：一行「名字 参数 参数」拆开、参数个数对齐、按输入排补全。
 * 写在 shared 里方便单测；条目长什么样由网页给（name + kind）
 */

/** 按空白拆，引号里的算一个（"a b"、'a b'），引号本身去掉 */
export function tokenize(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** 第一段是名字，后面是参数 */
export function splitQuick(line: string): { name: string; args: string[] } {
  const [name = '', ...args] = tokenize(line.trim())
  return { name, args }
}

/** 参数比 GM 的参数多时，多出来的并进最后一个（最后一个参数常是一句话）；没有参数的 GM 不收参数 */
export function fitArgs(args: string[], n: number): string[] {
  if (!n) return []
  if (args.length <= n) return args
  return [...args.slice(0, n - 1), args.slice(n - 1).join(' ')]
}

export interface QuickItem {
  name: string
  kind: string
}

/** 补全排序：名字以输入开头的在前（越短越前），再是包含的；不分大小写；空输入不给 */
export function rankQuick<T extends QuickItem>(items: T[], q: string, limit = 8): T[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const score = (n: string) => {
    const l = n.toLowerCase()
    if (l === s) return 0
    if (l.startsWith(s)) return 1
    if (l.includes(s)) return 2
    return -1
  }
  return items
    .map((it) => ({ it, sc: score(it.name) }))
    .filter((x) => x.sc >= 0)
    .sort((a, b) => a.sc - b.sc || a.it.name.length - b.it.name.length || a.it.name.localeCompare(b.it.name))
    .slice(0, limit)
    .map((x) => x.it)
}
