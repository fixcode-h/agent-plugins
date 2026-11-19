import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useReactFlow, type Connection, type Edge, type FinalConnectionState, type Node } from '@xyflow/react'
import { ChevronsDownUp, ChevronsUpDown, Hand, LayoutGrid, Maximize, MousePointer2, ShieldCheck, StickyNote } from 'lucide-react'
import { CanvasToolbar, CanvasToolbarSep, GraphCanvas } from '@panel/web/src/components/flow/GraphCanvas'
import { pathStr, type GtGuard, type GtPath, type GtScript, type GtStep } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { openMenu, type MenuItem } from '../../../../menu.tsx'
import { callCopy } from '../../gt-edit/call-copy.ts'
import { insertMenuItems } from '../../gt-edit/insert-menu.ts'
import { canDrop, readDrop, wantsCopy } from '../dnd.ts'
import { defaultCollapsed } from '../layout.ts'
import { ReadableFit } from '../readable-fit.tsx'
import { emptyRun, type FlowRunState } from '../run-state.ts'
import { BpContext, type BpCtx } from './ctx.ts'
import { addLoose, addNote, clearPositions, connect, disconnect, insertAtPin, setPositions, updateNote } from './edit.ts'
import { BP_EDGE_TYPES, type BpEdgeData } from './edge.tsx'
import { bpGraph, pinOf, type BpAt, type BpNode } from './graph.ts'
import { BP_NODE_TYPES, type BpData } from './nodes.tsx'

/** 画布上选中的东西：一步（key = 步骤 id，没连上的前面带 ~），或者一条守护 */
export interface BpSelection {
  key: string
  path?: GtPath
  guard?: boolean
}

export interface BpViewProps {
  doc: GtScript
  /** 不给就是只读 */
  onChange?: (doc: GtScript, focus?: GtPath) => void
  selected?: string
  onSelect?: (s: BpSelection | undefined) => void
  onNodeMenu?: (s: BpSelection, e: MouseEvent) => void
  onAddGuard?: () => void
  run?: FlowRunState
  globalGuards?: GtGuard[]
  toolbar?: ReactNode
}

type RFNode = Node<BpData>
type RFEdge = Edge<BpEdgeData>

const selOf = (n: BpNode): BpSelection | undefined => {
  if (n.kind === 'guard' && n.guardPath) return { key: `guard:${pathStr(n.guardPath)}`, path: n.guardPath, guard: true }
  if (n.kind === 'step' && n.path) return { key: n.id, path: n.path }
  return undefined
}

const miniOf = (run: FlowRunState) => (n: RFNode) => {
  const st = run.steps[n.id]?.status
  if (n.data.node.loose) return 'color-mix(in oklab, var(--line-strong) 45%, transparent)'
  if (st === 'passed' || st === 'already') return 'color-mix(in oklab, var(--success) 45%, var(--card))'
  if (st === 'running') return 'color-mix(in oklab, var(--run) 50%, var(--card))'
  if (st === 'failed') return 'color-mix(in oklab, var(--danger) 45%, var(--card))'
  return 'var(--line-strong)'
}

/**
 * GameTest 流程图，蓝图式（设计稿 designs/GameTest整页编辑器与蓝图画布-设计稿.md 第 3 节）：
 * 节点、守护、注释框随便拖（位置存脚本的 _layout）；从输出引脚拖到别的节点上连线，拖到空白处松手弹节点菜单、选了放在松手处并连上；
 * 空白处右键加节点 / 守护 / 注释框；Alt 点引脚或连线上的 ✕ 断开，断开的那串留在画布上、不执行。
 * 图模型和改动是纯函数（graph.ts、edit.ts），这里只把鼠标动作接过去
 */
export function BpView(props: BpViewProps) {
  return <BpCanvas {...props} />
}

