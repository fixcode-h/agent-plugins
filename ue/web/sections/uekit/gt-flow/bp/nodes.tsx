import { memo, useState, type ReactNode } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { CirclePlay, CircleX, ClipboardList, LogIn, ShieldCheck, StickyNote, Unlink } from 'lucide-react'
import { CountBadge } from '@panel/web/src/components/ui/count-badge'
import { h, t } from '../../../../host.ts'
import { BreakpointDot } from '../../gt-debug/BreakpointDot.tsx'
import { blockUi, type BlockTone } from '../../gt-blocks/index.ts'
import { faceOf, guardFace } from '../faces.tsx'
import { RUN_LOOK } from '../nodes/parts.tsx'
import { useBp } from './ctx.ts'
import type { BpNode, BpPin } from './graph.ts'

export type BpData = { node: BpNode }
type Props = NodeProps<Node<BpData>>

/** 头部的浅色底，和图标同一个色调（gt-blocks 的 tone） */
const HEAD: Record<BlockTone, string> = {
  accent: 'ue:bg-accent/8',
  warning: 'ue:bg-warning/12',
  success: 'ue:bg-success/12',
  run: 'ue:bg-run/12',
  danger: 'ue:bg-danger/12',
  subtle: '',
}
const TEXT: Record<BlockTone, string> = {
  accent: 'ue:text-accent',
  warning: 'ue:text-warning',
  success: 'ue:text-success',
  run: 'ue:text-run',
  danger: 'ue:text-danger',
  subtle: 'ue:text-subtle',
}

/** 执行引脚：蓝图那样的小三角。左边进、右边出 */
const PIN =
  'ue:!h-3 ue:!w-2.5 ue:!min-w-0 ue:!rounded-none ue:!border-0 ue:!bg-muted ue:[clip-path:polygon(0_0,100%_50%,0_100%)] ue:hover:!bg-accent'

/** 子槽引脚上的字：是 / 否 / 每轮… */
function pinLabel(p: BpPin, action: string) {
  if (p.kind === 'then') return t('是')
  if (p.kind === 'else') return t('否')
  if (p.kind === 'elif') return t('否则如果 {n}', { n: (p.index ?? 0) + 1 })
  if (p.kind === 'do') return action === 'loop' ? t('每轮') : t('里面')
  return p.kind
}

/** 输出引脚：Alt 点一下断开后面那串（照蓝图） */
function OutPin({ pin, style, label }: { pin: BpPin; style?: React.CSSProperties; label?: string }) {
  const { editable, disconnect } = useBp()
  const tip = editable ? t('拖到别的节点上连线，拖到空白处选节点；Alt 点一下断开') : undefined
  return (
    <Handle
      id={pin.id}
      type="source"
      position={Position.Right}
      isConnectable={editable}
      style={{ right: -6, ...style }}
      className={PIN}
      title={label ? [label, tip].filter(Boolean).join('：') : tip}
      onMouseDownCapture={(e: React.MouseEvent) => {
        if (!e.altKey || !editable) return
        e.stopPropagation()
        e.preventDefault()
        disconnect(pin.at)
      }}
    />
  )
}

function InPin() {
  const { editable } = useBp()
  return (
    <Handle
      id="in"
      type="target"
      position={Position.Left}
      isConnectable={editable}
      style={{ top: 17, left: -6 }}
      className={PIN}
    />
  )
}

function Card({
  id,
  head,
  children,
  className,
  tone,
}: {
  id: string
  head: ReactNode
  children?: ReactNode
  className?: string
  tone?: string
}) {
  return (
    <div
      data-gt-node={id}
      className={h().cn(
        'ue:relative ue:flex ue:w-full ue:flex-col ue:rounded-xl ue:border ue:border-line-strong ue:bg-card ue:text-body ue:shadow-card',
        className,
      )}
    >
      <div
        className={h().cn(
          'ue:relative ue:flex ue:h-[34px] ue:min-w-0 ue:items-center ue:gap-1.5 ue:rounded-t-xl ue:px-2.5',
          tone,
        )}
      >
        {head}
      </div>
      {children}
    </div>
  )
}

