import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { MarkerType, useReactFlow, type Edge, type Node } from '@xyflow/react'
import { ChevronsDownUp, ChevronsUpDown, Hand, Maximize, MousePointer2 } from 'lucide-react'
import { CanvasToolbar, CanvasToolbarSep, GraphCanvas } from '@panel/web/src/components/flow/GraphCanvas'
import {
  insert,
  pathStr,
  type GtGuard,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { FlowContext, type FlowCtx } from './ctx.ts'
import { EDGE_TYPES, type EdgeData } from './edges.tsx'
import { defaultCollapsed, layoutFlow, type FlowNode, type InsertAt } from './layout.ts'
import { NODE_TYPES, type NodeData } from './nodes/index.ts'
import { ReadableFit } from './readable-fit.tsx'
import { emptyRun, type FlowRunState } from './run-state.ts'

/** 画布上选中的东西：一步 / 一块（key = 步骤 id 或路径），或者一条守护 */
export interface FlowSelection {
  key: string
  path?: GtPath
  guard?: boolean
}

export interface GtFlowViewProps {
  doc: GtScript
  /** 不给就是只读（运行页、历史回看） */
  onChange?: (doc: GtScript, focus?: GtPath) => void
  /** 选中的 key：步骤是 id 或路径；守护是「guard:<路径>」 */
  selected?: string
  onSelect?: (s: FlowSelection | undefined) => void
  /** 点了连线上的「+」或空槽：外壳弹插入菜单 */
  onPickInsert?: (at: InsertAt) => void
  /** 节点右键：包进如果 / 循环 / 守护、展开调用、断点、只试这一个、从这里接着录（外壳出菜单） */
  onNodeMenu?: (s: FlowSelection, e: MouseEvent) => void
  onAddGuard?: () => void
  /** 运行高亮（useFlowRun） */
  run?: FlowRunState
  /** 运行设置里的全局守护 */
  globalGuards?: GtGuard[]
  /** 底部工具条右边加的按钮（撤销、重做、运行这类外壳的动作） */
  toolbar?: ReactNode
  className?: string
}

type RFNode = Node<NodeData>
type RFEdge = Edge<EdgeData>

const selOf = (n: FlowNode): FlowSelection | undefined => {
  if (n.kind === 'guard' && n.path) return { key: `guard:${pathStr(n.path)}`, path: n.path, guard: true }
  if (n.key && n.path) return { key: n.key, path: n.path }
  return undefined
}

/** 小地图上的颜色跟运行状态走：走过的绿、正在跑的青、失败红 */
const miniOf = (run: FlowRunState) => (n: RFNode) => {
  const node = n.data.node
  if (node.kind === 'frame' || node.kind === 'rail') return 'color-mix(in oklab, var(--line-strong) 45%, transparent)'
  const st = node.key ? run.steps[node.key]?.status : undefined
  if (st === 'passed' || st === 'already') return 'color-mix(in oklab, var(--success) 45%, var(--card))'
  if (st === 'running') return 'color-mix(in oklab, var(--run) 50%, var(--card))'
  if (st === 'failed') return 'color-mix(in oklab, var(--danger) 45%, var(--card))'
  return 'var(--line-strong)'
}

/** 适应画布：在 ReactFlow 里面才拿得到实例 */
function FitButton() {
  const rf = useReactFlow()
  const { IconButton } = h().ui
  return (
    <IconButton
      icon={Maximize}
      size="sm"
      label={t('适应画布')}
      onClick={() => void rf.fitView({ padding: 0.1, duration: 200 })}
    />
  )
}

/**
 * GameTest 流程图（定稿 9.1，效果图 1、6）：从左到右的结构化流程，守护在下方竖排一列，右下角小地图。
 * 坐标全由 layout.ts 从数据算，节点不能拖着乱放；改结构走数据层（gt-script 的 insert / move / wrap），
 * 画布只负责「插在哪」「选了谁」「折不折叠」。运行中按 gt.flow 推送高亮（run-state.ts）。
 * 画布本身用面板开放的 GraphCanvas，外观、小地图、缩放和面板工作流一致，可在设置 → 组件 → 流程图画布里调
 */
export function GtFlowView({
  doc,
  onChange,
  selected,
  onSelect,
  onPickInsert,
  onNodeMenu,
  onAddGuard,
  run = emptyRun(),
  globalGuards,
  toolbar,
  className,
}: GtFlowViewProps) {
  const editable = !!onChange
  const { IconButton } = h().ui
  // 用户点过折叠 / 展开的块：key → 折没折；没点过的按 mode：auto 是录制段折叠，open / closed 是全部展开 / 折叠
  const [folds, setFolds] = useState<Record<string, boolean>>({})
  const [mode, setMode] = useState<'auto' | 'open' | 'closed'>('auto')
  const foldOf = useCallback(
    (s: GtStep, k: string) => folds[k] ?? (mode === 'auto' ? defaultCollapsed(s) : mode === 'closed'),
    [folds, mode],
  )
  const [pan, setPan] = useState(false)

  const layout = useMemo(() => layoutFlow(doc, { globalGuards, collapsed: foldOf }), [doc, globalGuards, foldOf])
  const nodes = useMemo<RFNode[]>(
    () =>
      layout.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: { x: n.x, y: n.y },
        width: n.w,
        height: n.h,
        style: { width: n.w, height: n.h },
        // 框、守护栏垫在下面，里层的框压在外层上面
        zIndex: n.kind === 'frame' || n.kind === 'rail' ? n.depth - 20 : 1,
        draggable: false,
        selectable: !!selOf(n),
        data: { node: n },
      })),
    [layout],
  )
  const edges = useMemo<RFEdge[]>(
    () =>
      layout.edges.map((e) => {
        const back = e.kind === 'back'
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: back ? 'b-out' : 'out',
          targetHandle: back ? 'b-in' : 'in',
          type: back ? 'back' : 'flow',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--line-strong)' },
          selectable: false,
          zIndex: 0,
          data: { edge: e },
        }
      }),
    [layout],
  )

  const toggle = useCallback(
    (key: string) =>
      setFolds((f) => {
        const step = layout.nodes.find((n) => n.key === key)?.step
        return step ? { ...f, [key]: !foldOf(step, key) } : f
      }),
    [layout, foldOf],
  )
  const ctx = useMemo<FlowCtx>(
    () => ({
      run,
      editable,
      selected,
      toggle,
      insertAt: (at, steps) => {
        if (!steps) return onPickInsert?.(at)
        const r = onChange && insert(doc, at.slot, at.index, steps)
        if (r) onChange!(r.doc, r.path)
      },
      addGuard: onAddGuard,
    }),
    [run, editable, selected, toggle, onPickInsert, onChange, doc, onAddGuard],
  )
  const anyFolded = layout.nodes.some((n) => n.hidden !== undefined)
  // 全部展开 / 全部折叠：清掉逐个点过的，按新的默认重算（展开后里层冒出来的块也跟着展开）
  const setAll = (fold: boolean) => {
    setFolds({})
    setMode(fold ? 'closed' : 'open')
  }

  return (
    <FlowContext.Provider value={ctx}>
      <GraphCanvas<RFNode, RFEdge>
        frameClassName={h().cn('ue:h-full ue:w-full', className)}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        editable={editable}
        panMode={pan}
        // 结构由数据决定：节点不能拖、不能连线；左键空白处也拖画布（框选在这里没有用处）
        nodesDraggable={false}
        nodesConnectable={false}
        selectionOnDrag={false}
        panOnDrag
        deleteKeyCode={null}
        // 选中的框不抬高：xyflow 默认把选中的节点 z-index 提到最上面，段、循环、如果的框会盖住里面的节点和连线上的 +，点不到
        elevateNodesOnSelect={false}
        minimap={6}
        // 打开时的视口自己算（readable-fit.tsx）：通用的自动适配会把稍长的脚本缩得看不清
        autoFit={false}
        miniColor={miniOf(run)}
        onNodeClick={(_, n) => onSelect?.(selOf(n.data.node))}
        onNodeDoubleClick={(_, n) => {
          const node = n.data.node
          if (node.key && (node.kind === 'frame' || node.hidden !== undefined)) toggle(node.key)
        }}
        onNodeContextMenu={(e, n) => {
          const s = selOf(n.data.node)
          if (!s || !onNodeMenu) return
          e.preventDefault()
          onSelect?.(s)
          onNodeMenu(s, e)
        }}
        onPaneClick={() => onSelect?.(undefined)}
      >
        <ReadableFit />
        <CanvasToolbar>
          {/* 选择和平移互斥（效果图 1）：选择 = 关掉平移模式，左键空白处照样能拖画布 */}
          <IconButton
            icon={MousePointer2}
            size="sm"
            label={t('选择')}
            className={h().cn(!pan && 'ue:bg-sel ue:text-fg')}
            aria-pressed={!pan}
            onClick={() => setPan(false)}
          />
          <IconButton
            icon={Hand}
            size="sm"
            label={t('平移')}
            className={h().cn(pan && 'ue:bg-sel ue:text-fg')}
            aria-pressed={pan}
            onClick={() => setPan(!pan)}
          />
          <CanvasToolbarSep />
          <FitButton />
          <IconButton
            icon={anyFolded ? ChevronsUpDown : ChevronsDownUp}
            size="sm"
            label={anyFolded ? t('全部展开') : t('全部折叠')}
            onClick={() => setAll(!anyFolded)}
          />
          {toolbar && <CanvasToolbarSep />}
          {toolbar}
        </CanvasToolbar>
      </GraphCanvas>
    </FlowContext.Provider>
  )
}
