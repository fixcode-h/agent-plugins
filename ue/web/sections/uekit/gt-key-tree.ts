import type { GtKeyRule } from './GtKeyRules.tsx'

/**
 * 条目规则面板的树：屏 → 容器 → 规则。规则可能上千条，所以树在这里一次算成「看得见的行」的扁平数组，
 * 面板只画滚到的那几十行（GtKeyRulesPanel）。
 * - 容器写成 `WBP_Bag:Root/ItemList` 的按冒号前的屏分组；只写了路径的归到「没写屏」；没写容器的归到「任何容器」。
 * - 搜索：条目类、容器、字段里任一包含关键字（不分大小写）；搜索时全部展开。
 */

export type TreeRow =
  | { kind: 'group'; id: string; depth: 0 | 1; label: string; count: number; open: boolean }
  | { kind: 'rule'; id: string; depth: 1 | 2; index: number; rule: GtKeyRule }

export const ANY = '\u0000any'
export const NO_SCREEN = '\u0000noscreen'

function screenOf(container: string | undefined) {
  if (!container) return ANY
  const at = container.indexOf(':')
  return at > 0 ? container.slice(0, at) : NO_SCREEN
}

export function matchRule(r: GtKeyRule, q: string) {
  if (!q) return true
  return (
    r.entry.toLowerCase().includes(q) ||
    (r.container ?? '').toLowerCase().includes(q) ||
    r.by.some((b) => b.toLowerCase().includes(q))
  )
}

/** collapsed：收起的分组 id（`s:屏`、`c:屏|容器`） */
export function buildRows(
  rules: GtKeyRule[],
  query: string,
  collapsed: Set<string>,
  labels: { any: string; noScreen: string },
) {
  const q = query.trim().toLowerCase()
  const screens = new Map<string, Map<string, number[]>>()
  rules.forEach((r, i) => {
    if (!matchRule(r, q)) return
    const s = screenOf(r.container)
    let containers = screens.get(s)
    if (!containers) screens.set(s, (containers = new Map()))
    const c = r.container ?? ''
    const list = containers.get(c)
    if (list) list.push(i)
    else containers.set(c, [i])
  })
  // 「任何容器」排最前，其余按屏名排
  const order = [...screens.keys()].sort((a, b) => (a === ANY ? -1 : b === ANY ? 1 : a.localeCompare(b)))
  const rows: TreeRow[] = []
  let total = 0
  for (const s of order) {
    const containers = screens.get(s)!
    const count = [...containers.values()].reduce((n, l) => n + l.length, 0)
    total += count
    const sid = `s:${s}`
    const sOpen = !!q || !collapsed.has(sid)
    rows.push({
      kind: 'group',
      id: sid,
      depth: 0,
      label: s === ANY ? labels.any : s === NO_SCREEN ? labels.noScreen : s,
      count,
      open: sOpen,
    })
    if (!sOpen) continue
    const byEntry = (a: number, b: number) => rules[a]!.entry.localeCompare(rules[b]!.entry)
    if (s === ANY) {
      for (const i of [...(containers.get('') ?? [])].sort(byEntry))
        rows.push({ kind: 'rule', id: `r:${i}`, depth: 1, index: i, rule: rules[i]! })
      continue
    }
    for (const c of [...containers.keys()].sort()) {
      const list = containers.get(c)!
      const cid = `c:${s}|${c}`
      const cOpen = !!q || !collapsed.has(cid)
      const at = c.indexOf(':')
      rows.push({
        kind: 'group',
        id: cid,
        depth: 1,
        label: at > 0 ? c.slice(at + 1) : c,
        count: list.length,
        open: cOpen,
      })
      if (!cOpen) continue
      for (const i of [...list].sort(byEntry))
        rows.push({ kind: 'rule', id: `r:${i}`, depth: 2, index: i, rule: rules[i]! })
    }
  }
  return { rows, total }
}