/** 一步（叶子、块、折起来的段）：头部图标 + 名字，下面一行细节；块的子槽一行一个引脚 */
export const BpStepNode = memo(function BpStepNode({ data }: Props) {
  const n = data.node
  const { run, selected, picked } = useBp()
  const { cn } = h()
  const step = n.step
  if (!step) return null
  const face = faceOf(step)
  const ui = blockUi(step.action)
  const st = run.steps[n.id.replace(/^~/, '')]
  const Icon = face.icon
  // 「下一步 / 之后」都在头部右边，一直往右走直线；块的子槽（是 / 否 / 每轮…）一行一个排在下面，接到右下方，线不交叉
  const next = n.outs.find((p) => p.kind === 'next')
  const subs = n.outs.filter((p) => p.kind !== 'next')
  const disabled = step.disabled === true
  return (
    <Card
      id={n.id}
      tone={HEAD[ui.tone]}
      className={cn(
        st && !n.loose && RUN_LOOK[st.status],
        // 失败的那步要一眼看到（上次运行的报告也按这个标）
        st?.status === 'failed' && !n.loose && 'ue:ring-2 ue:ring-danger/70',
        (selected === n.id || picked?.has(n.id)) && 'ue:ring-2 ue:ring-accent',
        run.paused && run.at === n.id && 'ue:ring-2 ue:ring-warning',
        (disabled || n.loose) && 'ue:opacity-55',
        n.loose && 'ue:border-dashed',
      )}
      head={
        <>
          <InPin />
          <BreakpointDot k={n.loose ? undefined : n.id} />
          <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', TEXT[ui.tone])} />
          <span className={cn('ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium', disabled && 'ue:line-through')}>
            {face.title}
          </span>
          <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{ui.title()}</span>
          {next && <OutPin pin={next} style={{ top: 17 }} label={subs.length ? t('之后') : undefined} />}
        </>
      }
    >
      {(face.sub || n.folded !== undefined) && (
        <div className="ue:truncate ue:px-2.5 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-muted">
          {n.folded !== undefined ? t('{n} 步 · 双击进入', { n: n.folded }) : face.sub}
        </div>
      )}
      {subs.map((p) => (
        <div
          key={p.id}
          className="ue:relative ue:flex ue:h-6 ue:items-center ue:justify-end ue:border-t ue:border-dashed ue:border-line ue:px-2.5 ue:text-footnote ue:text-muted"
        >
          {pinLabel(p, step.action)}
          <OutPin pin={p} style={{ top: '50%' }} />
        </div>
      ))}
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
    </Card>
  )
})

/** 事件节点：开始、准备、守护（蓝图的事件：圆角头、没有输入引脚，后面接要做的步骤） */
export const BpEventNode = memo(function BpEventNode({ data }: Props) {
  const n = data.node
  const { run, selected } = useBp()
  const { cn } = h()
  if (n.kind === 'guard') {
    const g = n.guard ?? {}
    const f = guardFace(g)
    const gid = typeof g.id === 'string' ? g.id : ''
    const count = gid ? (run.guards[gid] ?? 0) : 0
    const sel = n.guardPath ? selected === `guard:${n.guardPath.join('.')}` : false
    return (
      <Card
        id={n.id}
        tone="ue:bg-success/12"
        className={cn(
          'ue:rounded-tl-2xl ue:border-success/45',
          sel && 'ue:ring-2 ue:ring-accent',
          run.guardActive === gid && gid && 'node-running ue:ring-1 ue:ring-run/60',
          g.disabled === true && 'ue:opacity-55',
        )}
        head={
          <>
            <ShieldCheck className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
            <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium">{String(g.name ?? '') || t('守护')}</span>
            <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{n.global ? t('全局守护') : t('守护')}</span>
            {n.outs[0] && <OutPin pin={n.outs[0]} style={{ top: 17 }} />}
          </>
        }
      >
        <div className="ue:px-2.5 ue:py-1.5 ue:text-footnote ue:text-muted">
          <div className="ue:truncate">{t('当 {w}', { w: f.whenSub || f.when })}</div>
          {n.global && <div className="ue:truncate ue:text-caption ue:text-subtle">{t('运行设置里改')}</div>}
        </div>
        <CountBadge corner count={count} />
      </Card>
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
      className="ue:relative ue:flex ue:h-[34px] ue:items-center ue:gap-1.5 ue:rounded-l-2xl ue:rounded-r-xl ue:border ue:border-success/45 ue:bg-[color-mix(in_oklab,var(--color-success)_14%,var(--color-card))] ue:px-3 ue:text-body ue:font-medium ue:shadow-card"
    >
      <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
      {label}
      {n.outs[0] && <OutPin pin={n.outs[0]} style={{ top: 17 }} />}
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
