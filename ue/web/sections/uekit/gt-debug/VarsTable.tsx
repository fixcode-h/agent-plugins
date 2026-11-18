import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'

/** 值的一行显示：字符串带引号，对象压成一行 JSON，太长截断（全文在悬停提示里） */
export const valueText = (v: unknown) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : v === undefined ? '' : JSON.stringify(v)
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}

/**
 * 报告里一步的 payload.vars（GameTest 1.11.2）：这一步用到、写到的变量在这一步结束时的值。
 * 没有或空时返回 undefined；`_truncated` 是截断标记不是变量，单独拿出来
 */
export function stepVars(payload?: Record<string, unknown>) {
  const v = payload?.vars
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const { _truncated, ...vars } = v as Record<string, unknown>
  if (!Object.keys(vars).length) return undefined
  return { vars, truncated: _truncated === true }
}

/** 一行写下这一步的变量：`$a = 1 · $b = "x"`，给报告列表用 */
export const varsLine = (vars: Record<string, unknown>) =>
  Object.entries(vars)
    .map(([k, v]) => `$${k} = ${valueText(v)}`)
    .join(' · ')

/**
 * 变量表（效果图 6 右下「此刻的变量」、「变量」页）：名字 | 值。
 * full 时把脚本声明的参数、变量都列出来，暂停时有此刻的值就显示此刻的，没有显示默认值（灰）
 */
export function VarsTable({ doc, vars, full }: { doc?: GtScript; vars?: Record<string, unknown>; full?: boolean }) {
  const { cn } = h()
  const rows: { name: string; value: unknown; live: boolean; kind?: string }[] = []
  const seen = new Set<string>()
  if (full && doc) {
    for (const [k, p] of Object.entries(doc.params ?? {})) {
      seen.add(k)
      rows.push({ name: k, kind: t('参数'), value: vars && k in vars ? vars[k] : p.default, live: !!vars && k in vars })
    }
    for (const [k, v] of Object.entries(doc.vars ?? {})) {
      if (seen.has(k)) continue
      seen.add(k)
      rows.push({ name: k, kind: t('变量'), value: vars && k in vars ? vars[k] : v, live: !!vars && k in vars })
    }
  }
  for (const [k, v] of Object.entries(vars ?? {})) if (!seen.has(k)) rows.push({ name: k, value: v, live: true })
  if (!rows.length)
    return (
      <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
        {full ? t('脚本没有声明参数和变量；暂停时这里显示此刻用到的变量') : t('暂停时显示')}
      </p>
    )
  return (
    <dl className="ue:grid ue:grid-cols-[minmax(80px,auto)_1fr] ue:gap-x-4 ue:gap-y-1 ue:px-4 ue:py-2">
      {rows.map((r) => (
        <div key={r.name} className="ue:contents">
          <dt className="ue:flex ue:min-w-0 ue:items-baseline ue:gap-1.5 ue:font-mono ue:text-footnote ue:text-muted">
            <span className="ue:truncate">{r.name}</span>
            {r.kind && <span className="ue:shrink-0 ue:font-sans ue:text-caption ue:text-subtle">{r.kind}</span>}
          </dt>
          <dd
            title={JSON.stringify(r.value)}
            className={cn(
              'ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote',
              r.live ? 'ue:text-fg' : 'ue:text-subtle',
            )}
          >
            {valueText(r.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
