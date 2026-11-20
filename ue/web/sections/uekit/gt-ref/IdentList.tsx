import { Crosshair, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { GtIdentItem, GtPropGroup, GtPropItem } from '../../../../shared/gt-script/ref/types.ts'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { kindOfProp, membersOf } from './compare-table.ts'
import { CompareEditor } from './CompareEditor.tsx'
import { PropPathInput } from './PropPathInput.tsx'

/** 属性树里按路径找一项（标识组、判断都用） */
export const findItem = (groups: GtPropGroup[] | undefined, prop: string): GtPropItem | undefined =>
  groups?.flatMap((g) => g.items).find((i) => i.prop === prop)

/** 文字类属性此刻的本地化键：同一部件的 `:textKey` 那一项的值 */
export function textKeyFor(groups: GtPropGroup[] | undefined, prop: string): string | undefined {
  const at = prop.indexOf(':')
  if (at < 0) return undefined
  const v = findItem(groups, `${prop.slice(0, at)}:textKey`)?.value
  return typeof v === 'string' && v ? v : undefined
}

/** 一条标识 / 判断：属性名、类型小标签、删掉，下面是按类型的比较 */
export function IdentRow({
  value,
  onChange,
  onRemove,
  groups,
}: {
  value: GtIdentItem
  onChange: (v: GtIdentItem) => void
  onRemove?: () => void
  groups?: GtPropGroup[]
}) {
  const { ui } = h()
  const item = findItem(groups, value.prop)
  const kind = kindOfProp(
    value.prop,
    groups?.flatMap((g) => g.items),
  )
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-2">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
        <Crosshair className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={value.prop}>
          {value.prop}
        </span>
        {(item?.type || kind) && (
          <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1.5 ue:py-px ue:font-mono ue:text-caption ue:text-muted">
            {item?.type ?? kind}
          </span>
        )}
        {item?.value !== undefined && (
          <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle" title={show(item.value)}>
            {t('此刻 {v}', { v: show(item.value) })}
          </span>
        )}
        {onRemove && (
          <ui.IconButton size="sm" className="ue:ml-auto" label={t('移出标识组')} onClick={onRemove}>
            <X className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        )}
      </div>
      <CompareEditor
        value={value}
        onChange={onChange}
        kind={kind}
        members={membersOf(item ? { ...item, members: (item as { members?: string[] }).members } : undefined)}
        textKey={textKeyFor(groups, value.prop)}
      />
    </div>
  )
}

/**
 * 唯一标识组（效果图 2 右上）：都要满足。一般从属性树点准星加，也能手写一条路径（游戏没开、属性在更深的结构里）
 */
export function IdentList({
  value,
  onChange,
  groups,
}: {
  value: GtIdentItem[]
  onChange: (v: GtIdentItem[]) => void
  groups?: GtPropGroup[]
}) {
  const { ui } = h()
  const [draft, setDraft] = useState('')
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      {value.map((it, i) => (
        <IdentRow
          key={`${it.prop}#${i}`}
          value={it}
          groups={groups}
          onChange={(v) => onChange(value.map((x, k) => (k === i ? v : x)))}
          onRemove={() => onChange(value.filter((_, k) => k !== i))}
        />
      ))}
      {!value.length && (
        <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
          {t('只按类认：同时开两份会报错。点左边的准星加标识')}
        </p>
      )}
      <div className="ue:flex ue:items-center ue:gap-1.5">
        <PropPathInput className="ue:min-w-0 ue:flex-1" value={draft} onChange={setDraft} groups={groups} />
        <ui.Button
          size="sm"
          variant="ghost"
          disabled={!draft.trim()}
          onClick={() => {
            onChange([...value, { prop: draft.trim(), op: 'eq', value: '' }])
            setDraft('')
          }}
        >
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('手写一条')}
        </ui.Button>
      </div>
    </div>
  )
}