function BpCanvas({
  doc,
  onChange,
  selected,
  onSelect,
  onNodeMenu,
  onAddGuard,
  run = emptyRun(),
  globalGuards,
  toolbar,
}: BpViewProps) {
  const editable = !!onChange
  const { IconButton } = h().ui
  const { toast, cn } = h()
  const [folds, setFolds] = useState<Record<string, boolean>>({})
  const [mode, setMode] = useState<'auto' | 'open' | 'closed'>('auto')
  const foldOf = useCallback(
    (s: GtStep, k: string) => folds[k] ?? (mode === 'auto' ? defaultCollapsed(s) : mode === 'closed'),
    [folds, mode],
  )
  const [pan, setPan] = useState(false)
  const graph = useMemo(() => bpGraph(doc, { folded: foldOf, globalGuards }), [doc, foldOf, globalGuards])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])

  const nodes = useMemo<RFNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: { x: n.x, y: n.y },
        style: { width: n.kind === 'start' || n.kind === 'setup' ? undefined : n.kind === 'guard' ? 240 : n.kind === 'note' ? undefined : 220 },
        draggable: editable && !n.global,
        selectable: n.kind !== 'note' || editable,
        zIndex: n.kind === 'note' ? -1 : 1,
        data: { node: n },
      })),
    [graph, editable],
  )
  const edges = useMemo<RFEdge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.from,
        sourceHandle: e.pin,
        target: e.to,
        targetHandle: 'in',
        type: 'bp',
        selectable: false,
        data: { edge: e },
      })),
    [graph],
  )

  const apply = useCallback(
    (d: GtScript | undefined, focus?: GtPath, why?: string) => {
      if (!d) {
        if (why) toast.error(why)
        return
      }
      onChange?.(d, focus)
    },
    [onChange, toast],
  )

  return (
    <BpInner
      {...{ doc, graph, byId, nodes, edges, editable, apply, run, selected, onSelect, onNodeMenu, onAddGuard, pan, toolbar }}
      toolbarLeft={
        <>
          <IconButton
            icon={MousePointer2}
            size="sm"
            label={t('选择')}
            className={cn(!pan && 'ue:bg-sel ue:text-fg')}
            aria-pressed={!pan}
            onClick={() => setPan(false)}
          />
          <IconButton
            icon={Hand}
            size="sm"
            label={t('平移')}
            className={cn(pan && 'ue:bg-sel ue:text-fg')}
            aria-pressed={pan}
            onClick={() => setPan(!pan)}
          />
          <CanvasToolbarSep />
          <IconButton
            icon={graph.nodes.some((n) => n.folded !== undefined) ? ChevronsUpDown : ChevronsDownUp}
            size="sm"
            label={graph.nodes.some((n) => n.folded !== undefined) ? t('全部展开') : t('全部折叠')}
            onClick={() => {
              const fold = !graph.nodes.some((n) => n.folded !== undefined)
              setFolds({})
              setMode(fold ? 'closed' : 'open')
            }}
          />
          {editable && (
            <IconButton
              icon={LayoutGrid}
              size="sm"
              label={t('整理布局：忘掉拖过的位置，按自动布局重排')}
              onClick={() => apply(clearPositions(doc))}
            />
          )}
        </>
      }
      onToggle={(key, step) => setFolds((f) => ({ ...f, [key]: !foldOf(step, key) }))}
    />
  )
}

