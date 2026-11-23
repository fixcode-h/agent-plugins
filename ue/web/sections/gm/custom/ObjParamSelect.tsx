import { ChevronDown, Crosshair } from 'lucide-react'
import { isObjArg } from '../../../../shared/gm/custom.ts'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { openMenuAt } from '../../../menu.tsx'
import type { RefHits } from '../../uekit/gt-ref/live.ts'
import { ObjName, ObjRule, srcText } from './ObjRule.tsx'

/**
 * 对象参数的下拉（规格第 7 节、效果图 3）：对象列表里类型对得上的能选、写命中几个，对不上的置灰写原因；
 * 末尾「新的匹配规则…」（打开选对象面板，类定成参数类型）和「传空（None）」。
 * 值存成 `{"$obj": 名字}`，来源项（玩家 @pawn 这类）直接写来源字符串，传空是 null
 */
export function ObjParamSelect({
  value,
  onChange,
  typeName,
  objects,
  hits,
  why,
  onNewRule,
  disabled,
}: {
  value: unknown
  onChange: (v: unknown) => void
  /** 参数要的类型（显示用） */
  typeName: string
  objects: GmObject[]
  hits: Record<string, RefHits | undefined>
  /** 每个对象不能传的原因 */
  why: Record<string, string>
  onNewRule: () => void
  disabled?: boolean
}) {
  const { cn } = h()
  const name = isObjArg(value)
    ? value.$obj
    : typeof value === 'string' && value
      ? objects.find((o) => o.src === value)?.name
      : ''
  const cur = name ? objects.find((o) => o.name === name) : undefined
  const pick = (el: HTMLElement) =>
    openMenuAt(el, [
      { title: t('对象列表里的 · 参数要 {c}', { c: typeName }) },
      ...objects.map((o) => {
        const bad = why[o.name]
        const hit = hits[o.name]
        return {
          label: o.name,
          disabled: !!bad,
          checked: o.name === name,
          hint: bad || (o.src ? srcText(o.src) : hit ? t('命中 {n} 个', { n: hit.count }) : ''),
          onClick: () => onChange(o.src ? o.src : { $obj: o.name }),
        }
      }),
      'sep' as const,
      {
        label: t('新的匹配规则…'),
        icon: Crosshair,
        hint: t('打开选对象面板，类已按参数定为 {c}', { c: typeName }),
        onClick: onNewRule,
      },
      { label: t('传空（None）'), checked: value === null, onClick: () => onChange(null) },
    ])
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => pick(e.currentTarget)}
      className={cn(
        'ue:flex ue:min-h-8 ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:border ue:border-line ue:bg-field ue:px-2 ue:py-1 ue:text-left ue:hover:border-accent ue:disabled:cursor-default ue:disabled:opacity-60',
      )}
    >
      {cur ? (
        <>
          <ObjName name={cur.name} />
          <span className="ue:min-w-0 ue:flex-1 ue:truncate">
            <ObjRule o={cur} small name={cur.name} />
          </span>
        </>
      ) : (
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">
          {value === null ? t('传空（None）') : name ? t('对象「{n}」不在对象列表里', { n: name }) : t('选一个对象')}
        </span>
      )}
      <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
    </button>
  )
}
