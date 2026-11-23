import { ExternalLink, Minus, Pencil, Plus, SquareFunction, Workflow } from 'lucide-react'
import { useRef, useState } from 'react'
import { UnifiedDiff } from '@panel/web/src/components/ui/UnifiedDiff'
import type { GraphDiff, NodeMod, SnapNode } from '../../shared/asset-diff/types.ts'
import { h, t } from '../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Mark } from './PropGrid.tsx'

/**
 * 「蓝图图表」页签：左边是图（只看变化时只列有变化的），右边上面一排节点的增删改，下面是按执行线写成的伪代码逐行比
 * （行尾是节点 id，和 ue_blueprint 读到的一样）。「在编辑器里打开」只能开当前版本，旧版本只在这里看
 */
export function GraphPane({
  graphs,
  only,
  onOpenGraph,
}: {
  graphs: GraphDiff[]
  only: boolean
  onOpenGraph?: (graph: string) => void
}) {
  const { cn, ui } = h()
  const list = only ? graphs.filter((g) => g.change !== 'same') : graphs
  const [picked, setPicked] = useState('')
  const sel = list.find((g) => g.name === picked) ?? list[0]
  const pane = usePane('asset-diff.graphs', '24%', 180)
  const ref = useRef<HTMLElement>(null)
  if (!sel) return <p className="ue:p-6 ue:text-body ue:text-subtle">{t('蓝图图表没变')}</p>
  const rows = sel.lines.map((l) =>
    l.kind === 'hunk' ? { kind: 'hunk' as const, text: l.n ? t('⋯ 第 {n} 行', { n: l.n }) : '⋯' } : l,
  )
  return (
    <div className={cn(SPLIT_ROW, 'ue:min-h-0 ue:flex-1')}>
      <section
        ref={ref}
        className={cn(PANE_FIXED, 'ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto')}
        style={pane.style('60%')}
      >
        <div className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:px-3 ue:text-caption ue:text-subtle">
          {t('图表')}
          {only && <span className="ue:ml-auto">{t('只列有变化的')}</span>}
        </div>
        <div className="ue:flex ue:flex-col ue:gap-px ue:px-1.5 ue:pb-2 ue:text-footnote">
          {list.map((g) => {
            const Icon = g.kind === 'function' || g.kind === 'macro' ? SquareFunction : Workflow
            return (
              <button
                key={g.name}
                type="button"
                onClick={() => setPicked(g.name)}
                className={cn(
                  'ue:flex ue:h-7 ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:px-1.5 ue:text-left ue:hover:bg-hover',
                  g === sel && 'ue:bg-sel ue:hover:bg-sel',
                  g.change === 'same' && 'ue:text-subtle',
                )}
              >
                <Icon className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                <span
                  className={cn(
                    'ue:min-w-0 ue:truncate ue:font-mono',
                    g.change === 'add' && 'ue:text-(--c-grid-added)',
                    g.change === 'del' && 'ue:text-(--c-grid-removed) ue:line-through',
                  )}
                >
                  {g.name}
                </span>
                <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{kindLabel(g.kind)}</span>
                <span className="ue:ml-auto ue:flex ue:shrink-0 ue:gap-1">
                  {g.change === 'add' ? (
                    <Mark kind="add">{t('新加')}</Mark>
                  ) : g.change === 'del' ? (
                    <Mark kind="del">{t('删掉')}</Mark>
                  ) : g.change === 'same' ? (
                    <span className="ue:text-caption">{t('没变')}</span>
                  ) : (
                    <>
                      {g.added.length > 0 && <Mark kind="add">+{g.added.length}</Mark>}
                      {g.removed.length > 0 && <Mark kind="del">−{g.removed.length}</Mark>}
                      {g.modified.length > 0 && <Mark kind="mod">{t('改 {n}', { n: g.modified.length })}</Mark>}
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      <SplitHandle pane={pane} paneRef={ref} reserve={() => 360} />
      <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto')}>
        <div className="ue:flex ue:shrink-0 ue:flex-wrap ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-3 ue:py-2">
          {sel.added.map((n) => (
            <NodeChip key={n.guid} kind="add" node={n} />
          ))}
          {sel.removed.map((n) => (
            <NodeChip key={n.guid} kind="del" node={n} />
          ))}
          {sel.modified.map((m) => (
            <ModChip key={m.id} mod={m} />
          ))}
          {!sel.added.length && !sel.removed.length && !sel.modified.length && (
            <span className="ue:text-footnote ue:text-subtle">{t('节点没有增删改')}</span>
          )}
          {onOpenGraph && sel.change !== 'del' && (
            <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={() => onOpenGraph(sel.name)}>
              <ExternalLink className="ue:h-3.5 ue:w-3.5" />
              {t('在编辑器里打开')}
            </ui.Button>
          )}
        </div>
        <p className="ue:shrink-0 ue:border-b ue:border-line ue:bg-sel ue:px-3 ue:py-1.5 ue:text-footnote ue:text-muted">
          {t('按执行线写成伪代码再逐行比；行尾是节点 id')}
        </p>
        {rows.some((r) => r.kind === 'add' || r.kind === 'del') ? (
          <UnifiedDiff rows={rows} wrap={false} className="ue:min-h-0 ue:flex-1" label={sel.name} />
        ) : (
          <p className="ue:p-4 ue:text-footnote ue:text-subtle">
            {t('伪代码没变：改的是没连在执行线上的节点、节点位置或注释')}
          </p>
        )}
      </section>
    </div>
  )
}

function kindLabel(k: string) {
  return (
    (
      {
        event: t('事件图'),
        function: t('函数'),
        macro: t('宏'),
        delegate: t('委托'),
        interface: t('接口'),
        sub: t('子图'),
      } as Record<string, string>
    )[k] ?? k
  )
}

const CHIP =
  'ue:inline-flex ue:h-6 ue:max-w-full ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:px-2 ue:text-caption ue:whitespace-nowrap'

function NodeChip({ kind, node }: { kind: 'add' | 'del'; node: SnapNode }) {
  const { cn } = h()
  const Icon = kind === 'add' ? Plus : Minus
  const pins = Object.entries(node.pins ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  return (
    <span
      title={pins || undefined}
      className={cn(
        CHIP,
        kind === 'add'
          ? 'ue:bg-(--c-grid-added)/13 ue:text-(--c-grid-added)'
          : 'ue:bg-(--c-grid-removed)/12 ue:text-(--c-grid-removed)',
      )}
    >
      <Icon className="ue:h-3 ue:w-3 ue:shrink-0" />
      <span className="ue:truncate">{node.title}</span>
      <span className="ue:font-mono ue:opacity-70">{node.id}</span>
    </span>
  )
}

function ModChip({ mod }: { mod: NodeMod }) {
  const { cn } = h()
  const parts = [
    ...mod.pins.map((p) => `${p.pin} ${p.a ?? '∅'} → ${p.b ?? '∅'}`),
    ...(mod.linksAdd.length ? [t('连线 +{n}', { n: mod.linksAdd.length })] : []),
    ...(mod.linksDel.length ? [t('连线 −{n}', { n: mod.linksDel.length })] : []),
    ...(mod.commentA !== undefined ? [t('注释')] : []),
  ]
  const detail = [
    ...mod.pins.map((p) => `${p.pin}: ${p.a ?? '∅'} → ${p.b ?? '∅'}`),
    ...mod.linksAdd.map((l) => `+ ${l}`),
    ...mod.linksDel.map((l) => `− ${l}`),
    ...(mod.commentA !== undefined ? [`${t('注释')}: ${mod.commentA} → ${mod.commentB}`] : []),
  ].join('\n')
  return (
    <span title={detail} className={cn(CHIP, 'ue:bg-(--c-grid-edited)/14 ue:text-fg')}>
      <Pencil className="ue:h-3 ue:w-3 ue:shrink-0" />
      <span className="ue:truncate">
        {mod.title}
        {parts.length > 0 && ` · ${parts.slice(0, 2).join(' · ')}`}
      </span>
      <span className="ue:font-mono ue:text-subtle">{mod.id}</span>
    </span>
  )
}
