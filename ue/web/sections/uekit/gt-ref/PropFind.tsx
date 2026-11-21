import { Braces, Calculator, Code2, FileCode2, Puzzle, Search } from 'lucide-react'
import { useState } from 'react'
import { GT_STATES, lastSegOf, parsePropPath, propLabel, type GtPropItem } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { SuggestInput, type SuggestRow } from '../../../SuggestInput.tsx'
import { stateHint } from './compare-table.ts'

const ICON = { cpp: Code2, bp: Puzzle, lua: FileCode2, state: Calculator }

/** 行上显示的名字：UE 的显示名，没有就按路径拼的友好名（界面不出现路径符号） */
const nameOf = (i: Pick<GtPropItem, 'prop' | 'name'>) => i.name || propLabel(i.prop, { t })

/** 按名字找属性的候选：属性树里的每一项，外加属性树没列出的算出状态（编辑器没开时属性树可能是空的） */
function rowsOf(items: GtPropItem[], q: string, skip?: Set<string>) {
  const k = q.trim().toLowerCase()
  const all: SuggestRow[] = items
    // Lua 函数写不成路径，不能当判断、标识
    .filter((i) => (!i.luaFn || i.comparable !== false) && !skip?.has(i.prop))
    .map((i) => ({
      key: i.prop,
      value: i.prop,
      label: nameOf(i),
      detail: [i.type, i.cat].filter(Boolean).join(' · '),
      icon: ICON[i.src] ?? Braces,
      tone: i.src === 'lua' ? 'ue:text-warning' : undefined,
    }))
  for (const s of GT_STATES) {
    const prop = `@:${s.name}`
    if (skip?.has(prop) || items.some((i) => lastSegOf(i.prop)?.kind === 'state' && i.prop === prop)) continue
    all.push({ key: prop, value: prop, label: propLabel(prop, { t }), detail: stateHint(s.name), icon: Calculator })
  }
  const rows = all.filter((r) => !k || r.label.toLowerCase().includes(k) || r.value.toLowerCase().includes(k))
  return { rows: rows.slice(0, 80), total: rows.length }
}

/**
 * 「按名字找一个属性加进来」：打名字从下拉里挑（属性、方法、Lua 字段、运行状态都在里面）。
 * 属性在更深的结构里、游戏没开读不到时，也能直接写一条路径（写法对才收）
 */
export function PropFind({
  items,
  onAdd,
  skip,
  placeholder,
  className,
}: {
  items: GtPropItem[]
  onAdd: (prop: string, item?: GtPropItem) => void
  /** 已经加过的，不再列 */
  skip?: Set<string>
  placeholder?: string
  className?: string
}) {
  const { ui, cn } = h()
  const [draft, setDraft] = useState('')
  const byProp = new Map(items.map((i) => [i.prop, i]))
  const known = (v: string) => byProp.has(v) || GT_STATES.some((s) => `@:${s.name}` === v)
  const p = draft.trim() ? parsePropPath(draft.trim()) : undefined
  const typed = p && !('error' in p) && p.segs.length > 0 && lastSegOf(draft.trim())?.kind !== 'child'
  return (
    <div className={cn('ue:flex ue:items-center ue:gap-1.5', className)}>
      <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <SuggestInput
        className="ue:min-w-0 ue:flex-1"
        value={draft}
        onChange={(v) => {
          // 从下拉里挑中的是路径本身：直接加进来、清空输入框；其余是在打字
          if (known(v)) {
            onAdd(v, byProp.get(v))
            setDraft('')
          } else setDraft(v)
        }}
        suggest={(q) => rowsOf(items, q, skip)}
        placeholder={placeholder ?? t('按名字找一个属性加进来')}
        empty={t('没有叫这个的（游戏没开、类里没读到）')}
      />
      {typed && (
        <ui.Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onAdd(draft.trim())
            setDraft('')
          }}
        >
          {t('按写法加')}
        </ui.Button>
      )}
    </div>
  )
}
