import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import {
  getAt,
  listRows,
  move,
  pathStr,
  placeOf,
  samePath,
  slotsOf,
  type GtPath,
  type GtStep,
  type ListRow,
} from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '@panel/web/src/components/ui/item-menu'
import { blockUi, TONE_BAR, TONE_TEXT } from '../gt-blocks/index.ts'
import { condSummary } from '../gt-cond/summary.ts'
import { BreakpointDot } from '../gt-debug/BreakpointDot.tsx'
import { commandMenuItems, runKey, type CmdCtx } from './commands.ts'
import { insertPlace, insertStep, openInsertAt, insertMenuItems } from './insert-menu.ts'
import { foldableKeys, ListHead } from './ListHead.tsx'
import { PHASE_ORDER } from '../gt-rows/phases.ts'
import { PHASE_META, PhaseSectionHead } from '../gt-rows/PhaseHead.tsx'
import { PhaseHint } from './PhaseHint.tsx'
import type { ViewProps } from './views.ts'

const INDENT = 18
const keyOf = (s: GtStep, p: GtPath) => (typeof s.id === 'string' && s.id ? s.id : pathStr(p))

/**
 * 列表视图（定稿 9.2、效果图 1）：缩进 + 左边色条表示在哪个块里，块可以折叠；否则如果 / 否则是分隔行。
 * 键盘为主：↑↓ 选、Tab / Shift+Tab 进出块、Ctrl+G 包成段、Alt+↑↓ 挪、/ 或回车加一步、Delete 删；也能拖
 */