/** 画布本体：要在 ReactFlow 里面才拿得到 screenToFlowPosition，所以拆一层（工具条、坐标换算都在这里） */
function BpInner({
  doc,
  graph,
  byId,
  nodes,
  edges,
  editable,
  apply,
  run,
  selected,
  onSelect,
  onNodeMenu,
  onAddGuard,
  pan,
  toolbar,
  toolbarLeft,
  onToggle,
}: {
  doc: GtScript
  graph: ReturnType<typeof bpGraph>
  byId: Map<string, BpNode>
  nodes: RFNode[]
  edges: RFEdge[]
  editable: boolean
  apply: (d: GtScript | undefined, focus?: GtPath, why?: string) => void
  run: FlowRunState
  selected?: string
  onSelect?: (s: BpSelection | undefined) => void
  onNodeMenu?: (s: BpSelection, e: MouseEvent) => void
  onAddGuard?: () => void
  pan: boolean
  toolbar?: ReactNode
  toolbarLeft: ReactNode
  onToggle: (key: string, step: GtStep) => void
}) {
  // ReactFlow 实例要在 GraphCanvas 里面才有：坐标换算放进 Bridge 里拿，存进 ref
  const rf = useRef<ReturnType<typeof useReactFlow> | null>(null)
  const toFlow = (x: number, y: number) => rf.current?.screenToFlowPosition({ x, y }) ?? { x, y }
  // 右键拖画布松手也会触发 contextmenu：按下和松开离得远就当是拖动，不弹菜单
  const down = useRef({ x: 0, y: 0 })

  /** 节点菜单：选一种节点，放在 (clientX, clientY)。from 给了就插在这个引脚后面并连上，不给就是一个没连上的节点 */
  const pickNode = (clientX: number, clientY: number, from?: BpAt, extra: MenuItem[] = []) => {
    const p = toFlow(clientX, clientY)
    const e = new globalThis.MouseEvent('contextmenu', { clientX, clientY })
    openMenu(
      e,
      [
        ...extra,
        ...insertMenuItems((it) => {
          const step = it.make()
          if (from) {
            const r = insertAtPin(doc, from, [step], p.x, p.y)
            apply(r?.doc, r?.path)
          } else {
            const r = addLoose(doc, [step], p.x, p.y)
            apply(r.doc, r.path)
          }
        }),
      ],
      { search: t('找节点：输入名字…') },
    )
  }

  const ctx = useMemo<BpCtx>(
    () => ({
      run,
      editable,
      selected,
      disconnect: (at) => apply(disconnect(doc, at)),
      insertAt: (at, steps, anchor) => {
        if (steps) {
          const target = edgesTarget(graph, at)
          const r = insertAtPin(doc, at, steps, (target?.x ?? 0) - 40, (target?.y ?? 0) + 90)
          return apply(r?.doc, r?.path)
        }
        if (anchor) pickNode(anchor.x, anchor.y, at)
      },
      editNote: (id, text) => apply(updateNote(doc, id, text === undefined ? undefined : { text })),
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- pickNode 每次渲染都新建，按它会每帧重建上下文
    [run, editable, selected, doc, graph, apply],
  )

  const onConnect = (c: Connection) => {
    const pin = pinOf(graph, c.source, c.sourceHandle)
    const target = byId.get(c.target)
    if (!pin || !target?.path) return
    const r = connect(doc, pin.at, target.path)
    apply(r?.doc, r?.path, t('接不上：不能接回自己前面或自己里面（会绕成圈）'))
  }

  const onConnectEnd = (e: globalThis.MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (s.isValid || !s.fromNode || s.fromHandle?.type !== 'source') return
    // 只在松手处是空白画布时弹（松在节点上但没对准引脚时不弹）
    const target = (e.target as Element | null)?.closest?.('.react-flow__node')
    if (target) return
    const pin = pinOf(graph, s.fromNode.id, s.fromHandle.id)
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e
    if (pin) pickNode(pt.clientX, pt.clientY, pin.at)
  }

  const paneMenu = (e: MouseEvent | globalThis.MouseEvent) => {
    if (!editable) return
    e.preventDefault()
    if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4) return
    const p = toFlow(e.clientX, e.clientY)
    pickNode(e.clientX, e.clientY, undefined, [
      onAddGuard && { label: t('加守护'), icon: ShieldCheck, onClick: onAddGuard },
      { label: t('加注释框'), icon: StickyNote, onClick: () => apply(addNote(doc, p.x, p.y, '')) },
      { label: t('全部收进视口'), icon: Maximize, onClick: () => void rf.current?.fitView({ padding: 0.1, duration: 200 }) },
      'sep',
    ].filter(Boolean) as MenuItem[])
  }

  return (
    <BpContext.Provider value={ctx}>
      <div
        className="ue:h-full ue:w-full"
        onPointerDownCapture={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onDragOver={(e) => {
          if (!editable || !canDrop(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          if (!editable) return
          const steps = readDrop(e)
          if (!steps) return
          e.preventDefault()
          // 节点面板、脚本库拖到空白处：放成一个没连上的节点，再从引脚连
          const p = toFlow(e.clientX, e.clientY)
          if (wantsCopy(e) && steps.length === 1 && steps[0].action === 'call')
            return void callCopy(steps[0]).then(
              (r) => {
                const x = addLoose(doc, [r.group], p.x, p.y)
                apply(x.doc, x.path)
                if (r.warn) h().toast.error(r.warn)
              },
              (err: Error) => h().toast.error(err.message),
            )
          const r = addLoose(doc, steps, p.x, p.y)
          apply(r.doc, r.path)
        }}
      >
        <GraphCanvas<RFNode, RFEdge>
          frameClassName="ue:h-full ue:w-full"
          nodes={nodes}
          edges={edges}
          nodeTypes={BP_NODE_TYPES}
          edgeTypes={BP_EDGE_TYPES}
          editable={editable}
          panMode={pan}
          nodesConnectable={editable}
          deleteKeyCode={null}
          elevateNodesOnSelect={false}
          minimap={6}
          autoFit={false}
          miniColor={miniOf(run)}
          connectionRadius={28}
          isValidConnection={(c) => byId.get(c.target)?.kind === 'step' && c.targetHandle === 'in'}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeDragStop={(_, __, moved) =>
            apply(setPositions(doc, moved.map((n) => ({ key: n.id, x: n.position.x, y: n.position.y }))))
          }
          onNodeClick={(_, n) => onSelect?.(selOf(n.data.node))}
          onNodeDoubleClick={(_, n) => {
            const node = n.data.node
            if (node.step && (node.folded !== undefined || node.outs.length > 1)) onToggle(node.id, node.step)
          }}
          onNodeContextMenu={(e, n) => {
            const node = n.data.node
            if (node.kind === 'note' && editable && node.note) {
              const id = node.note.id
              return openMenu(e, [{ label: t('删掉注释框'), danger: true, onClick: () => apply(updateNote(doc, id, undefined)) }])
            }
            const s = selOf(node)
            if (!s || !onNodeMenu) return
            e.preventDefault()
            onSelect?.(s)
            onNodeMenu(s, e)
          }}
          onPaneClick={() => onSelect?.(undefined)}
          onPaneContextMenu={paneMenu}
        >
          <Bridge into={rf} />
          <ReadableFit />
          <CanvasToolbar>
            {toolbarLeft}
            {toolbar && <CanvasToolbarSep />}
            {toolbar}
          </CanvasToolbar>
        </GraphCanvas>
      </div>
    </BpContext.Provider>
  )
}

/** 把 ReactFlow 实例递出去（坐标换算、适配视口） */
function Bridge({ into }: { into: { current: ReturnType<typeof useReactFlow> | null } }) {
  into.current = useReactFlow()
  return null
}

/** 连线上插入时新节点放哪：放在这根线接着的那个节点附近 */
function edgesTarget(g: ReturnType<typeof bpGraph>, at: BpAt) {
  const e = g.edges.find((x) => pathStr(x.at.slot) === pathStr(at.slot) && x.at.index === at.index)
  return e ? g.nodes.find((n) => n.id === e.to) : undefined
}
