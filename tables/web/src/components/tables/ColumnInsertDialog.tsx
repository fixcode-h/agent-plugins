import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { SheetHeader, SheetRole } from '@shared/sheet-header'
import type { CellSet } from '@shared/table-edit'
import type { EnumOption } from '@shared/table-struct'
import { colName } from '@/lib/sheet'
import { roleLabel } from '@/components/files/sheet-roles'
import { Button } from '@/components/ui/button'
import { ComboInput, Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Segmented } from '@/components/ui/segmented'

type Where = 'left' | 'right' | 'end'

/** 照着旁边那列预填的表头行：修饰、导出端通常和旁边一样；字段名、类型、注释要自己填 */
const COPY_ROLES = new Set<SheetRole>(['modifier', 'side'])

/**
 * 插入一列：选插在哪（这一列左边 / 右边 / 最后），顺便填好表头几行（字段名、类型……），
 * 还可以给已有的数据行填一个默认值。一次放进表格，一步就能撤销。
 * xlsx 里有公式、合并单元格、数据验证这些的表不能在中间插（会指错位置），只能加在最后，这里提前说清楚
 */
export function ColumnInsertDialog({
  anchor,
  initial,
  end,
  blocked,
  header,
  rows,
  fields,
  optionsFor,
  onApply,
  onClose,
}: {
  /** 右键的是哪一列 */
  anchor: number
  initial: Where
  /** 「加在最后」插在第几列 */
  end: number
  /** 不能在中间插的原因；null = 还在查 */
  blocked: string[] | null
  header: SheetHeader
  rows: string[][]
  /** 已有的字段名（查重名） */
  fields: string[]
  /** 表头第 i 行在设置里定了取值（类型行 = 基础类型 + 通用枚举……）：给下拉建议 */
  optionsFor: (i: number) => EnumOption[] | undefined
  /** at：插在第几列；cells：新列里要填的格子（行号是表里的行号，列号就是 at） */
  onApply: (at: number, cells: CellSet[]) => void
  onClose: () => void
}) {
  const stuck = !!blocked?.length
  const [picked, setWhere] = useState<Where>(initial)
  // 能不能在中间插是打开弹窗后才问到的：问到不能时直接落到「最后」
  const where: Where = stuck ? 'end' : picked
  const at = where === 'left' ? anchor : where === 'right' ? anchor + 1 : end
  const mid = at < end
  // 照着插入处左边那一列预填修饰、导出端
  const neighbour = Math.max(0, at - 1)
  const [values, setValues] = useState<string[]>(() =>
    header.roles.map((role, i) => (COPY_ROLES.has(role) ? (rows[header.start + i]?.[neighbour] ?? '') : '')),
  )
  const [fill, setFill] = useState('')
  const from = header.roles.length ? header.start + header.roles.length : 0
  const nameAt = header.roles.indexOf('name')
  const name = nameAt >= 0 ? values[nameAt].trim() : ''
  const taken = useMemo(() => new Set(fields.filter(Boolean)), [fields])
  const dup = !!name && taken.has(name)
  const dataRows = useMemo(() => {
    let n = 0
    for (let r = from; r < rows.length; r++) if (rows[r]?.some((v) => v !== '')) n++
    return n
  }, [rows, from])
  const canApply = !(mid && blocked === null) && !(mid && stuck)
  const apply = () => {
    if (!canApply) return
    const cells: CellSet[] = []
    header.roles.forEach((_, i) => values[i] && cells.push({ r: header.start + i, c: at, v: values[i] }))
    // 默认值只填有内容的行：空行填了就变成「有一格的行」，导表时会多出一条
    if (fill)
      for (let r = from; r < rows.length; r++) if (rows[r]?.some((v) => v !== '')) cells.push({ r, c: at, v: fill })
    onApply(at, cells)
    onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('插入列')}
      size="md"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">
            {t('插在 {col} 列，后面的列往右挪', { col: colName(at) })}
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button onClick={apply} disabled={!canApply}>
            {t('插入')}
          </Button>
        </>
      }
    >
      <form
        className="tb:flex tb:flex-col tb:gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <Segmented
          label={t('插在哪')}
          value={where}
          onChange={setWhere}
          fill
          options={[
            { id: 'left', label: t('{col} 列左边', { col: colName(anchor) }), disabled: stuck },
            { id: 'right', label: t('{col} 列右边', { col: colName(anchor) }), disabled: stuck },
            { id: 'end', label: t('最后') },
          ]}
        />
        {mid && blocked === null && (
          <p className="tb:flex tb:items-center tb:gap-2 tb:text-footnote tb:text-subtle">
            <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />
            {t('正在看这张表能不能在中间插列…')}
          </p>
        )}
        {stuck && (
          <p className="tb:flex tb:gap-2 tb:rounded-lg tb:bg-warning/10 tb:px-3 tb:py-2.5 tb:text-footnote tb:leading-relaxed tb:text-warning">
            <AlertTriangle className="tb:mt-0.5 tb:h-3.5 tb:w-3.5 tb:shrink-0" />
            {t(
              '这张表有{what}，在中间插列会让它们指错位置，所以只能加在最后。要插在中间请用 Excel / WPS（它们会一起改写这些引用）。',
              { what: blocked!.join('、') },
            )}
          </p>
        )}
        {header.roles.length > 0 ? (
          <div className="tb:flex tb:flex-col tb:gap-3">
            {header.roles.map((role, i) => {
              const label = header.labels?.[i] || roleLabel(role)
              const opts = optionsFor(i)
              const set = (v: string) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)))
              return (
                <Field
                  key={i}
                  label={t('第 {n} 行 · {label}', { n: header.start + i + 1, label })}
                  error={role === 'name' && dup ? t('已经有叫「{name}」的列了', { name }) : undefined}
                >
                  {opts?.length ? (
                    <ComboInput
                      value={values[i]}
                      onChange={set}
                      suggestions={opts.map((o) => ({ value: o.name, label: o.desc }))}
                      className="tb:font-mono"
                    />
                  ) : (
                    <Input
                      value={values[i]}
                      onChange={(e) => set(e.target.value)}
                      autoFocus={role === 'name'}
                      className={role === 'comment' ? undefined : 'tb:font-mono'}
                    />
                  )}
                </Field>
              )
            })}
          </div>
        ) : (
          <p className="tb:text-footnote tb:text-subtle">{t('这张表没设表头：插入的是一列空列。')}</p>
        )}
        {dataRows > 0 && (
          <Field
            label={t('已有的 {n} 行数据填入（可不填）', { n: dataRows })}
            hint={t('新字段的默认值，比如 0；空着就是空格子')}
          >
            <Input value={fill} onChange={(e) => setFill(e.target.value)} className="tb:font-mono" />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
