import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useReactFlow, type Connection, type Edge, type FinalConnectionState, type Node } from '@xyflow/react'
import { CornerLeftUp, Hand, Layers, LayoutGrid, Maximize, MousePointer2, ShieldCheck, StickyNote } from 'lucide-react'
import { CanvasToolbar, CanvasToolbarSep, GraphCanvas } from '@panel/web/src/components/flow/GraphCanvas'
import {
  blockOf,
  getAt,
  isSubgraph,
  pathStr,
  type GtGuard,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { openMenu, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { callCopy } from '../../gt-edit/call-copy.ts'
import { insertMenuItems } from '../../gt-edit/insert-menu.ts'
import { canDrop, readDrop, wantsCopy } from '../dnd.ts'
import { ReadableFit } from '../readable-fit.tsx'
import { emptyRun, type FlowRunState } from '../run-state.ts'
import { BpContext, linkedPins, type BpCtx } from './ctx.ts'
import { addLoose, addNote, clearPositions, connect, disconnect, insertAtPin, moveNodes, updateNote } from './edit.ts'
import { BP_EDGE_TYPES, type BpEdgeData } from './edge.tsx'
import { bpGraph, pinOf, scopeKey, type BpAt, type BpNode } from './graph.ts'
import { CANVAS_KEYS } from './keys.ts'
import { AlignTools, MiniMapToggle, NodeSearch, useMiniMapPref, ZoomReadout } from './toolbar.tsx'
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
  /** 进到哪个块里面看（块的路径）；不给是最外层 */
  scope?: GtPath
  /** 双击块：进到它里面；双击调用别的脚本的步骤：打开那个脚本。不给就不能进 */
  onEnter?: (path: GtPath, step: GtStep) => void
  /** 回到上一层（工具条上的按钮） */
  onLeave?: () => void
  /** 一起选中的节点 key（框选、Ctrl+A） */
  picked?: string[]
  /** 框选、Ctrl+A 选了几个（只有步骤，守护不算） */
  onSelectMany?: (s: BpSelection[]) => void
  /** 「核对所有对象」后此刻找不到对象的步骤 key */
  missing?: ReadonlySet<string>
}

type RFNode = Node<BpData>
type RFEdge = Edge<BpEdgeData>
/** 拖线弹菜单时那根临时线的终点节点、线的 id */
const PENDING = '#pending'

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
  scope,
  onEnter,
  onLeave,
  picked,
  onSelectMany,
  missing,
}: BpViewProps) {
  const editable = !!onChange
  const { IconButton } = h().ui
  const { toast, cn } = h()
  const [pan, setPan] = useState(false)
  const graph = useMemo(() => bpGraph(doc, { scope, globalGuards }), [doc, scope, globalGuards])
  // 这一层的 key：空白处加的节点、注释框记在这一层
  const here = useMemo(() => {
    const st = scope && (getAt(doc, scope) as GtStep | undefined)
    return st && scope ? scopeKey(st, scope) : ''
  }, [doc, scope])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])

  const nodes = useMemo<RFNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: { x: n.x, y: n.y },
        style: {
          width:
            n.kind === 'start' || n.kind === 'setup' || n.kind === 'teardown' || n.kind === 'entry'
              ? undefined
              : n.kind === 'guard'
                ? 240
                : n.kind === 'note'
                  ? undefined
                  : 220,
        },
        draggable: editable && !n.global,
        selectable: n.kind !== 'note' || editable,
        zIndex: n.kind === 'note' ? -1 : 1,
        data: { node: n },
      })),
    [graph, editable],
  )
  const edges = useMemo<RFEdge[]>(
    () =>
      graph.edges.map<RFEdge>((e) => ({
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
      {...{
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
        pan,
        toolbar,
        here,
        onEnter,
        onLeave,
        picked,
        onSelectMany,
        missing,
      }}
      onAddGuard={here ? undefined : onAddGuard}
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
          {scope && onLeave && <IconButton icon={CornerLeftUp} size="sm" label={t('回到上一层')} onClick={onLeave} />}
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
  here,
  onEnter,
  onLeave,
  picked,
  onSelectMany,
  missing,
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
  here: string
  onEnter?: (path: GtPath, step: GtStep) => void
  onLeave?: () => void
  picked?: string[]
  onSelectMany?: (s: BpSelection[]) => void
  missing?: ReadonlySet<string>
}) {
  const pickedSet = useMemo(() => new Set(picked ?? []), [picked])
  const [searching, setSearching] = useState(false)
  const [mini, setMini] = useMiniMapPref()
  // 进到块里面、回到上一层：换了一层就把这一层的节点收进视口（第一次打开由 ReadableFit 管）
  const lastHere = useRef(here)
  useEffect(() => {
    if (lastHere.current === here) return
    lastHere.current = here
    const id = requestAnimationFrame(() => void rf.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 150 }))
    return () => cancelAnimationFrame(id)
  }, [here])
  const wrap = useRef<HTMLDivElement>(null)
  // ReactFlow 实例要在 GraphCanvas 里面才有：坐标换算放进 Bridge 里拿，存进 ref
  const rf = useRef<ReturnType<typeof useReactFlow> | null>(null)
  const toFlow = (x: number, y: number) => rf.current?.screenToFlowPosition({ x, y }) ?? { x, y }
  // 拖线到空白处松手弹菜单时，那根线留着连到菜单（用户 2026-11-19）：菜单关掉（选了或取消）才拿掉
  const [pending, setPending] = useState<{ node: string; pin: string; x: number; y: number }>()
  const shownNodes = useMemo<RFNode[]>(
    () =>
      pending
        ? [
            ...nodes,
            {
              id: PENDING,
              type: 'ghost',
              position: { x: pending.x, y: pending.y },
              draggable: false,
              selectable: false,
              data: { node: { id: PENDING, kind: 'note', x: pending.x, y: pending.y, outs: [], input: false } },
            },
          ]
        : nodes,
    [nodes, pending],
  )
  const shownEdges = useMemo<RFEdge[]>(
    () =>
      pending
        ? [
            ...edges,
            {
              id: PENDING,
              source: pending.node,
              sourceHandle: pending.pin,
              target: PENDING,
              targetHandle: 'in',
              type: 'pending',
              selectable: false,
            },
          ]
        : edges,
    [edges, pending],
  )
  // 右键拖画布松手也会触发 contextmenu：按下和松开离得远就当是拖动，不弹菜单
  const down = useRef({ x: 0, y: 0 })

  /** 节点菜单：选一种节点，放在 (clientX, clientY)。from 给了就插在这个引脚后面并连上，不给就是一个没连上的节点 */
  const pickNode = (clientX: number, clientY: number, from?: BpAt, extra: MenuItem[] = [], onClose?: () => void) => {
    const p = toFlow(clientX, clientY)
    const e = new globalThis.MouseEvent('contextmenu', { clientX, clientY })
    const place = (step: GtStep) => {
      if (from) {
        const r = insertAtPin(doc, from, [step], p.x, p.y)
        apply(r?.doc, r?.path)
      } else {
        const r = addLoose(doc, [step], p.x, p.y, here)
        apply(r.doc, r.path)
      }
    }
    openMenu(
      e,
      [
        ...extra,
        // 子图放最上面（用户 2026-11-19）：空的双击进去自己连，在检查器里选了脚本就跑那个脚本；下面的分类里不再重复
        {
          label: t('子图'),
          icon: Layers,
          hint: t('空的，双击进去自己连'),
          onClick: () => place(blockOf('group')!.make()),
        },
        'sep',
        ...insertMenuItems((it) => place(it.make()), ['group']),
      ],
      { search: t('找节点：输入名字…'), onClose },
    )
  }

  const ctx = useMemo<BpCtx>(
    () => ({
      run,
      editable,
      missing,
      linked: linkedPins(graph),
      selected,
      picked: pickedSet,
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
    [run, editable, missing, selected, pickedSet, doc, graph, apply],
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
    if (!pin) return
    const p = toFlow(pt.clientX, pt.clientY)
    const node = s.fromNode.id
    const handle = pin.id
    setPending({ node, pin: handle, x: p.x, y: p.y })
    const mine = (cur?: { node: string; pin: string }) => cur?.node === node && cur.pin === handle
    pickNode(pt.clientX, pt.clientY, pin.at, [], () => setPending((cur) => (mine(cur) ? undefined : cur)))
    // 菜单贴着窗口边时会挪开：等它弹出的动画放完、摆好了，线头接到菜单左边第一行
    setTimeout(() => {
      const r = document.querySelector<HTMLElement>('[role="menu"][data-floating]')?.getBoundingClientRect()
      if (!r) return
      const q = toFlow(r.left, r.top + 18)
      setPending((cur) => (mine(cur) ? { node, pin: handle, x: q.x, y: q.y } : cur))
    }, 220)
  }

  const paneMenu = (e: MouseEvent | globalThis.MouseEvent) => {
    if (!editable) return
    e.preventDefault()
    if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4) return
    const p = toFlow(e.clientX, e.clientY)
    pickNode(
      e.clientX,
      e.clientY,
      undefined,
      [
        onAddGuard && { label: t('加守护'), icon: ShieldCheck, onClick: onAddGuard },
        { label: t('加注释框'), icon: StickyNote, onClick: () => apply(addNote(doc, p.x, p.y, '', here)) },
        {
          label: t('全部收进视口'),
          icon: Maximize,
          onClick: () => void rf.current?.fitView({ padding: 0.1, duration: 200 }),
        },
        'sep',
      ].filter(Boolean) as MenuItem[],
    )
  }

  // 只认这一层图里还在的：进到块里面以后，画布还会把上一层选着的节点报上来一次
  const stepSels = (ns: { id: string; data: BpData }[]) =>
    ns
      .filter((n) => byId.has(n.id))
      .map((n) => n.data.node)
      .filter((n) => n.kind === 'step')
      .map(selOf)
      .filter(Boolean) as BpSelection[]
  /** 画布自己的快捷键（keys.ts）：处理了就不再往外传给编辑命令 */
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
    const hit = (k: { match?: (e: React.KeyboardEvent) => boolean }) => k.match?.(e)
    const sel = selected ? byId.get(selected) : undefined
    let done = true
    if (hit(CANVAS_KEYS.selectAll)) onSelectMany?.(stepSels(nodes))
    else if (hit(CANVAS_KEYS.focus)) {
      const ids = picked?.length ? picked : selected ? [selected] : []
      void rf.current?.fitView({
        nodes: ids.length ? ids.map((id) => ({ id })) : undefined,
        padding: 0.3,
        maxZoom: 1.2,
        duration: 200,
      })
    } else if (hit(CANVAS_KEYS.fit)) void rf.current?.fitView({ padding: 0.1, duration: 200 })
    else if (hit(CANVAS_KEYS.deselect)) onSelect?.(undefined)
    else if (hit(CANVAS_KEYS.enter) && sel?.step && sel.path && isSubgraph(sel.step)) onEnter?.(sel.path, sel.step)
    else if (hit(CANVAS_KEYS.leave) && here && onLeave) onLeave()
    else if (hit(CANVAS_KEYS.search)) setSearching(true)
    else done = false
    if (!done) return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <BpContext.Provider value={ctx}>
      <div
        ref={wrap}
        tabIndex={-1}
        className="ue:h-full ue:w-full ue:outline-none"
        onKeyDown={onKey}
        onPointerDownCapture={(e) => {
          down.current = { x: e.clientX, y: e.clientY }
          // 画布按下会阻止默认动作、拿不到焦点：自己拿，Delete、Ctrl+C 这些快捷键才收得到
          if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable]'))
            wrap.current?.focus({ preventScroll: true })
        }}
        // 画布空白处右键弹节点菜单：React Flow 开了右键拖动画布时会把空白处的右键菜单吞掉（不调 onPaneContextMenu），
        // 只能在外面接冒上来的事件（用户 2026-11-19：不拖线、直接右键也要弹）
        onContextMenu={(e) => {
          if ((e.target as Element).closest('.react-flow__pane')) paneMenu(e)
        }}
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
                const x = addLoose(doc, [r.group], p.x, p.y, here)
                apply(x.doc, x.path)
                if (r.warn) h().toast.error(r.warn)
              },
              (err: Error) => h().toast.error(err.message),
            )
          const r = addLoose(doc, steps, p.x, p.y, here)
          apply(r.doc, r.path)
        }}
      >
        <GraphCanvas<RFNode, RFEdge>
          frameClassName="ue:h-full ue:w-full"
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={BP_NODE_TYPES}
          edgeTypes={BP_EDGE_TYPES}
          editable={editable}
          panMode={pan}
          nodesConnectable={editable}
          deleteKeyCode={null}
          elevateNodesOnSelect={false}
          minimap={mini ? 6 : false}
          autoFit={false}
          miniColor={miniOf(run)}
          connectionRadius={28}
          isValidConnection={(c) => byId.get(c.target)?.kind === 'step' && c.targetHandle === 'in'}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          // 框选：选中的步骤交给外壳（Delete、复制、包成段都按它）；数据一变画布会清掉自己的选中，空的不当回事
          onSelectionChange={({ nodes: ns }) => {
            const list = stepSels(ns as RFNode[])
            if (list.length) onSelectMany?.(list)
          }}
          onNodeDragStop={(_, __, moved) =>
            apply(
              moveNodes(
                doc,
                graph,
                moved.map((n) => ({ key: n.id, x: n.position.x, y: n.position.y })),
              ),
            )
          }
          onNodeClick={(_, n) => onSelect?.(selOf(n.data.node))}
          onNodeDoubleClick={(_, n) => {
            const node = n.data.node
            // 块、调用别的脚本：进到里面看（子图），顶上路径显示在第几层
            if (node.step && node.path && isSubgraph(node.step)) onEnter?.(node.path, node.step)
          }}
          onNodeContextMenu={(e, n) => {
            const node = n.data.node
            if (node.kind === 'note' && editable && node.note) {
              const id = node.note.id
              return openMenu(e, [
                { label: t('删掉注释框'), danger: true, onClick: () => apply(updateNote(doc, id, undefined)) },
              ])
            }
            const s = selOf(node)
            if (!s || !onNodeMenu) return
            e.preventDefault()
            onSelect?.(s)
            onNodeMenu(s, e)
          }}
          onPaneClick={() => onSelect?.(undefined)}
        >
          <Bridge into={rf} />
          <ReadableFit />
          <CanvasToolbar>
            {toolbarLeft}
            <NodeSearch
              open={searching}
              setOpen={(v) => {
                setSearching(v)
                if (!v) wrap.current?.focus({ preventScroll: true })
              }}
              nodes={graph.nodes}
              onPick={(n) => {
                const s = selOf(n)
                if (s) onSelect?.(s)
              }}
            />
            {editable && <AlignTools onMove={(m) => apply(moveNodes(doc, graph, m))} />}
            {toolbar && <CanvasToolbarSep />}
            {toolbar}
            <CanvasToolbarSep />
            <ZoomReadout />
            <MiniMapToggle on={mini} onChange={setMini} />
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
