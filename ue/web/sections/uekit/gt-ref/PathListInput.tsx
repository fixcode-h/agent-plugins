import { X } from 'lucide-react'
import { useState } from 'react'
import { parsePropPath } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { PathChips } from '../../../path-chips/PathChips.tsx'
import { stateName } from './IdentList.tsx'

/** 用户打的名字 → 路径：光写名字（`ItemId`、`Data.ItemId`）当对象自己的属性；已经是路径的原样收 */
export function pathOfName(s: string): string {
  const v = s.trim()
  if (!v) return ''
  if (v.startsWith('@')) return v
  return `@.${v}`
}

/**
 * 几条属性路径（设置页「按类记住的标识」那一格）：每条画成小块、能删；底下打属性名回车加一条。
 * 设置页没有具体对象可读属性树，所以不给下拉，只按名字收（界面不出现路径符号，用户 2026-11-21）
 */
export function PathListInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { ui } = h()
  const [draft, setDraft] = useState('')
  const next = pathOfName(draft)
  const ok = !!next && !('error' in parsePropPath(next))
  const add = () => {
    if (!ok || value.includes(next)) return
    onChange([...value, next])
    setDraft('')
  }
  return (
    <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-1">
      {value.length > 0 && (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1">
          {value.map((p, i) => (
            <span key={`${p}#${i}`} className="ue:inline-flex ue:min-w-0 ue:items-center ue:gap-0.5">
              <PathChips path={p} small stateName={stateName} />
              <ui.IconButton size="sm" label={t('删掉')} onClick={() => onChange(value.filter((_, k) => k !== i))}>
                <X className="ue:h-3 ue:w-3" />
              </ui.IconButton>
            </span>
          ))}
        </div>
      )}
      <ui.Input
        size="sm"
        className="ue:w-full"
        placeholder={t('属性名，回车加')}
        value={draft}
        aria-invalid={!!draft.trim() && !ok}
        onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
        onKeyDown={(e: { key: string; preventDefault: () => void }) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          add()
        }}
        onBlur={add}
      />
    </div>
  )
}
