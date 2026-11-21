import { Crosshair, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  formatFnArgs,
  formatPropPath,
  lastSegOf,
  parseFnArgs,
  parsePropPath,
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

/** 去掉 key 这一项（可选字段不写 undefined） */
function withoutKey<T extends object>(v: T, key: keyof T): T {
  const out = { ...v }
  delete out[key]
  return out
}

/** 最后一段是函数时去掉参数的写法：`@.GetCount(3)` → `@.GetCount()`；不是函数返回 undefined */
function fnHead(prop: string): string | undefined {
  const p = parsePropPath(prop)
  if ('error' in p || p.segs.at(-1)?.kind !== 'fn') return undefined
  return formatPropPath({
    ...p,
    segs: p.segs.map((x, i) => (i === p.segs.length - 1 ? { kind: x.kind, name: x.name } : x)),
  })
}
const sameFn = (a: string, b: string) => {
  const x = fnHead(a)
  return !!x && x === fnHead(b)
}

/**
 * 带参数的取值函数（GameTest 2.1.6，`@.GetCount(1001)`）：每个参数一个输入框，改了写回路径。
 * 参数名取 gt.props 给的参数表（去掉输出参数）；只能写常量，写法不对标红不写回
 */
function FnArgs({
  value,
  item,
  onChange,
}: {
  value: GtIdentItem
  item?: GtPropItem
  onChange: (v: GtIdentItem) => void
}) {
  const { ui, cn } = h()
  const p = parsePropPath(value.prop)
  const last = 'error' in p ? undefined : p.segs.at(-1)
  const parsed = last?.kind === 'fn' && last.args ? parseFnArgs(last.args) : undefined
  const names = (item?.luaFn?.params ?? []).filter((x) => !x.startsWith('out ')).map((x) => x.split(' ').at(-1) ?? x)
  const [draft, setDraft] = useState<Record<number, string>>({})
  if ('error' in p || !last || !parsed || 'error' in parsed || !parsed.length) return null
  const put = (i: number, text: string) => {
    setDraft((d) => ({ ...d, [i]: text }))
    const v = argValue(text)
    if (v === undefined) return
    const next = parsed.map((x, k) => (k === i ? v : x))
    const segs = p.segs.map((x, k) => (k === p.segs.length - 1 ? { ...x, args: formatFnArgs(next) } : x))
    onChange({ ...value, prop: formatPropPath({ ...p, segs }) })
  }
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:pl-5">
      <span className="ue:text-caption ue:text-subtle">{t('参数')}</span>
      {parsed.map((v, i) => {
        const text = draft[i] ?? (typeof v === 'string' ? JSON.stringify(v) : String(v))
        return (
          <label key={i} className="ue:flex ue:items-center ue:gap-1">
            <span className="ue:font-mono ue:text-caption ue:text-muted">{names[i] ?? `#${i + 1}`}</span>
            <ui.Input
              size="sm"
              className={cn('ue:w-24 ue:font-mono', argValue(text) === undefined && 'ue:border-danger')}
              value={text}
              onChange={(e: { target: { value: string } }) => put(i, e.target.value)}
            />
          </label>
        )
      })}
    </div>
  )
}

/** 一个参数框的文字 → 值：写成常量（数字、"文字"、true / false / null）才认；没加引号的当文字 */
function argValue(text: string): unknown {
  const s = text.trim()
  const r = parseFnArgs(s)
  if (!('error' in r) && r.length === 1) return r[0]
  // 没加引号又不是数字、布尔：当成文字（人在框里打字不想还要打引号）
  if (s && !/[,"']/.test(s)) return s
  return undefined
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
  canNot,
  flash,
}: {
  value: GtIdentItem
  onChange: (v: GtIdentItem) => void
  onRemove?: () => void
  items?: GtPropItem[]
  actual?: unknown
  /** 唯一标识的条件组里（2.1.6）：前面多一个「非」开关 */
  canNot?: boolean
  /** 刚从准星加进来：闪一下，让人看到它落在哪个组 */
  flash?: boolean
}) {
  const { ui, cn } = h()
  // 带参数的函数：按去掉参数的写法也认得属性树里那一项（参数改过之后路径就和列表里的不一样了）
  const item = items?.find((i) => i.prop === value.prop) ?? items?.find((i) => sameFn(i.prop, value.prop))
  const kind = kindOfProp(value.prop, items) ?? item?.kind
  const now = actual !== undefined ? actual : item?.prop === value.prop ? item?.value : undefined
  // 刚加进来的那条滚到看得见的地方（目标组可能在栏的下面）
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (flash) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [flash])
  return (
    <div
      ref={box}
      className={cn(
        'ue:flex ue:flex-col ue:gap-1.5 ue:rounded-(--c-row-radius) ue:border ue:bg-card ue:p-2 ue:transition-shadow',
        flash ? 'ue:border-accent ue:ring-2 ue:ring-accent/40' : 'ue:border-line',
      )}
    >
      <div className="ue:flex ue:min-w-0 ue:items-start ue:gap-1.5">
        {canNot ? (
          <button
            type="button"
            title={value.not ? t('取反：不满足这条才算（点一下取消）') : t('点一下取反：不满足这条才算')}
            onClick={() => onChange(value.not ? withoutKey(value, 'not') : { ...value, not: true })}
            className={cn(
              'ue:mt-px ue:h-5 ue:shrink-0 ue:rounded-sm ue:px-1 ue:text-caption',
              value.not ? 'ue:bg-warning/15 ue:font-medium ue:text-warning' : 'ue:text-subtle ue:hover:bg-hover',
            )}
          >
            {t('非')}
          </button>
        ) : (
          <Crosshair className="ue:mt-1 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
        )}
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
      <FnArgs value={value} item={item} onChange={onChange} />
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
