import type { NodeTypes } from '@xyflow/react'
import type { FlowNodeKind } from '../layout.ts'
import { FrameNode } from './frame.tsx'
import { GuardNode, RailNode } from './guards.tsx'
import { EmptyNode, MergeNode, TermNode, type NodeData } from './parts.tsx'
import { StepNode } from './step.tsx'

/**
 * 布局里每种节点 → 画它的组件（xyflow 的 nodeTypes）。新加一种节点在这里登记一行，画布本身不用改
 */
export const NODE_TYPES: Record<FlowNodeKind, NodeTypes[string]> = {
  step: StepNode,
  branch: StepNode,
  frame: FrameNode,
  merge: MergeNode,
  term: TermNode,
  empty: EmptyNode,
  rail: RailNode,
  guard: GuardNode,
}

/** 框、守护栏画在最下面，节点在上面，连线在两者之间（xyflow 按 zIndex 排） */
export const Z: Partial<Record<FlowNodeKind, number>> = { frame: -1, rail: -1 }

export type { NodeData }
