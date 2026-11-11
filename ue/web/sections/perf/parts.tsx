import { ChevronRight } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { openMenu, type MenuItem } from './menu.tsx'

/**
 * 性能页共用的小部件（用户 2026-11-11：部件都做成组件、该有动效的加动效）。
 * 视图、右栏、树、表格都从这里拼，动效统一在这里：标签下划线滑入、树展开、比例条长出来、加载占位闪光。
 */

/** 一组标签：选中的那个下面一条强调色的线，切换时线从中间展开 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  aside,
}: {
  items: { key: K; label: ReactNode; count?: number }[]
  value: K
  onChange: (k: K) => void
  aside?: ReactNode
}) {
  const { cn } = h()
  return (
    <div
      role="tablist"
      className="ue:flex ue:h-9 ue:shrink-0 ue:items-stretch ue:gap-1 ue:border-b ue:border-line ue:px-2"
    >
      {items.map((x) => {
        const on = x.key === value
        return (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(x.key)}
            className={cn(
              'ue:relative ue:flex ue:items-center ue:gap-1.5 ue:rounded-md ue:px-2.5 ue:text-footnote ue:transition-colors ue:duration-150',
              on ? 'ue:font-medium ue:text-fg' : 'ue:text-subtle ue:hover:text-fg',
            )}
          >
            {x.label}
            {x.count !== undefined && (
              <span className="ue:rounded-sm ue:bg-hover ue:px-1 ue:font-mono ue:text-[10.5px] ue:text-muted">
                {x.count}
              </span>
            )}
            <span
              className={cn(
                'ue:absolute ue:inset-x-2 ue:-bottom-px ue:h-0.5 ue:origin-center ue:rounded-full ue:bg-accent ue:transition-transform ue:duration-200',
                on ? 'ue:scale-x-100' : 'ue:scale-x-0',
              )}
            />
          </button>
        )
      })}
      {aside && <div className="ue:ml-auto ue:flex ue:items-center ue:gap-2">{aside}</div>}
    </div>
  )
}

/** 小号分段开关（调用者 / 被调用者、列切换）：选中块滑到选中项的位置 */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: ReactNode }[]
  value: K
  onChange: (k: K) => void
}) {
  const { cn } = h()
  const i = Math.max(
    0,
    items.findIndex((x) => x.key === value),
  )
  return (
    <div className="ue:relative ue:inline-grid ue:auto-cols-fr ue:grid-flow-col ue:rounded-md ue:bg-hover ue:p-0.5 ue:text-caption">
      <span
        aria-hidden
        className="ue:absolute ue:inset-y-0.5 ue:left-0.5 ue:rounded ue:bg-card ue:shadow-sm ue:transition-transform ue:duration-200 ue:ease-out"
        style={{ width: `calc((100% - 4px) / ${items.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {items.map((x) => (
        <button
          key={x.key}
          type="button"
          onClick={() => onChange(x.key)}
          className={cn(
            'ue:relative ue:z-10 ue:px-2.5 ue:py-0.5 ue:whitespace-nowrap ue:transition-colors',
            x.key === value ? 'ue:font-medium ue:text-fg' : 'ue:text-subtle ue:hover:text-fg',
          )}
        >
          {x.label}
        </button>
      ))}
    </div>
  )
}

/** 占比条：宽度变化时平滑过渡（换范围、换计时器时条会长出来 / 缩回去） */
export function PctBar({
  pct,
  tone = 'accent',
  className,
}: {
  pct: number
  tone?: 'accent' | 'danger' | 'warn'
  className?: string
}) {
  const { cn } = h()
  const fill = tone === 'danger' ? 'ue:bg-danger/70' : tone === 'warn' ? 'ue:bg-warning/80' : 'ue:bg-accent/60'
  return (
    <span className={cn('ue:block ue:h-1 ue:overflow-hidden ue:rounded-full ue:bg-hover', className)}>
      <span
        className={cn('ue:block ue:h-full ue:rounded-full ue:transition-[width] ue:duration-300 ue:ease-out', fill)}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </span>
  )
}

/** 加载占位：几条闪光的灰条，比一行「正在加载」更能看出版面 */
export function Skeleton({ rows = 4, note }: { rows?: number; note?: ReactNode }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:p-4 ue:motion-safe:animate-fade">
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="ue:block ue:h-3 ue:rounded ue:bg-[linear-gradient(90deg,var(--hover)_25%,var(--line)_50%,var(--hover)_75%)] ue:bg-[length:200%_100%] ue:motion-safe:animate-shimmer"
          style={{ width: `${92 - ((i * 17) % 40)}%` }}
        />
      ))}
      {note && <div className="ue:mt-1 ue:text-footnote ue:text-subtle">{note}</div>}
    </div>
  )
}

/** 空状态：一句话，居中，淡入 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-6 ue:text-center ue:text-footnote ue:text-subtle ue:motion-safe:animate-fade">
      {children}
    </div>
  )
}

/** 面板里的一块：小标题 + 右侧操作 + 内容（右栏上下两块、时间轴卡片都用它） */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  const { cn } = h()
  return (
    <section className={cn('ue:flex ue:min-h-0 ue:min-w-0 ue:flex-col', className)}>
      <header className="ue:flex ue:h-9 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3">
        <div className="ue:min-w-0 ue:truncate ue:text-footnote ue:font-medium ue:text-fg">{title}</div>
        {aside && <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

export interface TreeNode {
  id: number
  name: string
  count: number
  incl: number
  /** 独占时间：桥接 1.5.0 起有 */
  excl?: number
  children?: TreeNode[]
  more?: number
}

/** 调用树的列（Insights 的 Callers / Callees）：名字、次数、包含、占父、占根、独占 */
export const TREE_COLS = 'ue:grid-cols-[minmax(0,1fr)_36px_56px_44px_44px_56px]'

type Expand = 'auto' | 'all' | 'none'

/**
 * 调用树（调用者 / 被调用者）：每行名字、次数、包含时间、占父节点 / 根节点的比例和独占时间。
 * 默认展开前两层；展开的子树从上方滑入，箭头转 90°。右键行出菜单（onMenu 由使用方给，Tree 自己补「全部展开 / 收起」）。
 */
export function Tree({
  root,
  onPick,
  picked,
  onMenu,
}: {
  root: TreeNode
  onPick?: (n: TreeNode) => void
  picked?: number
  onMenu?: (e: MouseEvent, n: TreeNode, extra: MenuItem[]) => void
}) {
  // 换展开方式时整棵树按新方式重建（key 变了）
  const [mode, setMode] = useState<{ m: Expand; v: number }>({ m: 'auto', v: 0 })
  const extra: MenuItem[] = [
    { label: t('全部展开'), onClick: () => setMode((x) => ({ m: 'all', v: x.v + 1 })) },
    { label: t('全部收起'), onClick: () => setMode((x) => ({ m: 'none', v: x.v + 1 })) },
  ]
  return (
    <div
      role="tree"
      className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1 ue:text-footnote"
      onContextMenu={(e) => onMenu && openMenu(e, extra)}
    >
      <TreeRow
        key={mode.v}
        node={root}
        parent={undefined}
        depth={0}
        total={root.incl || 1}
        onPick={onPick}
        picked={picked}
        mode={mode.m}
        onMenu={onMenu && ((e, n) => onMenu(e, n, extra))}
      />
    </div>
  )
}

function TreeRow({
  node,
  parent,
  depth,
  total,
  onPick,
  picked,
  mode,
  onMenu,
}: {
  node: TreeNode
  parent?: TreeNode
  depth: number
  total: number
  onPick?: (n: TreeNode) => void
  picked?: number
  mode: Expand
  onMenu?: (e: MouseEvent, n: TreeNode) => void
}) {
  const { cn } = h()
  const kids = node.children ?? []
  const [open, setOpen] = useState(mode === 'all' || (mode === 'auto' && depth < 2) || depth === 0)
  const pRoot = (node.incl / total) * 100
  const pParent = parent ? (node.incl / Math.max(parent.incl, 1e-9)) * 100 : 100
  const pct = (v: number) => (v >= 99.95 ? '100%' : `${v.toFixed(v < 10 ? 2 : 1)}%`)
  return (
    <div role="treeitem" aria-expanded={kids.length ? open : undefined}>
      <div
        className={cn(
          'ue:group ue:relative ue:grid ue:cursor-default ue:items-center ue:gap-2 ue:py-[3px] ue:pr-3 ue:transition-colors ue:hover:bg-hover',
          TREE_COLS,
          picked === node.id && depth > 0 && 'ue:bg-sel',
        )}
        style={{ paddingLeft: 6 + Math.min(depth, 24) * 10 }}
        onDoubleClick={() => onPick?.(node)}
        onContextMenu={(e) => onMenu?.(e, node)}
        title={[
          node.name,
          `${t('次数')} ${node.count.toLocaleString()}`,
          `${t('包含')} ${fmtMs(node.incl)} · ${t('平均')} ${fmtMs(node.incl / Math.max(1, node.count))}`,
          node.excl !== undefined ? `${t('独占')} ${fmtMs(node.excl)}` : '',
          parent ? `${t('占父')} ${pct(pParent)}（${parent.name}）` : '',
          `${t('占根')} ${pct(pRoot)}`,
        ]
          .filter(Boolean)
          .join('\n')}
      >
        {/* 行底一条淡的占根比例条（和计时器表一样），比单独一列进度条省地方 */}
        <span
          aria-hidden
          className="ue:pointer-events-none ue:absolute ue:inset-y-0 ue:left-0 ue:bg-accent/8 ue:transition-[width] ue:duration-300"
          style={{ width: `${Math.min(100, pRoot)}%` }}
        />
        <span className="ue:relative ue:flex ue:min-w-0 ue:items-center ue:gap-1">
          <button
            type="button"
            aria-label={open ? t('收起') : t('展开')}
            disabled={!kids.length}
            onClick={() => setOpen((o) => !o)}
            className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:items-center ue:justify-center ue:rounded ue:text-subtle ue:hover:text-fg ue:disabled:opacity-0"
          >
            <ChevronRight
              className={cn('ue:h-3 ue:w-3 ue:transition-transform ue:duration-150', open && 'ue:rotate-90')}
            />
          </button>
          <button
            type="button"
            onClick={() => onPick?.(node)}
            className={cn(
              'ue:min-w-0 ue:truncate ue:text-left',
              depth === 0 ? 'ue:font-medium ue:text-fg' : 'ue:text-muted ue:group-hover:text-fg',
            )}
          >
            {node.name}
          </button>
        </span>
        <span className="ue:relative ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
          {node.count.toLocaleString()}
        </span>
        <span className="ue:relative ue:text-right ue:font-mono ue:text-caption ue:text-fg ue:tabular-nums">
          {fmtMs(node.incl)}
        </span>
        <span className="ue:relative ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
          {parent ? pct(pParent) : ''}
        </span>
        <span className="ue:relative ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
          {pct(pRoot)}
        </span>
        <span className="ue:relative ue:text-right ue:font-mono ue:text-caption ue:text-muted ue:tabular-nums">
          {node.excl !== undefined ? fmtMs(node.excl) : '—'}
        </span>
      </div>
      {open && kids.length > 0 && (
        <div role="group" className="ue:motion-safe:animate-rise">
          {kids.map((k) => (
            <TreeRow
              key={k.id}
              node={k}
              parent={node}
              depth={depth + 1}
              total={total}
              onPick={onPick}
              picked={picked}
              mode={mode}
              onMenu={onMenu}
            />
          ))}
          {!!node.more && (
            <div
              className="ue:py-[3px] ue:text-caption ue:text-subtle"
              style={{ paddingLeft: 26 + Math.min(depth + 1, 24) * 10 }}
            >
              {t('还有 {n} 项', { n: node.more })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 毫秒：小于 1 毫秒写微秒，大于 1 秒写秒，和 Insights 的读法一样 */
export function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 10) return `${ms.toFixed(1)} ms`
  if (ms >= 1) return `${ms.toFixed(2)} ms`
  return `${Math.round(ms * 1000)} µs`
}

/** 秒（时间轴上的时间点）：相对 trace 开头 */
export function fmtAt(s: number) {
  if (s >= 60) return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`
  return `${s.toFixed(3)} s`
}
