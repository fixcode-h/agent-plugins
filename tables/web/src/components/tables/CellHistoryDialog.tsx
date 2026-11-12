import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { CellAt } from '@shared/table-blame'
import { tablesApi, type CellHistory } from '@/lib/tables-api'
import { Modal } from '@/components/ui/modal'

/** 一格的值：空格子和「那时还没有这一行」分开写 */
function Val({ v, tone }: { v: string | null; tone: 'old' | 'new' }) {
  if (v === null) return <span className="tb:text-subtle tb:italic">{t('还没有')}</span>
  if (v === '') return <span className="tb:text-subtle tb:italic">{t('空')}</span>
  return (
    <span className={tone === 'old' ? 'tb:text-danger tb:line-through' : 'tb:text-success'} title={v}>
      {v}
    </span>
  )
}

/**
 * 一格的历史：哪几次提交改过这一格、从什么改成什么。按主键找同一行、按字段名找同一列，
 * 插删过行、挪过列也对得上；版本在服务端逐个取出来比，页面只拿结果
 */
export function CellHistoryDialog({
  projectId,
  path,
  at,
  title,
  onClose,
}: {
  projectId: string
  path: string
  at: CellAt
  title: string
  onClose: () => void
}) {
  const [res, setRes] = useState<CellHistory | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    tablesApi
      .cellHistory(projectId, path, at)
      .then((r) => live && setRes(r))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
    // 弹窗打开时取一次；at 每次渲染是新对象，按内容比没必要
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path])
  const err = error || res?.error || (res?.vcs === 'none' ? t('这个文件不在版本管理里，没有历史') : '')
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} size="lg">
      {err ? (
        <p className="tb:text-body tb:text-danger">{err}</p>
      ) : !res ? (
        <div className="tb:flex tb:items-center tb:justify-center tb:gap-2 tb:p-6 tb:text-footnote tb:text-subtle">
          <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />
          {t('正在逐个版本找这一格……')}
        </div>
      ) : (
        <div className="tb:flex tb:flex-col tb:gap-2">
          <p className="tb:text-caption tb:text-subtle">
            {at.keyField
              ? t('按 {key} = {v} 找同一行，看了最近 {n} 个版本', { key: at.keyField, v: at.key ?? '', n: res.scanned })
              : t('没有主键，按行号找同一行（插删过行会对不上），看了最近 {n} 个版本', { n: res.scanned })}
          </p>
          {!res.changes.length ? (
            <p className="tb:py-6 tb:text-center tb:text-body tb:text-subtle">{t('这几个版本里这一格没改过')}</p>
          ) : (
            <div role="list" aria-label={t('改过这一格的提交')} className="tb:flex tb:flex-col tb:gap-px">
              {res.changes.map((c) => (
                <div
                  role="listitem"
                  key={c.rev.id}
                  className="tb:flex tb:flex-col tb:gap-0.5 tb:rounded-(--c-row-radius) tb:px-2.5 tb:py-1.5 tb:hover:bg-hover"
                >
                  <div className="tb:flex tb:items-center tb:gap-2 tb:text-caption tb:text-subtle">
                    <span className="tb:font-mono">{c.rev.label}</span>
                    <span>{c.rev.author}</span>
                    <span>{c.rev.time ? new Date(c.rev.time).toLocaleString() : ''}</span>
                    <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-muted" title={c.rev.message}>
                      {c.rev.message}
                    </span>
                  </div>
                  <div className="tb:flex tb:items-center tb:gap-2 tb:font-mono tb:text-footnote">
                    <span className="tb:max-w-[45%] tb:min-w-0 tb:truncate">
                      <Val v={c.from} tone="old" />
                    </span>
                    <span className="tb:text-subtle">→</span>
                    <span className="tb:max-w-[45%] tb:min-w-0 tb:truncate">
                      <Val v={c.to} tone="new" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
