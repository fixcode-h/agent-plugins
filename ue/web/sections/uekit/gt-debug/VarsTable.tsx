import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { ValueTree } from '../value/ValueTree.tsx'

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
          <dt className="ue:flex ue:min-h-6 ue:min-w-0 ue:items-center ue:gap-1.5 ue:self-start ue:font-mono ue:text-footnote ue:text-muted">
            <span className="ue:truncate">{r.name}</span>
            {r.kind && <span className="ue:shrink-0 ue:font-sans ue:text-caption ue:text-subtle">{r.kind}</span>}
          </dt>
          {/* 值按值树画（和 GM 调函数的输出同一套）：对象、数组、结构体能点开看，对象还能展开成员；
              没在跑时显示的是默认值，整格调淡 */}
          <dd className={cn('ue:min-w-0', !r.live && 'ue:opacity-60')}>
            <ValueTree value={r.value} collapsed />
          </dd>
        </div>
      ))}
    </dl>
  )
}
