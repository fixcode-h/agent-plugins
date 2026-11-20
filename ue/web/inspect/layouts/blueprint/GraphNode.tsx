import { memo, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { t } from '../../../host.ts'
import type { PlacedNode } from './graph.ts'
import { CommentBoxNode } from './CommentBox.tsx'
import { PinCell } from './GraphPin.tsx'
import { NodeIconGlyph } from './NodeIcon.tsx'
import { HEAD_H, nodeStyle, pinColor, pinLabel, ROW_H, SET_H, SUB_H, type NodeStyle } from './ue-style.ts'
import { UE_CANVAS, UE_TEXT, UE_TITLE } from './ue-theme.ts'

export type GraphNodeData = { placed: PlacedNode; picked: boolean }

/** 节点外框：选中（点选或框选）时 UE 的橙黄描边，编译出错时红框，平时一圈暗边加投影 */
function frame(on: boolean, error: boolean, radius: number, body: string): CSSProperties {
  const ring = on
    ? `0 0 0 2px ${UE_CANVAS.selected}`
    : error
      ? `0 0 0 2px ${UE_CANVAS.error}`
      : `0 0 0 1px ${UE_CANVAS.bodyBorder}`
  return { borderRadius: radius, background: body, boxShadow: `${ring}, ${UE_CANVAS.shadow}` }
}

/** 标题条的底：上半截一层白色光泽，下面是标题色从左往右渐隐（UE 的 TitleGloss + ColorSpill） */
function titleBg(color: string) {
  return [
    `linear-gradient(180deg, ${UE_CANVAS.gloss} 0%, transparent 55%)`,
    `linear-gradient(90deg, ${color} 0%, color-mix(in srgb, ${color} 72%, transparent) 55%, color-mix(in srgb, ${color} 18%, transparent) 100%)`,
  ].join(', ')
}

function subtitleText(st: NodeStyle) {
  if (!st.subtitle) return ''
  return st.subtitle.kind === 'custom' ? t('自定义事件') : t('目标是 {name}', { name: st.subtitle.name })
}

/** 引脚行：左输入右输出，一行一对 */
function Rows({ placed, hideOutData }: { placed: PlacedNode; hideOutData?: boolean }) {
  return placed.rows.map((r, i) => (
    <div key={i} className="ue:flex ue:items-center ue:gap-3 ue:px-2" style={{ height: ROW_H }}>
      <PinCell pin={r.in} side="in" />
      <PinCell pin={r.out} side="out" hideName={!!hideOutData && r.out?.type !== 'exec'} />
    </div>
  ))
}

/** 普通节点：按种类着色的标题条（图标 + 标题 + 可选副标题），下面是引脚行 */
function FullNode({ placed, st, on }: { placed: PlacedNode; st: NodeStyle; on: boolean }) {
  const { node, w } = placed
  const sub = subtitleText(st)
  return (
    <div style={{ width: w, ...frame(on, !!node.error, 8, UE_CANVAS.body) }}>
      <div
        className="ue:flex ue:flex-col ue:justify-center ue:rounded-t-[8px] ue:px-2"
        style={{ height: HEAD_H + (sub ? SUB_H : 0), background: titleBg(UE_TITLE[st.title]) }}
      >
        <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          <NodeIconGlyph icon={st.icon} />
          <span className="ue:truncate ue:text-[12.5px] ue:font-semibold" style={{ color: UE_CANVAS.title }}>
            {node.title}
          </span>
        </div>
        {sub && (
          <span
            className="ue:truncate ue:pl-5 ue:text-[10.5px] ue:italic ue:leading-[13px]"
            style={{ color: UE_CANVAS.subtitle }}
          >
            {sub}
          </span>
        )}
      </div>
      <div className="ue:py-1 ue:text-[11.5px]">
        <Rows placed={placed} />
      </div>
    </div>
  )
}

/**
 * 变量 Get / Set：没有标题条的胶囊，主体从左往右带一抹变量类型色。
 * Get 的名字写在左边（引脚不再重复写），Set 顶上居中写「SET」
 */
function VarNode({ placed, on }: { placed: PlacedNode; on: boolean }) {
  const { node, w } = placed
  const v = node.pins.find((p) => p.type !== 'exec' && p.name !== 'self')
  const tint = v ? pinColor(v.type) : UE_CANVAS.pinText
  const body = `linear-gradient(90deg, color-mix(in srgb, ${tint} 30%, transparent) 0%, transparent 70%), ${UE_CANVAS.varBody}`
  const isSet = node.kind === 'set'
  // 变量名照 UE 的显示名写（bIsOpen → Is Open），和引脚名同一套规则
  const name = (v && pinLabel(v)) || node.member || node.title
  return (
    <div className="ue:py-1 ue:text-[11.5px]" style={{ width: w, ...frame(on, !!node.error, 14, body) }}>
      {isSet && (
        <div
          className="ue:text-center ue:text-[11px] ue:font-bold ue:tracking-wide"
          style={{ height: SET_H, color: UE_CANVAS.title }}
        >
          {/* 和节点标题一样是 UE 节点上的原文（标题都是 UE 回的英文），不当界面文案翻译 */}
          SET
        </div>
      )}
      {isSet ? (
        // Set 的输出数据引脚（Output_Get）在 UE 里不写名字
        <Rows placed={placed} hideOutData />
      ) : (
        placed.rows.map((r, i) => (
          <div key={i} className="ue:flex ue:items-center ue:gap-2 ue:px-2.5" style={{ height: ROW_H }}>
            {r.in ? (
              <PinCell pin={r.in} side="in" />
            ) : (
              <span className="ue:min-w-0 ue:flex-auto ue:truncate ue:font-semibold" style={{ color: UE_CANVAS.title }}>
                {i === 0 ? name : ''}
              </span>
            )}
            <PinCell pin={r.out} side="out" hideName={r.out === v} />
          </div>
        ))
      )}
    </div>
  )
}

/** 类型转换：两头各一个引脚的小圆点 */
function DotNode({ placed, on }: { placed: PlacedNode; on: boolean }) {
  const { node, w, h } = placed
  const pin = (dir: 'in' | 'out') => placed.rows.map((r) => r[dir]).find(Boolean)
  return (
    <div
      className="ue:flex ue:items-center ue:justify-between ue:px-1"
      style={{ width: w, height: h, ...frame(on, !!node.error, h / 2, UE_CANVAS.varBody) }}
    >
      <PinCell pin={pin('in')} side="in" hideName />
      <PinCell pin={pin('out')} side="out" hideName />
    </div>
  )
}

/** 转接点：线上的一个小圆，进出两个引脚叠在圆心两侧 */
function KnotNode({ placed, on }: { placed: PlacedNode; on: boolean }) {
  const { node, w, h } = placed
  const p = node.pins.find((x) => x.dir !== 'in') ?? node.pins[0]
  const ink = p ? pinColor(p.type) : UE_CANVAS.pinText
  const handle = (side: 'in' | 'out', name?: string): ReactNode =>
    name !== undefined && (
      <Handle
        id={`${side}:${name}`}
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        isConnectable={false}
        style={{
          position: 'relative',
          inset: 'auto',
          transform: 'none',
          width: 0,
          height: 0,
          minWidth: 0,
          border: 'none',
          opacity: 0,
        }}
      />
    )
  return (
    <div className="ue:flex ue:items-center ue:justify-center" style={{ width: w, height: h }}>
      {handle('in', node.pins.find((x) => x.dir === 'in')?.name)}
      <span
        className="ue:h-2.5 ue:w-2.5 ue:rounded-full"
        style={{ background: ink, boxShadow: on ? `0 0 0 2px ${UE_CANVAS.selected}` : undefined }}
      />
      {handle('out', node.pins.find((x) => x.dir !== 'in')?.name)}
    </div>
  )
}

/**
 * 图表画布上的一个蓝图节点，照 UE 5.4 蓝图编辑器的样子（配色在 ue-theme.ts，外形判断在 ue-style.ts）。
 * 只读：不能拖线、不能改；点一下在右栏看引脚和连线
 */
export const GraphNodeView = memo(function GraphNodeView({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const { placed } = data
  const { node } = placed
  const st = nodeStyle(node)
  const on = data.picked || !!selected
  return (
    <div style={{ ...UE_TEXT }} title={[node.title, node.member, node.comment, node.error].filter(Boolean).join('\n')}>
      {st.look === 'var' ? (
        <VarNode placed={placed} on={on} />
      ) : st.look === 'dot' ? (
        <DotNode placed={placed} on={on} />
      ) : st.look === 'knot' ? (
        <KnotNode placed={placed} on={on} />
      ) : (
        <FullNode placed={placed} st={st} on={on} />
      )}
    </div>
  )
})

export const GRAPH_NODE_TYPES = { bp: GraphNodeView, comment: CommentBoxNode }
