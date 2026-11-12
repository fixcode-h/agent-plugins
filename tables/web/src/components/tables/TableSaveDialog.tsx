import { useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { t } from '@shared/i18n'
import { applyRowOps, cellRef, type SheetEdit } from '@shared/table-edit'
import type { SheetData } from '@shared/files'
import type { TableDoc } from '@shared/tables'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** 列表里最多列这么多处改动 */
const SHOW = 200

/**
 * 保存确认：列出每张表改了哪些格子（旧值 → 新值）、插删了几行，说明保存只改这些格子的值、格式不变。
 * 保存失败（文件正被打开、外面改过、表里有公式不能插删行……）把原因显示在这里，不悄悄重试；
 * 外面改过且只改了格子时，可以选「只写我改的格子」
 */
export function TableSaveDialog({
  open,
  doc,
  sheets,
  pending,
  problems = [],
  mode = 'warn',
  onCancel,
  onSave,
}: {
  /** 改到的格子里不合规的（当前工作表），按项目设置的「保存前检查」提醒或拦下 */
  problems?: { r: number; c: number; msg: string; field: string }[]
  mode?: 'off' | 'warn' | 'block'
  open: boolean
  doc: TableDoc
  /** 现在页面上的各张表（取新值） */
  sheets: Record<string, string[][]>
  pending: SheetEdit[]
  onCancel: () => void
  onSave: (force: boolean) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; canForce: boolean } | null>(null)
  const base = (name: string): SheetData | undefined => doc.sheets.find((s) => s.name === name)
  const cells = pending.reduce((n, s) => n + s.cells.length, 0)
  const shown = mode === 'off' ? [] : problems
  const blocked = mode === 'block' && shown.length > 0
  const save = async (force: boolean) => {
    setBusy(true)
    setError(null)
    const err = await onSave(force)
    setBusy(false)
    if (err) setError({ text: err, canForce: /被改过/.test(err) && pending.every((s) => !s.rows.length) })
  }
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onCancel()}
      title={t('保存 {name}', { name: doc.path.slice(doc.path.lastIndexOf('/') + 1) })}
      size="md"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">{t('{n} 个格子', { n: cells })}</span>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('取消')}
          </Button>
          {error?.canForce && (
            <Button variant="secondary" onClick={() => void save(true)} disabled={busy}>
              {t('只写我改的格子')}
            </Button>
          )}
          <Button onClick={() => void save(false)} disabled={busy || blocked}>
            {busy && <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />}
            {t('保存')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3">
        <p className="tb:flex tb:gap-2 tb:rounded-lg tb:bg-sel tb:px-3 tb:py-2.5 tb:text-footnote tb:leading-relaxed tb:text-muted">
          <ShieldCheck className="tb:mt-0.5 tb:h-4 tb:w-4 tb:shrink-0 tb:text-success" />
          {doc.kind === 'csv'
            ? t('只改下面这些格子的值，分隔符、换行、编码照原样。保存前原文件会备份到数据目录。')
            : t(
                '只改下面这些格子的值，样式、公式、其它工作表、图片都原样保留，文件仍是原来的 Excel / WPS 格式。保存前原文件会备份到数据目录。',
              )}
        </p>
        {shown.length > 0 && (
          <div
            role="alert"
            className={cn(
              'tb:flex tb:flex-col tb:gap-1 tb:rounded-lg tb:px-3 tb:py-2.5 tb:text-footnote',
              blocked ? 'tb:bg-danger/10 tb:text-danger' : 'tb:bg-warning/10 tb:text-warning',
            )}
          >
            <p className="tb:flex tb:items-center tb:gap-1.5 tb:font-medium">
              <AlertTriangle className="tb:h-3.5 tb:w-3.5 tb:shrink-0" />
              {blocked
                ? t('改到的格子里有 {n} 处不合规，项目设置里定了不合规就不让保存', { n: shown.length })
                : t('改到的格子里有 {n} 处不合规，仍然可以保存', { n: shown.length })}
            </p>
            {shown.slice(0, 6).map((p) => (
              <p key={`${p.r}:${p.c}:${p.msg}`} className="tb:flex tb:gap-2 tb:font-mono tb:text-caption">
                <span className="tb:w-12 tb:shrink-0 tb:opacity-70">{cellRef(p.r, p.c)}</span>
                <span className="tb:w-32 tb:shrink-0 tb:truncate tb:opacity-80">{p.field}</span>
                <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:font-sans">{p.msg}</span>
              </p>
            ))}
            {shown.length > 6 && (
              <p className="tb:text-caption tb:opacity-80">{t('还有 {n} 处', { n: shown.length - 6 })}</p>
            )}
          </div>
        )}
        {error && (
          <p className="tb:rounded-lg tb:bg-danger/10 tb:px-3 tb:py-2.5 tb:text-body tb:leading-relaxed tb:text-danger">
            {error.text}
          </p>
        )}
        <div className="tb:max-h-[50vh] tb:overflow-auto tb:rounded-lg tb:border">
          {pending.map((s) => {
            // 旧值按做完行操作之后的位置取：插删过行时行号对得上
            const old = applyRowOps(base(s.name)?.rows ?? [], s.rows)
            const now = sheets[s.name] ?? []
            const ins = s.rows.filter((o) => o.n > 0).reduce((n, o) => n + o.n, 0)
            const del = s.rows.filter((o) => o.n < 0).reduce((n, o) => n - o.n, 0)
            return (
              <section key={s.name} className="tb:border-b tb:last:border-b-0">
                <header className="tb:flex tb:items-center tb:gap-2 tb:bg-panel tb:px-3 tb:py-1.5 tb:text-footnote tb:font-medium">
                  {s.name}
                  {ins > 0 && <Badge tone="accent">{t('插入 {n} 行', { n: ins })}</Badge>}
                  {del > 0 && <Badge tone="warning">{t('删除 {n} 行', { n: del })}</Badge>}
                </header>
                <table className="tb:w-full tb:text-footnote">
                  <tbody>
                    {s.cells.slice(0, SHOW).map((c) => (
                      <tr key={`${c.r}:${c.c}`} className="tb:border-t">
                        <td className="tb:w-16 tb:px-3 tb:py-1 tb:font-mono tb:text-subtle">{cellRef(c.r, c.c)}</td>
                        <td
                          className="tb:max-w-0 tb:truncate tb:px-2 tb:py-1 tb:text-subtle tb:line-through"
                          title={old[c.r]?.[c.c]}
                        >
                          {old[c.r]?.[c.c] ?? ''}
                        </td>
                        <td className="tb:max-w-0 tb:truncate tb:px-2 tb:py-1 tb:text-fg" title={now[c.r]?.[c.c]}>
                          {c.v || <span className="tb:text-subtle">{t('（清空）')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.cells.length > SHOW && (
                  <p className="tb:px-3 tb:py-1.5 tb:text-caption tb:text-subtle">
                    {t('还有 {n} 处', { n: s.cells.length - SHOW })}
                  </p>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
