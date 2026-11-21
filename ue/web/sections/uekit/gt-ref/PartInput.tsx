import { Puzzle } from 'lucide-react'
import type { GtPropGroup } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'
import { SuggestInput } from '../../../SuggestInput.tsx'

/** 部件下拉（`BtnBuy`、`Header.BtnClose`）：选项是属性树里的部件组，也能直接填 */
export function PartInput({
  value,
  onChange,
  parts,
  className,
}: {
  value: string
  onChange: (v: string) => void
  parts: { part: string; class?: string }[]
  className?: string
}) {
  return (
    <SuggestInput
      className={className}
      inputClassName="ue:font-mono"
      value={value}
      onChange={onChange}
      placeholder={t('部件（不填 = 对象本身）')}
      empty={t('没读到部件，可以直接填控件名')}
      suggest={(q) => {
        const k = q.trim().toLowerCase()
        const rows = parts
          .filter((p) => !k || p.part.toLowerCase().includes(k))
          .map((p) => ({ key: p.part, value: p.part, label: p.part, detail: p.class, icon: Puzzle }))
        return { rows: rows.slice(0, 80), total: rows.length }
      }}
    />
  )
}

/** 属性树里的部件组 → 部件下拉的选项 */
export const partsOf = (groups: GtPropGroup[] | undefined) =>
  (groups ?? []).filter((g) => g.part).map((g) => ({ part: g.part!, class: g.class }))