export function ListView({ doc, onChange, selected, onSelect, onTry, run }: ViewProps) {
  const { cn } = h()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<GtPath>()
  const [over, setOver] = useState<string>()
  const box = useRef<HTMLDivElement>(null)
  const sections = useMemo(
    () =>
      // 三段（执行前 / 执行 / 执行后）在每个脚本里都在，空的运行时跳过（用户 2026-11-27）
      PHASE_ORDER.map((kind) => ({ slot: [kind], kind, rows: listRows(doc, [kind], kind, collapsed) })),
    [doc, collapsed],
  )
  const stepRows = sections.flatMap((s) => s.rows).filter((r) => r.kind === 'step')
  const isSel = (p: GtPath) => selected.some((x) => samePath(x, p))

  const ctx: CmdCtx = {
    doc,
    selected,
    apply: onChange,
    select: onSelect,
    onTry,
    openInsert: () => openInsertAt(box.current?.querySelector('[data-sel="1"]') ?? box.current, pick),
  }
  function pick(it: { make: () => GtStep }) {
    const { slot, index } = insertPlace(doc, selected[0])
    onChange(insertStep(doc, slot, index, it.make()))
  }

  const toggle = (k: string) => {
    const next = new Set(collapsed)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setCollapsed(next)
  }

  const click = (e: React.MouseEvent, p: GtPath) => {
    box.current?.focus()
    if (e.ctrlKey || e.metaKey) return onSelect(isSel(p) ? selected.filter((x) => !samePath(x, p)) : [...selected, p])
    if (e.shiftKey && selected.length) {
      const a = stepRows.findIndex((r) => samePath(r.path, selected[0]))
      const b = stepRows.findIndex((r) => samePath(r.path, p))
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        return onSelect([
          selected[0],
          ...stepRows
            .slice(lo, hi + 1)
            .map((r) => r.path)
            .filter((x) => !samePath(x, selected[0])),
        ])
      }
    }
    onSelect([p])
  }

  const key = (e: React.KeyboardEvent) => {
    if (runKey(e, ctx)) return
    const i = stepRows.findIndex((r) => selected[0] && samePath(r.path, selected[0]))
    const cur = stepRows[i]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const j = Math.max(0, Math.min(stepRows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
      if (stepRows[j]) onSelect([stepRows[j].path])
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && cur?.kind === 'step' && slotsOf(cur.step).length) {
      const k = keyOf(cur.step, cur.path)
      if (collapsed.has(k) === (e.key === 'ArrowRight')) toggle(k)
    } else if (e.key === 'Escape') onSelect([])
  }

  const rowMenu = (e: React.MouseEvent, p: GtPath) => {
    e.preventDefault()
    if (!isSel(p)) onSelect([p])
    const c = { ...ctx, selected: isSel(p) ? selected : [p] }
    openMenu(e, commandMenuItems(c))
  }

  const drop = (slot: GtPath, index: number) => {
    if (drag) onChange(move(doc, drag, slot, index), t('不能挪进自己里面'))
    setDrag(undefined)
    setOver(undefined)
  }

  const bars = (list: string[]) =>
    list.map((a, k) => (
      <span
        key={k}
        className={cn('ue:absolute ue:top-0 ue:bottom-0 ue:w-[2px]', TONE_BAR[blockUi(a).tone])}
        style={{ left: 10 + k * INDENT }}
      />
    ))

  const row = (r: ListRow) => {
    const pad = { paddingLeft: 14 + r.depth * INDENT }
    if (r.kind === 'empty')
      return (
        <div
          key={`e:${pathStr(r.path)}`}
          className={cn(
            'ue:relative ue:flex ue:h-7 ue:items-center ue:text-caption ue:text-subtle',
            over === `e:${pathStr(r.path)}` && 'ue:bg-accent/8',
          )}
          style={pad}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(`e:${pathStr(r.path)}`)
          }}
          onDrop={() => drop(r.path, 0)}
        >
          {bars(r.bars)}
          <button
            type="button"
            className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-sm ue:px-1 ue:hover:text-fg"
            onClick={(e) =>
              openMenu(
                e,
                insertMenuItems((it) => onChange(insertStep(doc, r.path, 0, it.make()))),
              )
            }
          >
            <Plus className="ue:h-3 ue:w-3" />
            {t('空的，加一步')}
          </button>
        </div>
      )
    if (r.kind === 'slot') {
      const owner = getAt(doc, r.owner) as GtStep
      const cond = r.slotKind === 'elif' ? (getAt(doc, r.path.slice(0, -1)) as { cond?: unknown })?.cond : undefined
      return (
        <div
          key={`s:${pathStr(r.path)}`}
          className="ue:relative ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote"
          style={pad}
          onClick={(e) => click(e, r.owner)}
        >
          {bars(r.bars.slice(0, -1))}
          <span className={cn('ue:font-medium', TONE_TEXT[blockUi(owner.action).tone])}>
            {r.slotKind === 'else' ? (owner.branch === 'state' ? t('其余情况') : t('否则')) : t('否则如果')}
          </span>
          {cond !== undefined && <span className="ue:truncate ue:text-subtle">{condSummary(cond)}</span>}
        </div>
      )
    }
    const ui = blockUi(r.step.action)
    const Icon = ui.icon
    const k = keyOf(r.step, r.path)
    const sel = isSel(r.path)
    const block = slotsOf(r.step).length > 0
    const st = run?.status?.[k]
    const id = `r:${pathStr(r.path)}`
    const named = typeof r.step.title === 'string' ? r.step.title.trim() : ''
    const summary = ui.summary(r.step)
    return (
      <div
        key={id}
        data-sel={sel && samePath(r.path, selected[0]) ? '1' : undefined}
        draggable
        onDragStart={() => setDrag(r.path)}
        onDragEnd={() => {
          setDrag(undefined)
          setOver(undefined)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(id)
        }}
        onDrop={() => {
          const p = placeOf(doc, r.path)
          if (p) drop(p.slot, p.index)
        }}
        onClick={(e) => click(e, r.path)}
        onDoubleClick={() => block && toggle(k)}
        onContextMenu={(e) => rowMenu(e, r.path)}
        className={cn(
          'ue:group ue:relative ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-2 ue:pr-2 ue:text-footnote',
          sel ? 'ue:bg-sel' : 'ue:hover:bg-hover',
          over === id && drag && 'ue:shadow-[inset_0_2px_0_var(--accent)]',
          r.step.disabled === true && 'ue:opacity-50',
          run?.at === k && 'ue:bg-run/10',
        )}
        style={pad}
      >
        {bars(r.bars)}
        {block ? (
          <button
            type="button"
            aria-label={r.collapsed ? t('展开') : t('收起')}
            className="ue:-ml-4 ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:text-subtle"
            onClick={(e) => {
              e.stopPropagation()
              toggle(k)
            }}
          >
            {r.collapsed ? (
              <ChevronRight className="ue:h-3.5 ue:w-3.5" />
            ) : (
              <ChevronDown className="ue:h-3.5 ue:w-3.5" />
            )}
          </button>
        ) : null}
        <BreakpointDot k={k} inline />
        <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', TONE_TEXT[ui.tone])} />
        {/* 写了名称（title）的先显示名称：块（如执行前的「准备环境」「前置检测」两组）替掉种类名，
            单步（接口、调用这些摘要不看名称的）把摘要退到后面淡色显示 */}
        {(block || named) && (
          <span className="ue:shrink-0 ue:font-medium ue:text-fg" title={named && block ? ui.title() : undefined}>
            {named || ui.title()}
          </span>
        )}
        {(block || summary !== named) && (
          <span className={cn('ue:min-w-0 ue:truncate', block || named ? 'ue:text-subtle' : 'ue:text-fg')}>
            {summary}
          </span>
        )}
        {r.collapsed && (
          <span className="ue:shrink-0 ue:text-caption ue:text-subtle">
            {t('（收起了 {n} 步）', { n: r.hidden ?? 0 })}
          </span>
        )}
        {typeof r.step.note === 'string' && r.step.note && (
          <span className="ue:min-w-0 ue:shrink ue:truncate ue:text-caption ue:text-subtle">· {r.step.note}</span>
        )}
        <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1.5">
          {st && (
            <span
              className={cn(
                'ue:h-2 ue:w-2 ue:rounded-full',
                st === 'ok' && 'ue:bg-success',
                st === 'fail' && 'ue:bg-danger',
                st === 'run' && 'ue:bg-run ue:animate-pulse',
                st === 'skip' && 'ue:bg-line',
              )}
            />
          )}
          {r.step.onFail === 'continue' && <span className="ue:text-caption ue:text-warning">{t('失败接着走')}</span>}
          <span className="ue:font-mono ue:text-caption ue:text-subtle">
            {typeof r.step.id === 'string' ? r.step.id : ''}
          </span>
          <button
            type="button"
            aria-label={t('在下面加一步')}
            className="ue:invisible ue:flex ue:h-5 ue:w-5 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-sm ue:text-subtle ue:group-hover:visible ue:hover:bg-hover ue:hover:text-fg"
            onClick={(e) => {
              e.stopPropagation()
              onSelect([r.path])
              const p = placeOf(doc, r.path)
              if (p)
                openMenu(
                  e,
                  insertMenuItems((it) => onChange(insertStep(doc, p.slot, p.index + 1, it.make()))),
                )
            }}
          >
            <Plus className="ue:h-3.5 ue:w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('更多')}
            className="ue:invisible ue:flex ue:h-5 ue:w-5 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-sm ue:text-subtle ue:group-hover:visible ue:hover:bg-hover ue:hover:text-fg"
            onClick={(e) => {
              e.stopPropagation()
              rowMenu(e, r.path)
            }}
          >
            <MoreHorizontal className="ue:h-3.5 ue:w-3.5" />
          </button>
        </span>
      </div>
    )
  }

  const endOf = (slot: GtPath) => ((getAt(doc, slot) as unknown[] | undefined) ?? []).length
  // 在槽里某个位置插一步：从鼠标处弹插入菜单
  const insertAt = (e: React.MouseEvent, slot: GtPath, index: number) =>
    openMenu(
      e,
      insertMenuItems((it) => onChange(insertStep(doc, slot, index, it.make()))),
    )
  // 全部折叠 = 把每个块的 key 放进折叠集合；全部展开 = 清空（和逐个点的、左右键的是同一份状态）
  const anyFolded = collapsed.size > 0
  const foldAll = (fold: boolean) => setCollapsed(new Set(fold ? foldableKeys(doc) : []))

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <ListHead doc={doc} anyFolded={anyFolded} onFoldAll={foldAll} />
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={key}
        className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:pb-10 ue:outline-none"
        aria-label={t('步骤列表')}
      >
        {sections.map((s) => (
          <section key={s.kind} data-gt-section={s.kind}>
            <PhaseSectionHead phase={s.kind} count={endOf(s.slot)} />
            {s.kind === 'steps' && <PhaseHint doc={doc} onChange={(d) => onChange(d)} />}
            {s.rows.map(row)}
            <div
              className={cn(
                'ue:flex ue:h-8 ue:items-center ue:gap-3 ue:px-3',
                over === `end:${s.kind}` && 'ue:shadow-[inset_0_2px_0_var(--accent)]',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(`end:${s.kind}`)
              }}
              onDrop={() => drop(s.slot, endOf(s.slot))}
            >
              {!s.rows.length && <span className="ue:text-caption ue:text-subtle">{t('没有步骤，运行时跳过')}</span>}
              <button
                type="button"
                className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-sm ue:px-1 ue:text-caption ue:text-subtle ue:hover:text-fg"
                onClick={(e) => insertAt(e, s.slot, endOf(s.slot))}
              >
                <Plus className="ue:h-3 ue:w-3" />
                {PHASE_META[s.kind].add()}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
