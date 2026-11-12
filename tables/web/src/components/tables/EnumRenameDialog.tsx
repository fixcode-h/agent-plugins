import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { EnumRename } from '@shared/table-enum-rename'
import { tablesApi, type EnumRenameResult } from '@/lib/tables-api'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

/**
 * 枚举值改了名：问要不要把所有表里的旧值一起换掉。先查一遍列出每个文件要改几格，
 * 确认后逐个文件原地保存（只改这些格子、先备份）；写不进去的文件（正被打开、只读）列出原因
 */
export function EnumRenameDialog({
  projectId,
  renames,
  onClose,
  onApplied,
}: {
  projectId: string
  renames: EnumRename[]
  onClose: () => void
  /** 改过的文件：表格页重新载入它们 */
  onApplied?: (paths: string[]) => void
}) {
  const [preview, setPreview] = useState<EnumRenameResult | null>(null)
  const [done, setDone] = useState<EnumRenameResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    tablesApi
      .enumRename(projectId, renames, false)
      .then(setPreview)
      .catch((e) => setError((e as Error).message))
    // 打开时查一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const cells = (r: EnumRenameResult) => r.files.reduce((n, f) => n + f.cells, 0)
  const apply = async () => {
    setBusy(true)
    try {
      const r = await tablesApi.enumRename(projectId, renames, true)
      setDone(r)
      onApplied?.(r.files.map((f) => f.path))
      if (!r.failed.length) {
        toast.success(t('已在 {n} 个文件里替换 {m} 格', { n: r.files.length, m: cells(r) }))
        onClose()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const list = done ?? preview
  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('把表格里的旧值也换掉？')}
      size="md"
      footer={
        done ? (
          <Button onClick={onClose}>{t('关闭')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('不替换')}
            </Button>
            <Button onClick={() => void apply()} disabled={busy || !preview || !preview.files.length}>
              {busy && <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />}
              {preview?.files.length
                ? t('替换 {n} 个文件里的 {m} 格', { n: preview.files.length, m: cells(preview) })
                : t('替换')}
            </Button>
          </>
        )
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3 tb:text-body">
        <ul className="tb:flex tb:flex-col tb:gap-1 tb:rounded-lg tb:bg-sel tb:px-3 tb:py-2 tb:font-mono tb:text-footnote">
          {renames.map((r) => (
            <li key={`${r.enum}:${r.from}`}>
              <span className="tb:text-subtle">{r.enum}</span> · <span className="tb:line-through">{r.from}</span> →{' '}
              {r.to}
            </li>
          ))}
        </ul>
        {error && <p className="tb:text-danger">{error}</p>}
        {!list && !error && (
          <p className="tb:flex tb:items-center tb:gap-2 tb:text-subtle">
            <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />
            {t('正在查哪些表格用了这些值…')}
          </p>
        )}
        {list && !list.files.length && !list.failed.length && (
          <p className="tb:text-subtle">{t('没有表格用到这些旧值，不用替换。')}</p>
        )}
        {list && list.files.length > 0 && (
          <div className="thin-scroll tb:max-h-[240px] tb:overflow-y-auto tb:rounded-lg tb:border">
            {list.files.map((f) => (
              <p
                key={f.path}
                className="tb:flex tb:gap-3 tb:border-b tb:px-3 tb:py-1.5 tb:text-footnote tb:last:border-b-0"
              >
                <span className="tb:min-w-0 tb:flex-1 tb:truncate">{f.path}</span>
                <span className="tb:shrink-0 tb:text-subtle tb:tabular-nums">{t('{n} 格', { n: f.cells })}</span>
              </p>
            ))}
          </div>
        )}
        {done && done.failed.length > 0 && (
          <div className="tb:flex tb:flex-col tb:gap-1 tb:rounded-lg tb:bg-danger/10 tb:px-3 tb:py-2 tb:text-footnote tb:text-danger">
            <p className="tb:font-medium">{t('这些文件没有改成：', {})}</p>
            {done.failed.map((f) => (
              <p key={f.path}>
                {f.path}：{f.error}
              </p>
            ))}
          </div>
        )}
        {!done && (
          <p className="tb:text-caption tb:text-subtle">
            {t('只改用这个枚举的列里等于旧名字的格子（数组列逐项换），保存前每个文件都会备份。')}
          </p>
        )}
      </div>
    </Modal>
  )
}
