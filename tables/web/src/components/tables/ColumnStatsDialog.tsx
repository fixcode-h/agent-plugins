import { useMemo, useState } from 'react'
import { Check, Lightbulb } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableSchema } from '@shared/tables'
import type { ColInfo } from '@shared/table-struct'
import { columnStats, inferRules, STATS_MAX } from '@shared/table-stats'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

/**
 * 「统计这一列」：唯一值、空值、出现最多的 10 个值、最小最大；下面按数据给几条规则建议（范围、枚举、必填），
 * 点「设上」就写进列结构（项目的表格结构文件）。不用 AI，结果确定；超过 5 万行只看前面的，标「抽样」
 */
export function ColumnStatsDialog({
  rows,
  from,
  info,
  file,
  schema,
  onSchema,
  onClose,
}: {
  rows: string[][]
  from: number
  info: ColInfo
  file: string
  schema: TableSchema
  onSchema: (s: TableSchema) => void
  onClose: () => void
}) {
  const st = useMemo(
    () => columnStats(rows, from, info.col, info.list ? info.sep : undefined),
    [rows, from, info.col, info.list, info.sep],
  )
  const hints = useMemo(() => inferRules(st, info, file), [st, info, file])
  const [done, setDone] = useState<Set<string>>(new Set())
  const cell = 'tb:flex tb:flex-col tb:gap-0.5 tb:rounded-md tb:bg-sel/60 tb:px-3 tb:py-2'
  const num = (n: number) => n.toLocaleString()
  const most = st.top[0]?.[1] ?? 1
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('统计 {field}', { field: info.field })} closeOnOutside>
      <div className="tb:flex tb:flex-col tb:gap-4">
        <div className="tb:grid tb:grid-cols-2 tb:gap-2 tb:text-footnote tb:sm:grid-cols-4">
          <div className={cell}>
            <span className="tb:text-subtle">{t('行数')}</span>
            <span className="tb:text-body tb:text-fg tb:tabular-nums">
              {num(st.rows)}
              {st.sampled && (
                <Badge className="tb:ml-1.5 tb:h-4 tb:px-1.5" title={t('只看了前 {n} 行', { n: num(STATS_MAX) })}>
                  {t('抽样')}
                </Badge>
              )}
            </span>
          </div>
          <div className={cell}>
            <span className="tb:text-subtle">{t('空着')}</span>
            <span className="tb:text-body tb:text-fg tb:tabular-nums">{num(st.empty)}</span>
          </div>
          <div className={cell}>
            <span className="tb:text-subtle">{t('不同的值')}</span>
            <span className="tb:text-body tb:text-fg tb:tabular-nums">{num(st.unique)}</span>
          </div>
          <div className={cell}>
            <span className="tb:text-subtle">{t('最小 ~ 最大')}</span>
            <span className="tb:truncate tb:text-body tb:text-fg tb:tabular-nums">
              {st.min !== undefined ? `${st.min} ~ ${st.max}` : '—'}
            </span>
          </div>
        </div>
        {st.top.length > 0 && (
          <section className="tb:flex tb:flex-col tb:gap-1">
            <h3 className="tb:text-footnote tb:font-medium tb:text-subtle">{t('出现最多的值')}</h3>
            <ul aria-label={t('出现最多的值')} className="tb:flex tb:flex-col tb:gap-0.5">
              {st.top.map(([v, n]) => (
                <li
                  key={v}
                  className="tb:relative tb:flex tb:h-6 tb:items-center tb:gap-2 tb:overflow-hidden tb:rounded-sm tb:px-2 tb:text-footnote"
                >
                  <span
                    aria-hidden
                    className="tb:absolute tb:inset-y-0 tb:left-0 tb:bg-accent/10"
                    style={{ width: `${(n / most) * 100}%` }}
                  />
                  <span className="tb:relative tb:min-w-0 tb:flex-1 tb:truncate tb:font-mono tb:text-fg">{v}</span>
                  <span className="tb:relative tb:text-subtle tb:tabular-nums">{num(n)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="tb:flex tb:flex-col tb:gap-1.5">
          <h3 className="tb:flex tb:items-center tb:gap-1.5 tb:text-footnote tb:font-medium tb:text-subtle">
            <Lightbulb className="tb:h-3.5 tb:w-3.5" />
            {t('按数据推断的规则')}
          </h3>
          {hints.length ? (
            hints.map((h) => (
              <div
                key={h.id}
                className="tb:flex tb:items-center tb:gap-2 tb:rounded-md tb:border tb:px-3 tb:py-1.5 tb:text-footnote"
              >
                <span className="tb:min-w-0 tb:flex-1 tb:text-fg">{h.label}</span>
                {done.has(h.id) ? (
                  <span className="tb:flex tb:items-center tb:gap-1 tb:text-success">
                    <Check className="tb:h-3.5 tb:w-3.5" />
                    {t('已设上')}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="tb:h-6"
                    onClick={() => {
                      onSchema(h.apply(schema))
                      setDone((d) => new Set(d).add(h.id))
                    }}
                  >
                    {t('设上')}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="tb:text-footnote tb:text-subtle">{t('没有要补的规则（或者已经设过了）')}</p>
          )}
        </section>
      </div>
    </Modal>
  )
}
