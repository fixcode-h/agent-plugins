import type { AssetDiff, ObjDiff } from './types.ts'

/**
 * 「让 Agent 解释这次改动」（设计稿「UE资源版本差异-修复与强化」3.4）：把差异写成一份 Markdown 交给 Agent。
 * 差异可能很大（几百个节点），按 ADR 0067 长内容写文件只给路径；这里也给每段设上限，免得一份报告几 MB
 */
const MAX_ITEMS = 200
const val = (v: unknown) => {
  if (v === undefined) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 300 ? `${s.slice(0, 300)}…` : s
}

function objLines(o: ObjDiff, title: string): string[] {
  const props = o.props.filter((p) => p.change !== 'same')
  if (o.change === 'same' && !props.length) return []
  const head = `### ${title}${o.change === 'add' ? '（新加）' : o.change === 'del' ? '（删掉）' : ''}`
  const rows = props.slice(0, MAX_ITEMS).map((p) => {
    const leaves = (p.leaves ?? []).map((l) => `  - \`${l.path}\`: ${val(l.a)} → ${val(l.b)}`)
    return [`- \`${p.name}\`（${p.category || '—'}）: ${val(p.a)} → ${val(p.b)}`, ...leaves].join('\n')
  })
  if (props.length > MAX_ITEMS) rows.push(`- …还有 ${props.length - MAX_ITEMS} 项`)
  return [head, ...rows, '']
}

export function diffReport(pkg: string, a: string, b: string, d: AssetDiff): string {
  const out = [`# ${pkg} 的改动：${a} → ${b}`, '', `类：${d.class}${d.created ? '（新建）' : d.deleted ? '（删掉）' : ''}`, '']
  if (d.notes.length) out.push('说明：', ...d.notes.map((n) => `- ${n}`), '')
  if (d.settings.length) out.push('## 蓝图设置', ...d.settings.map((s) => `- ${s.label}: ${s.a} → ${s.b}`), '')
  const objs = [
    ...objLines(d.defaults, d.blueprint ? '类默认值' : '资源属性'),
    ...d.components.flatMap((o) => objLines(o, `组件 ${o.key}`)),
    ...d.subobjects.flatMap((o) => objLines(o, `子对象 ${o.key}`)),
    ...d.widgets.flatMap((o) => objLines(o, `控件 ${o.key}`)),
    ...d.rows.flatMap((o) => objLines(o, `行 ${o.key}`)),
  ]
  if (objs.length) out.push('## 属性', ...objs)
  const vars = d.variables.filter((v) => v.change !== 'same')
  if (vars.length)
    out.push(
      '## 变量',
      ...vars.map((v) => `- ${v.change} \`${v.name}\`: ${v.a ? `${v.a.type}` : '—'} → ${v.b ? `${v.b.type}` : '—'}`),
      '',
    )
  const graphs = d.graphs.filter((g) => g.change !== 'same')
  for (const g of graphs) {
    out.push(`## 图 ${g.name}（${g.kind}）${g.change === 'add' ? '新加' : g.change === 'del' ? '删掉' : ''}`)
    out.push(
      `节点：加 ${g.added.length}、删 ${g.removed.length}、改 ${g.modified.length}`,
      '',
      '伪代码差异：',
      '```diff',
      ...g.lines
        .filter((l) => l.kind !== 'hunk')
        .slice(0, MAX_ITEMS * 2)
        .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} ${l.text}`),
      '```',
      '',
    )
  }
  const anims = d.anims.filter((x) => x.change !== 'same')
  if (anims.length) {
    out.push('## 动画')
    for (const x of anims) {
      out.push(`- ${x.name}（${x.change}）`)
      for (const ch of x.channels.filter((c) => c.change !== 'same').slice(0, 50))
        out.push(`  - ${ch.key}: ${ch.a ?? '—'} → ${ch.b ?? '—'}`)
    }
    out.push('')
  }
  return out.join('\n')
}
