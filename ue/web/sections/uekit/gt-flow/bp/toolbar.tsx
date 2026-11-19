import { useEffect, useMemo, useRef, useState } from 'react'
import { useNodes, useReactFlow, useViewport, type Node } from '@xyflow/react'
import {
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Map as MapIcon,
  Search,
  X,
} from 'lucide-react'
import { CanvasToolbarSep } from '@panel/web/src/components/flow/GraphCanvas'
import { h, t } from '../../../../host.ts'
import { stepTitle } from '../../gt-step-title.ts'
import type { BpNode } from './graph.ts'

/**
 * 流程图底部工具条的扩展（用户 2026-11-19 让挑着加）：缩放百分比、多选对齐和等间距、搜索节点、小地图开关。
 * 都要在 ReactFlow 里面才拿得到视口和选中，所以放在 CanvasToolbar 里渲染
 */

/** 当前缩放，点一下回到 100% */
export function ZoomReadout() {
  const { zoom } = useViewport()
  const rf = useReactFlow()
  return (
    <button
      type="button"
      className="ue:h-7 ue:min-w-12 ue:rounded-md ue:px-1.5 ue:font-mono ue:text-caption ue:text-subtle ue:hover:bg-sel ue:hover:text-fg"
      title={t('点一下回到 100%')}
      onClick={() => void rf.zoomTo(1, { duration: 150 })}
    >
      {Math.round(zoom * 100)}%
    </button>
  )
}

/** 选中的节点挪到哪：交给外壳存成位置（edit.ts moveNodes，后面没记位置的会钉住） */
export type MoveTo = { key: string; x: number; y: number }[]

const sizeOf = (n: Node) => ({ w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 })

/** 选中两个以上节点时出现：左对齐、顶对齐、横向等间距、纵向等间距 */
export function AlignTools({ onMove }: { onMove: (m: MoveTo) => void }) {
  const { IconButton } = h().ui
  const sel = useNodes().filter((n) => n.selected && n.draggable !== false)
  if (sel.length < 2) return null
  const put = (f: (n: Node, i: number, all: Node[]) => { x: number; y: number }, order?: 'x' | 'y') => {
    const all = order ? [...sel].sort((a, b) => a.position[order] - b.position[order]) : sel
    onMove(all.map((n, i) => ({ key: n.id, ...f(n, i, all) })))
  }
  const minX = Math.min(...sel.map((n) => n.position.x))
  const minY = Math.min(...sel.map((n) => n.position.y))
  /** 等间距：首尾不动，中间按节点宽高均分空隙 */
  const spread = (axis: 'x' | 'y') =>
    put((n, i, all) => {
      const dim = (m: Node) => (axis === 'x' ? sizeOf(m).w : sizeOf(m).h)
      const first = all[0].position[axis]
      const last = all[all.length - 1].position[axis] + dim(all[all.length - 1])
      const gap = (last - first - all.reduce((s, m) => s + dim(m), 0)) / (all.length - 1)
      const at = first + all.slice(0, i).reduce((s, m) => s + dim(m) + gap, 0)
      return axis === 'x' ? { x: at, y: n.position.y } : { x: n.position.x, y: at }
    }, axis)
  return (
    <>
      <CanvasToolbarSep />
      <IconButton
        icon={AlignStartVertical}
        size="sm"
        label={t('左对齐')}
        onClick={() => put((n) => ({ x: minX, y: n.position.y }))}
      />
      <IconButton
        icon={AlignStartHorizontal}
        size="sm"
        label={t('顶对齐')}
        onClick={() => put((n) => ({ x: n.position.x, y: minY }))}
      />
      {sel.length > 2 && (
        <>
          <IconButton
            icon={AlignHorizontalDistributeCenter}
            size="sm"
            label={t('横向等间距')}
            onClick={() => spread('x')}
          />
          <IconButton
            icon={AlignVerticalDistributeCenter}
            size="sm"
            label={t('纵向等间距')}
            onClick={() => spread('y')}
          />
        </>
      )}
    </>
  )
}

/** 节点能被搜到的文字：标题、说明、名字、控件、脚本、id */
function textOf(n: BpNode): string {
  const s = n.step
  const parts: unknown[] = [n.id]
  if (s) parts.push(stepTitle(s), s.note, s.name, s.target, s.script, s.action)
  if (n.guard) parts.push(n.guard.name, n.guard.id)
  if (n.note) parts.push(n.note.text)
  return parts
    .filter((x) => typeof x === 'string' && x)
    .join(' ')
    .toLowerCase()
}

/** 搜索节点：按标题、说明、控件路径搜，回车跳到下一个并选中 */
export function NodeSearch({
  open,
  setOpen,
  nodes,
  onPick,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  nodes: BpNode[]
  onPick: (n: BpNode) => void
}) {
  const { ui, cn } = h()
  const { IconButton } = ui
  const rf = useReactFlow()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  const hits = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return []
    return nodes.filter((n) => n.kind !== 'note' || n.note).filter((n) => textOf(n).includes(k))
  }, [q, nodes])
  const go = (i: number) => {
    if (!hits.length) return
    const n = hits[((i % hits.length) + hits.length) % hits.length]
    setAt(i)
    const rn = rf.getNode(n.id)
    const { w, h: ht } = rn ? sizeOf(rn) : { w: 0, h: 0 }
    void rf.setCenter(n.x + w / 2, n.y + ht / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 200 })
    onPick(n)
  }
  if (!open) return <IconButton icon={Search} size="sm" label={t('搜索节点（Ctrl+F）')} onClick={() => setOpen(true)} />
  return (
    <div className="ue:flex ue:items-center ue:gap-1">
      <Search className="ue:ml-1 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <input
        ref={input}
        value={q}
        spellCheck={false}
        placeholder={t('搜节点：标题、说明、控件')}
        className="ue:h-7 ue:w-44 ue:bg-transparent ue:text-footnote ue:text-fg ue:outline-none ue:placeholder:text-subtle"
        onChange={(e) => {
          setQ(e.target.value)
          setAt(-1)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') go(e.shiftKey ? Math.max(at, 0) - 1 : at + 1)
          else if (e.key === 'Escape') {
            setQ('')
            setOpen(false)
          }
        }}
      />
      <span className={cn('ue:min-w-10 ue:text-caption ue:text-subtle', !q && 'ue:invisible')}>
        {hits.length
          ? `${at < 0 ? 0 : (((at % hits.length) + hits.length) % hits.length) + 1}/${hits.length}`
          : t('没有')}
      </span>
      <IconButton
        icon={X}
        size="sm"
        label={t('关掉搜索')}
        onClick={() => {
          setQ('')
          setOpen(false)
        }}
      />
    </div>
  )
}

/** 小地图开关 */
export function MiniMapToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const { ui, cn } = h()
  return (
    <ui.IconButton
      icon={MapIcon}
      size="sm"
      label={on ? t('隐藏小地图') : t('显示小地图')}
      aria-pressed={on}
      className={cn(on && 'ue:bg-sel ue:text-fg')}
      onClick={() => onChange(!on)}
    />
  )
}

const MINI_KEY = 'ue.gt.flow.minimap'

/** 小地图开着没：记在本机浏览器里，存不了就默认开 */
export function useMiniMapPref(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(MINI_KEY) !== '0'
    } catch {
      return true
    }
  })
  return [
    on,
    (v) => {
      setOn(v)
      try {
        localStorage.setItem(MINI_KEY, v ? '1' : '0')
      } catch {
        // 存不了就只管这一次
      }
    },
  ]
}
