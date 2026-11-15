import { ChevronDown, ChevronRight, PersonStanding } from 'lucide-react'
import { h, t } from '../../host.ts'
import { Badge, KindBadge } from '../../ui.tsx'

export interface Row {
  path: string
  name: string
  class: string
  /** 只看绑了 Lua 的对象时：它的 Lua 模块名 */
  module?: string
  /** 桥接给的分类：instance（活着的实例）、asset（资源、默认值）、class（类本身）；旧桥接没有，按路径猜 */
  kind?: 'instance' | 'asset' | 'class'
  /** 是 Actor（桥接 1.8.0 起）：带编辑器里的显示名、所在关卡、是不是玩家控制的 */
  actor?: boolean
  label?: string
  level?: string
  player?: boolean
}
/** 搜索结果按「运行时实例 / 资源 / 类」分开：同名的蓝图资源、生成类、实例混在一起分不清该改哪个 */
const KINDS = [
  { id: 'instance', label: () => t('运行时实例'), hint: () => t('正在运行的真实对象，改了马上生效') },
  { id: 'asset', label: () => t('资源'), hint: () => t('资源和默认值，改的是以后新建出来的对象，正在显示的不会变') },
  { id: 'class', label: () => t('类'), hint: () => t('类本身，只能看') },
] as const

function kindOf(r: Row): 'instance' | 'asset' | 'class' {
  if (r.kind) return r.kind
  if (/Class$/.test(r.class)) return 'class'
  if (/^\/(Engine\/Transient|Temp)\b|:PersistentLevel\.|UEDPIE_/.test(r.path)) return 'instance'
  return 'asset'
}

/** 按类搜的结果：运行时实例在上，资源默认值和类收在一个可展开的虚线框里 */
export function ClassResults({
  items,
  selected,
  onOpen,
  others,
  onOthers,
}: {
  items: Row[]
  selected: string
  onOpen: (path: string) => void
  /** 用户展开了「资源和默认值」 */
  others: boolean
  onOthers: () => void
}) {
  const { cn } = h()
  const inst = items.filter((o) => kindOf(o) === 'instance')
  const rest = items.filter((o) => kindOf(o) !== 'instance')
  const nAsset = rest.filter((o) => kindOf(o) === 'asset').length
  const show = others || !inst.length || rest.some((o) => o.path === selected)
  const row = (o: Row) => (
    <li key={o.path}>
      <button
        type="button"
        onClick={() => onOpen(o.path)}
        title={o.path}
        className={cn(
          'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
          selected === o.path && 'ue:bg-sel',
        )}
      >
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {o.actor && <PersonStanding className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />}
          <span className="ue:truncate ue:text-body ue:text-fg">{o.label || o.name}</span>
          {o.module && <Badge tone="accent">{o.module}</Badge>}
          {o.player && <span className="ue:ml-auto ue:text-caption ue:text-subtle">{t('玩家')}</span>}
        </span>
        <span className="ue:truncate ue:text-caption ue:text-subtle">
          {o.class} · {o.actor && o.level ? o.level : o.path}
        </span>
      </button>
    </li>
  )
  const head = (id: (typeof KINDS)[number]['id'], n: number) => {
    const k = KINDS.find((x) => x.id === id)!
    return (
      <div className="ue:flex ue:items-center ue:gap-2 ue:px-2.5 ue:pt-1.5 ue:pb-1" title={k.hint()}>
        <KindBadge kind={id} />
        <span className="ue:truncate ue:text-caption ue:text-subtle">
          {n} · {k.hint()}
        </span>
      </div>
    )
  }
  return (
    <>
      {inst.length > 0 && (
        <section className="ue:mb-2">
          {head('instance', inst.length)}
          <ul>{inst.map(row)}</ul>
        </section>
      )}
      {rest.length > 0 && inst.length > 0 && (
        <button
          type="button"
          onClick={onOthers}
          aria-expanded={show}
          className="ue:mx-1 ue:mb-2 ue:flex ue:w-[calc(100%-0.5rem)] ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-dashed ue:border-line-strong ue:px-2.5 ue:py-2 ue:text-left ue:hover:bg-hover"
        >
          {show ? (
            <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          ) : (
            <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          )}
          <span className="ue:min-w-0">
            <span className="ue:block ue:text-footnote ue:text-fg">
              {t('资源和默认值 {a} · 类 {c}', { a: nAsset, c: rest.length - nAsset })}
            </span>
            <span className="ue:block ue:text-caption ue:text-subtle">{t('改的是以后新建的对象，正在跑的不会变')}</span>
          </span>
        </button>
      )}
      {show &&
        (['asset', 'class'] as const).map((id) => {
          const rows = rest.filter((o) => kindOf(o) === id)
          return rows.length ? (
            <section key={id} className="ue:mb-2">
              {head(id, rows.length)}
              <ul>{rows.map(row)}</ul>
            </section>
          ) : null
        })}
    </>
  )
}
