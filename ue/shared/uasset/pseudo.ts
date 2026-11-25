/**
 * 图表的伪代码：从没有执行输入的节点（事件、函数入口）出发，顺着执行线往下写，一个节点一行，
 * 数据输入写成「引脚=值」，连了线的写成「引脚=<上游节点>」，多个执行输出（Branch、Sequence）分块缩进。
 * 编辑器里的伪代码（桥接 GraphPseudo）是另一套写法，两条路的结果不比较（版本差异两边总是同一条路读的）。
 */
import { isExec, pinDefault, type GGraph, type GNode } from './graph.ts'

const MAX_LINES = 4000

export function graphPseudo(g: GGraph): string {
  const lines: string[] = []
  const seen = new Set<GNode>()
  const execIn = (n: GNode) => g.links.some((l) => l.to === n && isExec(l.toPin))
  const hasExecPin = (n: GNode) => n.pins.some(isExec)
  const starts = g.nodes.filter(
    (n) => hasExecPin(n) && !execIn(n) && n.pins.some((p) => isExec(p) && p.direction === 1),
  )
  starts.sort((x, y) => x.y - y.y || x.x - y.x)

  // 数据线经过 Reroute（Knot）时顺着往上找真正的来源，别写成 <Reroute.OutputPin>
  const upstream = (n: GNode, p: GNode['pins'][number]) => {
    let src = g.links.find((l) => l.to === n && l.toPin === p)
    for (let guard = 0; src && src.from.class === 'K2Node_Knot' && guard < 64; guard++) {
      const knot = src.from
      src = g.links.find((l) => l.to === knot && !isExec(l.toPin)) ?? src
      if (src.from === knot) break
    }
    return src
  }

  const args = (n: GNode) => {
    const out: string[] = []
    for (const p of n.pins) {
      if (p.direction !== 0 || isExec(p) || p.hidden || p.name === 'self') continue
      const src = upstream(n, p)
      if (src)
        out.push(`${p.name}=<${src.from.title}${src.fromPin.name === 'ReturnValue' ? '' : `.${src.fromPin.name}`}>`)
      else {
        const v = pinDefault(p)
        if (v !== '') out.push(`${p.name}=${JSON.stringify(v)}`)
      }
    }
    return out.join(', ')
  }

  const walk = (n: GNode, depth: number) => {
    if (lines.length >= MAX_LINES) return
    const pad = '  '.repeat(depth)
    if (seen.has(n)) {
      lines.push(`${pad}→ ${n.title}`)
      return
    }
    seen.add(n)
    if (n.class !== 'K2Node_Knot') lines.push(`${pad}${n.title}(${args(n)})`)
    const outs = n.pins.filter((p) => isExec(p) && p.direction === 1)
    const next = (p: (typeof outs)[number]) => g.links.filter((l) => l.from === n && l.fromPin === p).map((l) => l.to)
    if (outs.length === 1) {
      for (const m of next(outs[0])) walk(m, depth)
      return
    }
    for (const p of outs) {
      const ms = next(p)
      if (!ms.length) continue
      lines.push(`${pad}  [${p.name}]`)
      for (const m of ms) walk(m, depth + 2)
    }
  }

  for (const s of starts) {
    if (lines.length) lines.push('')
    lines.push(`${s.title}:`)
    seen.add(s)
    const outs = s.pins.filter((p) => isExec(p) && p.direction === 1)
    for (const p of outs) for (const l of g.links.filter((x) => x.from === s && x.fromPin === p)) walk(l.to, 1)
  }
  return lines.join('\n')
}
