import { memo, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import { Plus, X } from 'lucide-react'
import { h, t } from '../../../../host.ts'
import { callCopy } from '../../gt-edit/call-copy.ts'
import { canDrop, readDrop, wantsCopy } from '../dnd.ts'
import { useBp } from './ctx.ts'
import type { BpEdge } from './graph.ts'

export type BpEdgeData = { edge: BpEdge }

const STROKE = { idle: 'var(--muted)', run: 'var(--run)', done: 'var(--success)' }

/** 运行中的线色：起点做完、终点也走到是走过的路（绿），终点正在跑（青），其余灰 */
function useTone(from: string, to: string) {
  const { run } = useBp()
  const a = run.steps[from]?.status
  const b = run.steps[to]?.status
  const done = (s?: string) => s === 'passed' || s === 'already' || s === 'skipped'
  if (b === 'running' && (done(a) || !a)) return 'run'
  if (done(a) && b) return 'done'
  return 'idle'
}

/**
 * 执行线：蓝图那样的曲线。鼠标移上去中间出「+」（点了弹节点菜单插在这里，也能把节点、脚本拖上来松手）和「✕」（断开）
 */
export const BpEdgeView = memo(function BpEdgeView(p: EdgeProps<Edge<BpEdgeData>>) {
  const e = p.data!.edge
  const { editable, insertAt, disconnect } = useBp()
  const { cn, toast } = h()
  const tone = useTone(e.from, e.to)
  const [hover, setHover] = useState(false)
  const [over, setOver] = useState(false)
  const [path, lx, ly] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
    curvature: 0.35,
  })
  const btn =
    'nodrag nopan ue:pointer-events-auto ue:flex ue:h-5 ue:w-5 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-full ue:bg-card ue:text-subtle ue:shadow-card ue:hover:text-fg'
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        interactionWidth={18}
        style={{ stroke: STROKE[tone], strokeWidth: tone === 'idle' ? 1.6 : 2.2, opacity: tone === 'idle' ? 0.8 : 1 }}
      />
      {/* 透明的粗线接住鼠标：移上去才出按钮，不挡画布 */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="ue:pointer-events-auto"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {editable && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'ue:absolute ue:flex ue:items-center ue:gap-1 ue:transition-opacity',
              hover || over ? 'ue:opacity-100' : 'ue:opacity-0 ue:hover:opacity-100',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all' }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <button
              type="button"
              aria-label={t('在这里插入')}
              title={t('在这里插入（也可以把节点、脚本拖到这里）')}
              className={cn(btn, over && 'ue:scale-125 ue:bg-accent-soft ue:text-accent-text')}
              onClick={(ev) => {
                ev.stopPropagation()
                insertAt(e.at, undefined, { x: ev.clientX, y: ev.clientY })
              }}
              onDragOver={(ev) => {
                if (!canDrop(ev)) return
                ev.preventDefault()
                ev.dataTransfer.dropEffect = 'copy'
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(ev) => {
                setOver(false)
                const steps = readDrop(ev)
                if (!steps) return
                ev.preventDefault()
                ev.stopPropagation()
                if (wantsCopy(ev) && steps.length === 1 && steps[0].action === 'call')
                  return void callCopy(steps[0]).then(
                    (r) => {
                      insertAt(e.at, [r.group])
                      if (r.warn) toast.error(r.warn)
                    },
                    (err: Error) => toast.error(err.message),
                  )
                insertAt(e.at, steps)
              }}
            >
              <Plus className="ue:h-3 ue:w-3" />
            </button>
            <button
              type="button"
              aria-label={t('断开')}
              title={t('断开：后面那串留在画布上，不再执行（也可以 Alt 点引脚）')}
              className={btn}
              onClick={(ev) => {
                ev.stopPropagation()
                disconnect(e.at)
              }}
            >
              <X className="ue:h-3 ue:w-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

/** 拖线到空白处、菜单还开着时那根线：样子和拖动时的连接线一样，一直连到菜单，选完接上、取消才消失 */
const BpPendingEdge = memo(function BpPendingEdge(p: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
  })
  return (
    <BaseEdge
      id={p.id}
      path={path}
      interactionWidth={0}
      style={{ stroke: 'var(--xy-connectionline-stroke, var(--accent))', strokeWidth: 1.5 }}
    />
  )
})

/**
 * 三段事件之间的竖向虚线：执行前 → 执行标「通过后」，执行 → 执行后标「不论结果」（用户 2026-11-27 看效果图定的），
 * 只说明先后和「执行后总会跑」，不能点、不能断开
 */
export const BpPhaseEdge = memo(function BpPhaseEdge(p: EdgeProps<Edge<{ label: string }>>) {
  const path = `M ${p.sourceX} ${p.sourceY} L ${p.targetX} ${p.targetY}`
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        style={{ stroke: 'var(--muted)', strokeWidth: 1.4, strokeDasharray: '5 5', opacity: 0.6 }}
      />
      <EdgeLabelRenderer>
        <div
          className="ue:pointer-events-none ue:absolute ue:rounded-sm ue:px-1.5 ue:text-caption ue:text-subtle"
          style={{
            transform: `translate(8px, -50%) translate(${p.sourceX}px, ${(p.sourceY + p.targetY) / 2}px)`,
            background: 'var(--canvas, transparent)',
          }}
        >
          {p.data?.label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

export const BP_EDGE_TYPES = { bp: BpEdgeView, pending: BpPendingEdge, phase: BpPhaseEdge }
