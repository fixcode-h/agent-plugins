import { useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import type { SheetData } from '@shared/files'
import type { TableSchema } from '@shared/tables'
import { mergeSheets, type MergeConflict, type MergeResult, type Side } from '@shared/table-merge'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 冲突最多列这么多条（多了先用「全部用……」，合进表里再慢慢改） */
const SHOW = 300

/** 一边的值：按钮，选中的那边高亮 */
function Pick({ label, v, on, onClick }: { label: string; v: string | null; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'tb:flex tb:min-w-0 tb:flex-1 tb:cursor-pointer tb:flex-col tb:gap-0.5 tb:rounded-(--c-row-radius) tb:border tb:px-2 tb:py-1 tb:text-left',
        on ? 'tb:border-accent tb:bg-accent/8' : 'tb:hover:bg-hover',
      )}
    >
      <span className="tb:text-caption tb:text-subtle">{label}</span>
      <span className="tb:truncate tb:font-mono tb:text-footnote" title={v ?? ''}>
        {v === null ? (
          <span className="tb:text-subtle tb:italic">{t('删掉了这一行')}</span>
        ) : (
          v || <span className="tb:text-subtle tb:italic">{t('空')}</span>
        )}
      </span>
    </button>
  )
}

const where = (c: MergeConflict) =>
  c.kind === 'header'
    ? t('{sheet} · 表头', { sheet: c.sheet })
    : c.kind === 'row'
      ? `${c.sheet} · ${c.key}`
      : `${c.sheet} · ${c.key} · ${c.field}`

/**
 * 合并冲突：按主键对齐行、按字段名对齐列，只有一边改了的已经自动合好，这里只列两边都改了的，
 * 每条挑用我的还是对方的。「放进表格」后合并结果作为一次改动出现在表格里，看过再保存
 */
export function MergeDialog({
  schema,
  path,
  base,
  ours,
  theirs,
  theirsLabel,
  onApply,
  onClose,
}: {
  schema: TableSchema
  path: string
  base: SheetData[]
  ours: SheetData[]
  theirs: SheetData[]
  theirsLabel: string
  onApply: (r: MergeResult) => void
  onClose: () => void
}) {
  const [choices, setChoices] = useState<Record<string, Side>>({})
  const res = useMemo(
    () => mergeSheets(schema, path, base, ours, theirs, choices),
    [schema, path, base, ours, theirs, choices],
  )
  const all = (side: Side) => setChoices(Object.fromEntries(res.conflicts.map((c) => [c.id, side])))
  const n = res.conflicts.length
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('合并冲突')}
      size="lg"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">
            {t('自动合进来对方的 {a} 处改动，{n} 处要挑', { a: res.auto, n })}
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            onClick={() => {
              onApply(res)
              onClose()
            }}
          >
            {t('放进表格')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3">
        <p className="tb:text-caption tb:text-subtle">
          {t(
            '我这边是本地文件，对方是 {rev}。按主键对齐行、按字段名对齐列；放进表格后看一遍再保存，保存后标记已解决。',
            {
              rev: theirsLabel,
            },
          )}
        </p>
        {res.notes.map((x) => (
          <p key={x} className="tb:text-footnote tb:text-warning">
            {x}
          </p>
        ))}
        {n > 0 ? (
          <>
            <div className="tb:flex tb:items-center tb:gap-2">
              <Button size="sm" variant="secondary" onClick={() => all('ours')}>
                {t('全部用我的')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => all('theirs')}>
                {t('全部用对方的')}
              </Button>
            </div>
            <div
              role="list"
              aria-label={t('冲突')}
              className="thin-scroll tb:flex tb:max-h-[420px] tb:flex-col tb:gap-2 tb:overflow-y-auto"
            >
              {res.conflicts.slice(0, SHOW).map((c) => {
                const side = choices[c.id] ?? 'ours'
                const set = (s: Side) => setChoices((m) => ({ ...m, [c.id]: s }))
                return (
                  <div role="listitem" key={c.id} className="tb:flex tb:flex-col tb:gap-1">
                    <span className="tb:truncate tb:font-mono tb:text-caption tb:text-muted">
                      {where(c)}
                      {c.kind !== 'header' && (
                        <span className="tb:ml-2 tb:text-subtle">
                          {t('原来：{v}', { v: c.base === null ? t('没有') : c.base || t('空') })}
                        </span>
                      )}
                    </span>
                    <div className="tb:flex tb:gap-2">
                      <Pick
                        label={t('用我的')}
                        v={c.kind === 'header' ? t('我这边的表头') : c.ours}
                        on={side === 'ours'}
                        onClick={() => set('ours')}
                      />
                      <Pick
                        label={t('用对方的')}
                        v={c.kind === 'header' ? t('对方的表头') : c.theirs}
                        on={side === 'theirs'}
                        onClick={() => set('theirs')}
                      />
                    </div>
                  </div>
                )
              })}
              {n > SHOW && (
                <p className="tb:text-caption tb:text-subtle">
                  {t('还有 {n} 处没列出来，按「全部用……」的选择合', { n: n - SHOW })}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="tb:py-4 tb:text-center tb:text-body tb:text-subtle">
            {t('没有两边都改了的格子，全部自动合好了')}
          </p>
        )}
      </div>
    </Modal>
  )
}
