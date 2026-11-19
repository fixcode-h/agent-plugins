import { memo, useState, type ReactNode } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { CirclePlay, CircleX, ClipboardList, LogIn, ShieldCheck, StickyNote, Unlink } from 'lucide-react'
import { CountBadge } from '@panel/web/src/components/ui/count-badge'
import { h, t } from '../../../../host.ts'
import { BreakpointDot } from '../../gt-debug/BreakpointDot.tsx'
import { blockUi } from '../../gt-blocks/index.ts'
import { condLines, faceOf } from '../faces.tsx'
import { RUN_LOOK } from '../nodes/parts.tsx'
import { useBp } from './ctx.ts'
import { EXIT_TONE, ExitRow, NodeBody, NodeCard, NodeHead, NodeTile, Pin } from './parts.tsx'
import type { BpNode, BpPin } from './graph.ts'

export type BpData = { node: BpNode }
type Props = NodeProps<Node<BpData>>

/** 子槽引脚上的字：是 / 否 / 每轮… */
function pinLabel(p: BpPin, action: string) {
  if (p.kind === 'then') return t('是')
  if (p.kind === 'else') return t('否')
  if (p.kind === 'elif') return t('否则如果 {n}', { n: (p.index ?? 0) + 1 })
  if (p.kind === 'do') return action === 'loop' ? t('每轮') : t('里面')
  return p.kind
}

/** 输出引脚：Alt 点一下断开后面那串（照蓝图） */
function OutPin({ node, pin, top, label }: { node: string; pin: BpPin; top?: number; label?: string }) {
  const exit = pin.kind !== 'next'
  const { editable, disconnect, linked } = useBp()
  const tip = editable ? t('拖到别的节点上连线，拖到空白处选节点；Alt 点一下断开') : undefined
  return (
    <Pin
      id={pin.id}
      side="out"
      exit={exit}
      top={top}
      linked={linked.has(`${node}:${pin.id}`)}
      editable={editable}
      title={label ? [label, tip].filter(Boolean).join('：') : tip}
      onMouseDownCapture={(e) => {
        if (!e.altKey || !editable) return
        e.stopPropagation()
        e.preventDefault()
        disconnect(pin.at)
      }}
    />
  )
}

function InPin({ node }: { node: string }) {
  const { editable, linked } = useBp()
  return <Pin id="in" side="in" top={HEAD_MID} linked={linked.has(`${node}:in`)} editable={editable} />
}

/** 头部引脚的高度：头部 40px 的正中 */
const HEAD_MID = 20

/** 头部右边的类型小字 */
const Kind = ({ children }: { children: ReactNode }) => (
  <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{children}</span>
)

/** 子槽出口：一行一个，最后一行贴着卡片底的圆角 */
function Exits({ node, pins, action }: { node: string; pins: BpPin[]; action: string }) {
  return pins.map((p, i) => (
    <ExitRow key={p.id} label={pinLabel(p, action)} tone={EXIT_TONE[p.kind] ?? 'subtle'} last={i === pins.length - 1}>
      <OutPin node={node} pin={p} />
    </ExitRow>
  ))
}

/** 一步（叶子、块、折起来的段）：头部图标 + 名字 + 类型，下面内容区（细节、条件一行一项）；块的子槽一行一个出口 */
export const BpStepNode = memo(function BpStepNode({ data }: Props) {
  const n = data.node
  const { run, selected, picked } = useBp()
  const { cn } = h()
  const step = n.step
  if (!step) return null
  const face = faceOf(step)
  const ui = blockUi(step.action)
  const st = run.steps[n.id.replace(/^~/, '')]
  // 「下一步 / 之后」都在头部右边，一直往右走直线；块的子槽（是 / 否 / 每轮…）一行一个排在下面，接到右下方，线不交叉
  const next = n.outs.find((p) => p.kind === 'next')
  const subs = n.outs.filter((p) => p.kind !== 'next')
  const disabled = step.disabled === true
  const lines =
    n.folded !== undefined
      ? [{ text: t('{n} 步 · 双击进入', { n: n.folded }) }]
      : [...(face.sub ? [{ text: face.sub }] : []), ...face.lines]
  return (
    <NodeCard
      id={n.id}
      tone={ui.tone}
      className={cn(
        st && !n.loose && RUN_LOOK[st.status],
        // 失败的那步要一眼看到（上次运行的报告也按这个标）
        st?.status === 'failed' && !n.loose && 'ue:ring-2 ue:ring-danger/70',
        (selected === n.id || picked?.has(n.id)) && 'ue:ring-2 ue:ring-accent',
        run.paused && run.at === n.id && 'ue:ring-2 ue:ring-warning',
        (disabled || n.loose) && 'ue:opacity-55',
        n.loose && 'ue:border-dashed',
      )}
    >
      <NodeHead divided={lines.length > 0}>
        <InPin node={n.id} />
        <BreakpointDot k={n.loose ? undefined : n.id} />
        <NodeTile icon={face.icon} tone={ui.tone} />
        <span className={cn('ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium', disabled && 'ue:line-through')}>
          {face.title}
        </span>
        <Kind>{ui.title()}</Kind>
        {next && <OutPin node={n.id} pin={next} top={HEAD_MID} label={subs.length ? t('之后') : undefined} />}
      </NodeHead>
      <NodeBody lines={lines} />
      <Exits node={n.id} pins={subs} action={step.action} />
      {st?.status === 'failed' && !n.loose && (
        <div className="ue:absolute ue:-bottom-5 ue:left-0.5 ue:flex ue:items-center ue:gap-1 ue:whitespace-nowrap ue:text-caption ue:text-danger">
          <CircleX className="ue:h-3 ue:w-3" />
          {t('在这一步失败')}
        </div>
      )}
      {n.loose && (
        <div className="ue:absolute ue:-bottom-5 ue:left-0.5 ue:flex ue:items-center ue:gap-1 ue:whitespace-nowrap ue:text-caption ue:text-warning">
          <Unlink className="ue:h-3 ue:w-3" />
          {t('没连上，不会执行')}
        </div>
      )}
      <CountBadge corner count={n.loose ? 0 : (st?.runs ?? 0)} />
    </NodeCard>
  )
})

