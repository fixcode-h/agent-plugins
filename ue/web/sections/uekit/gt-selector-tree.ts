/**
 * GameTest 选择器拆成一层层的节点，给步骤详情按树显示（一长串 `屏:A/B/#类#0>C/D>>SButton` 不好读）。
 * 只做显示：方括号里的 `/`、`>` 不当分隔符；拆不动的（句柄 `@x`）原样一个节点
 */
export interface SelectorNode {
  /** 这一段原文 */
  text: string
  depth: number
  /** screen：屏名；hop：`>` 进到嵌套的 WBP 里；slate：`>>` 之后的纯 Slate 段；path：普通路径段 */
  kind: 'screen' | 'hop' | 'slate' | 'path'
  /** 按位置写的段（`#类名#序号`、`列表[序号]`）的序号，容器顺序变了会指到别的控件 */
  index?: number
}

/** 按分隔符切，方括号里的不切 */
function splitTop(s: string, sep: string) {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '[') depth++
    else if (c === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

const indexOf = (seg: string) => {
  const m = /^#[^#]+#(\d+)$/.exec(seg) ?? /\[(\d+)\]$/.exec(seg)
  return m ? Number(m[1]) : undefined
}

export function selectorTree(target: string): SelectorNode[] {
  const s = target.trim()
  if (!s || s.startsWith('@')) return [{ text: s, depth: 0, kind: 'path' }]
  const nodes: SelectorNode[] = []
  let depth = 0
  const [umg, ...slateParts] = splitTop(s, '>>')
  const slate = slateParts.join('>>')
  if (umg) {
    // 屏名只认第一个 `[`、`>` 之前的冒号（和 GameTest 的解析一致）
    const stop = Math.min(...['[', '>', 'text='].map((x) => (umg.includes(x) ? umg.indexOf(x) : umg.length)))
    const colon = umg.indexOf(':')
    let rest = umg
    if (colon >= 0 && colon < stop) {
      nodes.push({ text: umg.slice(0, colon) || '*', depth: depth++, kind: 'screen' })
      rest = umg.slice(colon + 1)
    }
    splitTop(rest, '>').forEach((hop, h) => {
      splitTop(hop, '/')
        .filter((seg) => seg !== '')
        .forEach((seg, k) =>
          nodes.push({ text: seg, depth: depth++, kind: h > 0 && k === 0 ? 'hop' : 'path', index: indexOf(seg) }),
        )
    })
  }
  if (slate)
    splitTop(slate, '/')
      .filter(Boolean)
      .forEach((seg) => nodes.push({ text: seg, depth: depth++, kind: 'slate' }))
  return nodes
}
