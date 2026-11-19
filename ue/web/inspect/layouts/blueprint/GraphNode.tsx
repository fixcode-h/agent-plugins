import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { CircleAlert, Diamond, Play, SquareFunction, Variable, type LucideIcon } from 'lucide-react'
import { h } from '../../../host.ts'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import { HEAD_H, nodeTone, ROW_H, type GPin, type PlacedNode } from './graph.ts'
import { typeTone } from './model.ts'

export type GraphNodeData = { placed: PlacedNode; picked: boolean }

const ICONS: Record<string, LucideIcon> = {
  event: Diamond,
  custom_event: Diamond,
  entry: Play,
  get: Variable,
  set: Variable,
}

/** 引脚：执行线是小三角、数据是圆点，颜色按类型（UE 的配色换成主题色）；连上了填实 */
function PinDot({ pin, side, row }: { pin: GPin; side: 'in' | 'out'; row: number }) {
  const exec = pin.type === 'exec'
  const ink = toneColor(typeTone(pin.type))
  const linked = !!pin.to?.length
  return (
    <Handle
      id={`${side}:${pin.name}`}
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      isConnectable={false}
      className="ue:!min-w-0 ue:!border-0"
      style={{
        // 面板画布只读时把引脚藏起来（.read-only .react-flow__handle）；蓝图的引脚是内容的一部分，要显示
        opacity: 1,
        top: HEAD_H + row * ROW_H + ROW_H / 2 + 4,
        width: exec ? 10 : 9,
        height: exec ? 10 : 9,
        borderRadius: exec ? 1 : 999,
        clipPath: exec ? 'polygon(0 0, 100% 50%, 0 100%)' : undefined,
        // 三角形用 clip-path 剪出来，描边会被剪掉：没连线的执行引脚改成淡色实心
        background: linked ? ink : exec ? `color-mix(in oklab, ${ink} 35%, transparent)` : 'var(--card)',
        boxShadow: exec ? undefined : `0 0 0 1.5px ${ink}`,
      }}
    />
  )
}

/** 一行里一侧的引脚名（执行线 execute / then 这类不写名字，和 UE 一样）；没连线的输入写默认值 */
function PinLabel({ pin, side }: { pin?: GPin; side: 'in' | 'out' }) {
  if (!pin) return <span className="ue:flex-1" />
  const hideName = pin.type === 'exec' && /^(execute|then|exec)$/i.test(pin.name)
  return (
    <span
      className={h().cn(
        'ue:flex ue:min-w-0 ue:flex-1 ue:items-center ue:gap-1 ue:truncate',
        side === 'out' && 'ue:justify-end',
      )}
      title={`${pin.name} · ${pin.type}${pin.default !== undefined ? ` = ${pin.default}` : ''}`}
    >
      {!hideName && <span className="ue:truncate">{pin.name}</span>}
      {side === 'in' && pin.default !== undefined && !pin.to?.length && (
        <span className="ue:max-w-20 ue:truncate ue:rounded-[4px] ue:bg-field ue:px-1 ue:font-mono ue:text-caption ue:text-subtle">
          {pin.default}
        </span>
      )}
    </span>
  )
}

/**
 * 图表画布上的一个蓝图节点（效果图 A2）：按种类上色的头部（事件红、调用蓝、纯函数绿、变量随类型…）、
 * 下面一行一对引脚（左输入右输出）。只读：不能拖线、不能改；点一下在右栏看引脚和连线
 */
export const GraphNodeView = memo(function GraphNodeView({ data }: NodeProps<Node<GraphNodeData>>) {
  const { cn } = h()
  const { node, rows, w } = data.placed
  const tone = nodeTone(node)
  const Icon = node.error ? CircleAlert : (ICONS[node.kind] ?? SquareFunction)
  return (
    <div
      className={cn(
        'ue:overflow-visible ue:rounded-[8px] ue:border ue:bg-card ue:text-footnote ue:text-fg ue:shadow-card',
        data.picked ? 'ue:border-accent ue:ring-2 ue:ring-accent/40' : 'ue:border-line-strong',
        node.error && 'ue:border-danger',
      )}
      style={{ width: w }}
      title={[node.title, node.member, node.comment, node.error].filter(Boolean).join('\n')}
    >
      <div
        className="ue:flex ue:items-center ue:gap-1.5 ue:rounded-t-[7px] ue:px-2.5 ue:font-medium"
        style={{
          height: HEAD_H,
          background: `color-mix(in oklab, ${toneColor(tone)} 22%, var(--card))`,
          borderBottom: `1px solid color-mix(in oklab, ${toneColor(tone)} 40%, var(--line))`,
        }}
      >
        <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0" style={{ color: toneColor(node.error ? 'danger' : tone) }} />
        <span className="ue:truncate">{node.title}</span>
      </div>
      <div className="ue:relative ue:py-1">
        {rows.map((r, i) => (
          <div key={i} className="ue:flex ue:items-center ue:gap-2 ue:px-3" style={{ height: ROW_H }}>
            <PinLabel pin={r.in} side="in" />
            <PinLabel pin={r.out} side="out" />
          </div>
        ))}
      </div>
      {rows.map((r, i) => [
        r.in && <PinDot key={`i${i}`} pin={r.in} side="in" row={i} />,
        r.out && <PinDot key={`o${i}`} pin={r.out} side="out" row={i} />,
      ])}
    </div>
  )
})

export const GRAPH_NODE_TYPES = { bp: GraphNodeView }