/** 事件节点：开始、准备、守护（蓝图的事件：圆图标、没有输入引脚，后面接要做的步骤） */
export const BpEventNode = memo(function BpEventNode({ data }: Props) {
  const n = data.node
  const { run, selected } = useBp()
  const { cn } = h()
  if (n.kind === 'guard') {
    const g = n.guard ?? {}
    const gid = typeof g.id === 'string' ? g.id : ''
    const count = gid ? (run.guards[gid] ?? 0) : 0
    const sel = n.guardPath ? selected === `guard:${n.guardPath.join('.')}` : false
    const lines = [
      ...condLines(g.when).map((l, i) => (i === 0 ? { ...l, text: t('当 {w}', { w: l.text }) } : l)),
      ...(n.global ? [{ text: t('运行设置里改') }] : []),
    ]
    return (
      <NodeCard
        id={n.id}
        tone="success"
        className={cn(
          sel && 'ue:ring-2 ue:ring-accent',
          run.guardActive === gid && gid && 'node-running ue:ring-1 ue:ring-run/60',
          g.disabled === true && 'ue:opacity-55',
        )}
      >
        <NodeHead divided={lines.length > 0}>
          <NodeTile icon={ShieldCheck} tone="success" round />
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium">{String(g.name ?? '') || t('守护')}</span>
          <Kind>{n.global ? t('全局守护') : t('守护')}</Kind>
          {n.outs[0] && <OutPin node={n.id} pin={n.outs[0]} top={HEAD_MID} />}
        </NodeHead>
        <NodeBody lines={lines} />
        <CountBadge corner count={count} />
      </NodeCard>
    )
  }
  const setup = n.kind === 'setup'
  const Icon = setup ? ClipboardList : n.entry ? LogIn : CirclePlay
  const label = setup
    ? t('准备')
    : n.entry
      ? pinLabel({ id: '', kind: n.entry.kind, index: n.entry.index, at: { slot: [], index: 0 } }, n.entry.action)
      : t('开始')
  return (
    <div
      data-gt-node={n.id}
      className="ue:relative ue:flex ue:h-10 ue:items-center ue:gap-2 ue:rounded-full ue:bg-card ue:pr-4 ue:pl-2 ue:text-body ue:font-medium ue:text-fg ue:shadow-card ue:ring-1 ue:ring-success/45"
    >
      <NodeTile icon={Icon} tone="success" round />
      {label}
      {n.outs[0] && <OutPin node={n.id} pin={n.outs[0]} top={HEAD_MID} />}
    </div>
  )
})

/** 注释框：一段说明，双击改字 */
export const BpNoteNode = memo(function BpNoteNode({ data }: Props) {
  const note = data.node.note
  const { editable, editNote } = useBp()
  const [editing, setEditing] = useState(false)
  if (!note) return null
  return (
    <div
      onDoubleClick={() => editable && setEditing(true)}
      className="ue:flex ue:min-h-12 ue:w-[240px] ue:gap-1.5 ue:rounded-xl ue:border ue:border-warning/40 ue:bg-warning/8 ue:p-2.5 ue:text-footnote ue:text-fg"
    >
      <StickyNote className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" />
      {editing ? (
        <textarea
          autoFocus
          defaultValue={note.text}
          rows={3}
          className="nodrag ue:min-w-0 ue:flex-1 ue:resize-none ue:bg-transparent ue:outline-none"
          onBlur={(e) => {
            setEditing(false)
            if (e.target.value !== note.text) editNote(note.id, e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }}
        />
      ) : (
        <span className="ue:min-w-0 ue:flex-1 ue:whitespace-pre-wrap ue:break-words">
          {note.text || t('双击写说明')}
        </span>
      )}
    </div>
  )
})

/** 拖线到空白处松手、菜单还开着时，那根线的终点（看不见，只给线一个落脚的输入引脚；选完或取消就拿掉） */
const BpGhostNode = memo(function BpGhostNode() {
  return (
    <div className="ue:pointer-events-none ue:h-px ue:w-px">
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} className="ue:!opacity-0" />
    </div>
  )
})

export const BP_NODE_TYPES = {
  ghost: BpGhostNode,
  step: BpStepNode,
  start: BpEventNode,
  setup: BpEventNode,
  entry: BpEventNode,
  guard: BpEventNode,
  note: BpNoteNode,
}
