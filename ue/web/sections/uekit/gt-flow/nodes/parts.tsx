import { useState, type ReactNode } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { h, t } from '../../../../host.ts'
import { useFlow } from '../ctx.ts'
import { canDrop, readDrop } from '../dnd.ts'
import type { FlowNode, InsertAt } from '../layout.ts'
import type { StepRun } from '../run-state.ts'

/** 节点在 xyflow 里的 data：布局算好的节点原样放进来 */
export type NodeData = { node: FlowNode }
export type FlowNodeProps = NodeProps<Node<NodeData>>

/**
 * 节点按运行状态染浅底（照面板工作流节点：完成浅绿、运行中青色描框带呼吸光、失败浅红、跳过变淡）。
 * node-running 是面板 index.css 里的呼吸光，和工作流运行中的节点一样
 */
export const RUN_LOOK: Record<StepRun['status'], string> = {
  running: 'node-running ue:bg-[color-mix(in_oklab,var(--color-run)_7%,var(--color-card))] ue:ring-1 ue:ring-run/60',
  passed: 'ue:bg-[color-mix(in_oklab,var(--color-success)_8%,var(--color-card))] ue:ring-1 ue:ring-success/30',
  already: 'ue:bg-[color-mix(in_oklab,var(--color-success)_5%,var(--color-card))] ue:ring-1 ue:ring-success/20',
  failed: 'ue:bg-[color-mix(in_oklab,var(--color-danger)_6%,var(--color-card))] ue:ring-1 ue:ring-danger/40',
  skipped: 'ue:opacity-55',
}

/** 连线的接点（结构由数据定，不让手连，所以都不显示）：左进右出；底部一对给循环的「下一轮」回线用。高度按布局给的 anchorY 放，框的入口不在正中 */
export function Handles({ node }: { node: FlowNode }) {
  const top = { top: node.anchorY }
  return (
    <>
      <Handle id="in" type="target" position={Position.Left} style={top} isConnectable={false} className="ue:opacity-0" />
      <Handle id="out" type="source" position={Position.Right} style={top} isConnectable={false} className="ue:opacity-0" />
      <Handle id="b-out" type="source" position={Position.Bottom} isConnectable={false} className="ue:opacity-0" />
      <Handle id="b-in" type="target" position={Position.Bottom} isConnectable={false} className="ue:opacity-0" />
    </>
  )
}

/**
 * 插入点：连线上的「+」、空槽占位共用。点一下由外壳弹插入菜单；把节点面板、脚本库里的东西拖到上面松手直接插
 */
export function useDropInsert(at: InsertAt | undefined) {
  const { editable, insertAt } = useFlow()
  const [over, setOver] = useState(false)
  if (!editable || !at) return { over: false, props: {} }
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!canDrop(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false)
        const steps = readDrop(e)
        if (!steps) return
        e.preventDefault()
        e.stopPropagation()
        insertAt(at, steps)
      },
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation()
        insertAt(at)
      },
    },
  }
}

export function InsertButton({ at, className }: { at?: InsertAt; className?: string }) {
  const { props, over } = useDropInsert(at)
  if (!at || !('onClick' in props)) return null
  return (
    <button
      type="button"
      aria-label={t('在这里插入')}
      title={t('在这里插入（也可以把节点、脚本拖到这里）')}
      {...props}
      className={h().cn(
        'nodrag nopan ue:pointer-events-auto ue:flex ue:h-5 ue:w-5 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-full ue:bg-card ue:text-subtle ue:shadow-card ue:transition ue:hover:text-fg',
        over && 'ue:scale-125 ue:bg-accent-soft ue:text-accent-text',
        className,
      )}
    >
      <Plus className="ue:h-3 ue:w-3" />
    </button>
  )
}

/** 开始 / 结束：一颗小胶囊 */
export function TermNode({ data }: FlowNodeProps) {
  const n = data.node
  return (
    <div className="ue:flex ue:h-full ue:w-full ue:items-center ue:justify-center ue:rounded-full ue:bg-card ue:text-caption ue:text-muted ue:shadow-card">
      <Handles node={n} />
      {n.role === 'start' ? t('开始') : t('结束')}
    </div>
  )
}

/** 如果的几条路汇合的点 */
export function MergeNode({ data }: FlowNodeProps) {
  return (
    <div className="ue:h-full ue:w-full ue:rounded-full ue:bg-line-strong">
      <Handles node={data.node} />
    </div>
  )
}

/** 空槽：虚线框「拖进来或点 +」 */
export function EmptyNode({ data }: FlowNodeProps) {
  const n = data.node
  const { props, over } = useDropInsert(n.insert)
  const editable = 'onClick' in props
  return (
    <div
      {...props}
      className={h().cn(
        'ue:flex ue:h-full ue:w-full ue:flex-col ue:items-center ue:justify-center ue:rounded-xl ue:border ue:border-dashed ue:border-line-strong ue:text-caption ue:text-subtle',
        editable && 'nodrag ue:cursor-pointer ue:hover:text-fg',
        over && 'ue:border-accent ue:bg-accent-soft ue:text-accent-text',
      )}
    >
      <Handles node={n} />
      {editable ? (
        <>
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('放到这里')}
        </>
      ) : (
        t('（空）')
      )}
    </div>
  )
}

/** 卡片里的一行小字（选择器、次数）：等宽、截断，悬停看全文 */
export const Sub = ({ children }: { children: ReactNode }) =>
  children ? (
    <div
      className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle"
      title={typeof children === 'string' ? children : undefined}
    >
      {children}
    </div>
  ) : null
