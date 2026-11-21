import { Crosshair, X } from 'lucide-react'
import {
  lastSegOf,
  propLabel,
  type GtIdentItem,
  type GtPropGroup,
  type GtPropItem,
} from '../../../../shared/gt-script/index.ts'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { PathChips } from '../../../path-chips/PathChips.tsx'
import { defaultIdent, kindOfProp, membersOf } from './compare-table.ts'
import { CompareEditor } from './CompareEditor.tsx'
import { PropFind } from './PropFind.tsx'

/** 属性树里按路径找一项（标识组、判断都用） */
export const findItem = (groups: GtPropGroup[] | undefined, prop: string): GtPropItem | undefined =>
  groups?.flatMap((g) => g.items).find((i) => i.prop === prop)

/** 文字类属性此刻的本地化键：同一个对象路径上 `textKey` 状态那一项的值（`@/Title:text` → `@/Title:textKey`） */
export function textKeyFor(items: GtPropItem[] | undefined, prop: string): string | undefined {
  const last = lastSegOf(prop)
  if (last?.kind !== 'state') return undefined
  const head = prop.slice(0, prop.lastIndexOf(':'))
  const v = items?.find((i) => i.prop === `${head}:textKey`)?.value
  return typeof v === 'string' && v ? v : undefined
}

/** 运行状态的中文名（PathChips 用） */
export const stateName = (name: string) => propLabel(`@:${name}`, { t })

/**
 * 一条标识 / 判断（效果图 3 右栏的卡片）：路径小块、类型、此刻值、删掉，下面是按类型的比较。
 * `actual` 是此刻的值（选中实例读到的）；不给时用属性树里的值
 */
export function IdentRow({
  value,
  onChange,
  onRemove,
  items,
  actual,
}: {
  value: GtIdentItem
  onChange: (v: GtIdentItem) => void
  onRemove?: () => void
  items?: GtPropItem[]
  actual?: unknown
}) {
  const { ui } = h()
  const item = items?.find((i) => i.prop === value.prop)
  const kind = kindOfProp(value.prop, items)
  const now = actual !== undefined ? actual : item?.value
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-2">
      <div className="ue:flex ue:min-w-0 ue:items-start ue:gap-1.5">
        <Crosshair className="ue:mt-1 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
        <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-0.5">
          <PathChips path={value.prop} small stateName={stateName} />
          <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
            {(item?.type || kind) && (
              <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1.5 ue:py-px ue:font-mono ue:text-caption ue:text-muted">
                {item?.type ?? kind}
              </span>
            )}
            {now !== undefined && (
              <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle" title={show(now)}>
                {t('此刻 {v}', { v: show(now) })}
              </span>
            )}
          </div>
        </div>
        {onRemove && (
          <ui.IconButton size="sm" label={t('移出标识组')} onClick={onRemove}>
            <X className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        )}
      </div>
      <CompareEditor
        value={value}
        onChange={onChange}
        kind={kind}
        members={membersOf(item)}
        textKey={textKeyFor(items, value.prop)}
      />
    </div>
  )
}

/**
 * 唯一标识组：都要满足。一般从细节面板点准星加，也能按名字找一个属性加进来
 */
export function IdentList({
  value,
  onChange,
  items = [],
  actual,
  empty,
}: {
  value: GtIdentItem[]
  onChange: (v: GtIdentItem[]) => void
  items?: GtPropItem[]
  /** 路径 → 此刻的值 */
  actual?: (prop: string) => unknown
  empty?: string
}) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      {value.map((it, i) => (
        <IdentRow
          key={`${it.prop}#${i}`}
          value={it}
          items={items}
          actual={actual?.(it.prop)}
          onChange={(v) => onChange(value.map((x, k) => (k === i ? v : x)))}
          onRemove={() => onChange(value.filter((_, k) => k !== i))}
        />
      ))}
      {!value.length && (
        <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
          {empty ?? t('只按类认：同时开两份会报错。点细节里的准星加标识')}
        </p>
      )}
      <PropFind
        items={items}
        skip={new Set(value.map((x) => x.prop))}
        onAdd={(prop, item) => onChange([...value, item ? defaultIdent(item) : { prop, op: 'eq', value: '' }])}
      />
    </div>
  )
}
