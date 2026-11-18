import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react'
import { h, t } from '../../../host.ts'
import { useFlow } from './ctx.ts'
import type { FlowEdge } from './layout.ts'
import { InsertButton } from './nodes/parts.tsx'

export type EdgeData = { edge: FlowEdge }

/** 分支线上的字：是 / 否则如果 / 否 */
function branchLabel(e: FlowEdge) {
  if (e.slotKind === 'then') return t('是')
  if (e.slotKind === 'elif') return t('否则如果 {n}', { n: (e.index ?? 0) + 1 })
  if (e.slotKind === 'else') return t('否')
  return ''
}

/**
 * 运行中的线色：起点做完了、终点也走到了就是走过的路（绿），终点正在跑是这一刻走的路（青），其余灰。
 * 如果的几条路只有走了的那条会亮
 */
function useTone(from: string, to: string) {
  const { run } = useFlow()
  const a = run.steps[from]?.status
  const b = run.steps[to.replace(/#merge$/, '')]?.status ?? run.steps[to]?.status
  const done = (s?: string) => s === 'passed' || s === 'already' || s === 'skipped'
  if (b === 'running' && (done(a) || !a)) return 'run'
  if (done(a) && b) return 'done'
  return 'idle'
}

const STROKE = { idle: 'var(--line-strong)', run: 'var(--run)', done: 'var(--success)' }

/**
 * 主流程、分支的连线：圆角折线 + 箭头；中间一个「+」（编辑时），点了插入、拖东西上来松手直接插；分支线上写「是 / 否」
 */
export const FlowEdgeView = memo(function FlowEdgeView(p: EdgeProps<Edge<EdgeData>>) {
  const e = p.data!.edge
  const tone = useTone(e.from, e.to)
  const [path, lx, ly] = getSmoothStepPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    targetX: p.targetX,
    targetY: p.targetY,
    sourcePosition: p.sourcePosition,
    targetPosition: p.targetPosition,
    borderRadius: 14,
    offset: 18,
  })
  const label = e.kind === 'branch' ? branchLabel(e) : ''
  // 分支线的字和「+」放在靠终点的那段横线上：起点那段几条线挤在一起
  const x = e.kind === 'branch' ? p.targetX - 30 : lx
  const y = e.kind === 'branch' ? p.targetY : ly
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        style={{ stroke: STROKE[tone], strokeWidth: tone === 'idle' ? 1.4 : 2 }}
      />
      <EdgeLabelRenderer>
        <div
          className="ue:pointer-events-none ue:absolute ue:flex ue:items-center ue:gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
        >
          {label && (
            <span className="ue:rounded-full ue:bg-card ue:px-1.5 ue:text-micro ue:text-muted ue:shadow-card">
              {label}
            </span>
          )}
          <InsertButton at={e.insert} className="ue:opacity-60 ue:hover:opacity-100" />
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

/** 循环的「下一轮」：从最后一步底部沿框底走回第一步底部，虚线 */
export const BackEdgeView = memo(function BackEdgeView(p: EdgeProps<Edge<EdgeData>>) {
  const e = p.data!.edge
  const { run } = useFlow()
  const y = e.channelY ?? Math.max(p.sourceY, p.targetY) + 20
  const r = 10
  const path = [
    `M ${p.sourceX} ${p.sourceY}`,
    `L ${p.sourceX} ${y - r}`,
    `Q ${p.sourceX} ${y} ${p.sourceX - r} ${y}`,
    `L ${p.targetX + r} ${y}`,
    `Q ${p.targetX} ${y} ${p.targetX} ${y - r}`,
    `L ${p.targetX} ${p.targetY}`,
  ].join(' ')
  const looping = run.steps[e.to]?.status === 'running' || run.steps[e.from]?.status === 'running'
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        style={{
          stroke: looping ? 'var(--run)' : 'var(--line-strong)',
          strokeWidth: 1.4,
          strokeDasharray: '5 4',
        }}
      />
      <EdgeLabelRenderer>
        <span
          className={h().cn(
            'ue:pointer-events-none ue:absolute ue:rounded-full ue:bg-card ue:px-1.5 ue:text-micro ue:shadow-card',
            looping ? 'ue:text-run' : 'ue:text-subtle',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${(p.sourceX + p.targetX) / 2}px, ${y}px)` }}
        >
          {t('下一轮')}
        </span>
      </EdgeLabelRenderer>
    </>
  )
})

export const EDGE_TYPES = { flow: FlowEdgeView, back: BackEdgeView }
