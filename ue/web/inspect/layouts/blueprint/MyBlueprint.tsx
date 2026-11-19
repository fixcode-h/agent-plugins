import { Braces, Eye, EyeOff, Hammer, Radio, SquareFunction, Workflow, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Caret } from '../../../details/controls.tsx'
import { h, t } from '../../../host.ts'
import { Hit, TreeSearch } from '../../../tree-search.tsx'
import { Card, ErrorText } from '../../../ui.tsx'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import { CONSTRUCTION, myBlueprint, typeTone, type BpOutline, type MyBpItem, type SectionId } from './model.ts'

const TITLES: Record<SectionId, () => string> = {
  graphs: () => t('图表'),
  functions: () => t('函数'),
  macros: () => t('宏'),
  variables: () => t('变量'),
  dispatchers: () => t('事件分发器'),
}

const iconOf = (i: MyBpItem): LucideIcon =>
  i.section === 'macros'
    ? Braces
    : i.section === 'dispatchers'
      ? Radio
      : i.graph === CONSTRUCTION
        ? Hammer
        : i.section === 'graphs'
          ? Workflow
          : SquareFunction

/** 图表行显示的名字：事件图、构造脚本按 UE 的叫法 */
export const graphLabel = (name: string, kind?: string) =>
  name === CONSTRUCTION ? t('构造脚本') : kind === 'event' && name === 'EventGraph' ? t('事件图表') : name

/** 行尾小字：函数写几个输入 / 纯函数 → 返回类型；图表写英文原名（和 UE 一样，搜的时候认得出） */
function aside(i: MyBpItem) {
  if (i.section === 'graphs') return i.graph === CONSTRUCTION || i.name === 'EventGraph' ? i.name : ''
  if (i.section === 'functions') {
    const ret = i.outputs?.map((o) => o.type).join(', ')
    if (i.pure) return ret ? t('纯函数 → {r}', { r: ret }) : t('纯函数')
    const n = i.inputs?.length ?? 0
    return n ? t('{n} 个输入', { n }) : ret ? `→ ${ret}` : ''
  }
  return i.type ?? ''
}

/**
 * 「我的蓝图」（效果图 A1 左下）：图表、函数、宏、变量、事件分发器分组列出，搜名字和类型。
 * 图、函数、宏点一下在中间的图表页签里打开；变量左边按类型上色、右边眼睛是「实例可编辑」。
 * 只读：增删改交给 Agent（ue_blueprint）或在 UE 里做，所以不放 UE 那几个「+」
 */
export function MyBlueprint({
  outline,
  error,
  online,
  active,
  onGraph,
}: {
  outline?: BpOutline
  error: string
  online: boolean
  /** 中间正在看的图（高亮） */
  active?: string
  onGraph: (name: string) => void
}) {
  const { cn } = h()
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Set<SectionId>>(() => new Set())
  const sections = useMemo(() => (outline ? myBlueprint(outline, q) : []), [outline, q])
  const hits = sections.reduce((n, s) => n + s.items.length, 0)
  const toggle = (id: SectionId) =>
    setClosed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <Card className="ue:min-h-0 ue:flex-1" title={t('我的蓝图')} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
      <TreeSearch value={q} onChange={setQ} placeholder={t('搜变量、函数、图表')} hits={hits} />
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
        {!outline && (
          <div className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
            {error ? (
              online ? (
                <ErrorText>{error}</ErrorText>
              ) : (
                t('UE 没连上：变量、函数和图表要 UE 导出，打开编辑器后自动刷新')
              )
            ) : (
              t('读取中…')
            )}
          </div>
        )}
        {sections.map((s) => {
          const open = !!q.trim() || !closed.has(s.id)
          return (
            <section key={s.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(s.id)}
                className="ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-2 ue:text-left ue:text-footnote ue:font-medium ue:text-fg ue:hover:bg-hover"
              >
                <span className="ue:flex ue:w-4 ue:justify-center ue:text-muted">
                  <Caret open={open} />
                </span>
                {TITLES[s.id]()}
                <span className="ue:text-caption ue:font-normal ue:text-subtle">{s.items.length}</span>
              </button>
              {open && (
                <ul className="ue:pb-1">
                  {s.items.map((i) => (
                    <li key={i.key}>
                      <Row item={i} q={q} active={!!i.graph && i.graph === active} onGraph={onGraph} cn={cn} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </Card>
  )
}

function Row({
  item: i,
  q,
  active,
  onGraph,
  cn,
}: {
  item: MyBpItem
  q: string
  active: boolean
  onGraph: (name: string) => void
  cn: ReturnType<typeof h>['cn']
}) {
  const Icon = iconOf(i)
  const isVar = i.section === 'variables'
  const title = [i.name, i.type, i.category && t('分类 {c}', { c: i.category }), i.replication]
    .filter(Boolean)
    .join('\n')
  const body = (
    <>
      {isVar ? (
        <span
          aria-hidden
          className="ue:h-2.5 ue:w-5 ue:shrink-0 ue:rounded-full"
          style={{ background: toneColor(typeTone(i.type ?? '')) }}
        />
      ) : (
        <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
      )}
      <span className="ue:min-w-0 ue:flex-1 ue:truncate">
        <Hit text={i.section === 'graphs' ? graphLabel(i.name, i.graphKind) : i.name} q={q} />
      </span>
      <span className="ue:min-w-0 ue:shrink ue:truncate ue:text-caption ue:text-subtle">{aside(i)}</span>
      {isVar &&
        (i.editable ? (
          <Eye className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" aria-label={t('实例可编辑')} />
        ) : (
          <EyeOff className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" aria-label={t('实例不可编辑')} />
        ))}
    </>
  )
  const cls =
    'ue:flex ue:h-7 ue:w-full ue:items-center ue:gap-2 ue:pr-3 ue:pl-7 ue:text-left ue:text-footnote ue:text-fg'
  if (!i.graph)
    return (
      <div className={cls} title={title}>
        {body}
      </div>
    )
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={() => onGraph(i.graph!)}
      className={cn(cls, 'ue:cursor-pointer ue:transition-colors', active ? 'ue:bg-sel' : 'ue:hover:bg-hover')}
    >
      {body}
    </button>
  )
}
