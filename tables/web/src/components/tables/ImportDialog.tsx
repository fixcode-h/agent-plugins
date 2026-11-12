import { useDeferredValue, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import type { ColInfo } from '@shared/table-struct'
import { importPlan, type ImportPlan } from '@shared/table-io'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Textarea } from '@/components/ui/input'

/** 预览最多列这么多行 */
const PREVIEW = 50

/**
 * 从 CSV 粘贴导入：贴进来（Excel 里复制的也行，是制表符分隔），第一行是字段名就按名字对列。
 * 有主键时可以「主键已有的更新」，否则全部追加到末尾。放进表格是一次改动，看过再保存
 */
export function ImportDialog({
  rows,
  from,
  infos,
  keyCol,
  onApply,
  onClose,
}: {
  rows: string[][]
  from: number
  infos: ColInfo[]
  keyCol: number
  onApply: (plan: ImportPlan) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [upsert, setUpsert] = useState(keyCol >= 0)
  const q = useDeferredValue({ text, upsert })
  const plan = useMemo(
    () => (q.text.trim() ? importPlan(rows, from, infos, keyCol, q.text, q.upsert) : null),
    [q, rows, from, infos, keyCol],
  )
  const changed = new Set(plan?.cells.map((c) => c.r)).size
  const cols = infos.map((i, c) => i.field || String(c + 1))
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('从 CSV 粘贴导入')}
      size="lg"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">
            {plan
              ? t('追加 {a} 行，更新 {u} 行（{c} 格）', { a: plan.add.length, u: changed, c: plan.cells.length })
              : ''}
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            disabled={!plan || (!plan.add.length && !plan.cells.length)}
            onClick={() => {
              onApply(plan!)
              onClose()
            }}
          >
            {t('放进表格')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3">
        <Field
          label={t('粘贴 CSV')}
          tip={t('第一行是字段名时按字段名对列，否则按列的顺序。从 Excel 复制的（制表符分隔）也可以。')}
        >
          <Textarea
            autoFocus
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={cols.slice(0, 6).join(',')}
            className="tb:font-mono tb:text-footnote"
          />
        </Field>
        {keyCol >= 0 && (
          <Checkbox
            checked={upsert}
            onChange={setUpsert}
            label={t('主键（{key}）已有的行改成粘贴的值，新主键追加', { key: infos[keyCol]?.field ?? '' })}
          />
        )}
        {plan && (
          <>
            <p className="tb:text-caption tb:text-subtle">
              {plan.byName ? t('按第一行的字段名对列') : t('第一行不是字段名，按列的顺序对')}
              {plan.same > 0 && ` · ${t('{n} 行和表里一样', { n: plan.same })}`}
            </p>
            {plan.unknown.length > 0 && (
              <p className="tb:text-footnote tb:text-warning">
                {t('表里没有这些列，会跳过：{cols}', { cols: plan.unknown.join('、') })}
              </p>
            )}
            {plan.add.length > 0 && (
              <div
                role="table"
                aria-label={t('追加的行')}
                className="thin-scroll tb:max-h-[260px] tb:overflow-auto tb:rounded-(--c-row-radius) tb:border tb:font-mono tb:text-footnote"
              >
                <div role="row" className="tb:flex tb:border-b tb:bg-hover/60 tb:text-caption tb:text-subtle">
                  {cols.map((c, i) => (
                    <span role="columnheader" key={i} className="tb:w-28 tb:shrink-0 tb:truncate tb:px-2 tb:py-1">
                      {c}
                    </span>
                  ))}
                </div>
                {plan.add.slice(0, PREVIEW).map((r, i) => (
                  <div role="row" key={i} className="tb:flex tb:border-b tb:last:border-b-0">
                    {cols.map((_, c) => (
                      <span
                        role="cell"
                        key={c}
                        className="tb:w-28 tb:shrink-0 tb:truncate tb:px-2 tb:py-1"
                        title={r[c]}
                      >
                        {r[c]}
                      </span>
                    ))}
                  </div>
                ))}
                {plan.add.length > PREVIEW && (
                  <p className="tb:px-2 tb:py-1 tb:font-sans tb:text-caption tb:text-subtle">
                    {t('还有 {n} 行没列出来', { n: plan.add.length - PREVIEW })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
