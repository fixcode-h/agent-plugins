import { useEffect, useMemo, useRef } from 'react'
import { getNodesBounds, Panel, useNodesInitialized, useReactFlow, useStore, type Edge, type Node } from '@xyflow/react'
import { MessageSquare } from 'lucide-react'
import { GraphCanvas } from '@panel/web/src/components/flow/GraphCanvas'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import { layoutGraph, type GNode } from './graph.ts'
import type { CommentBoxData } from './CommentBox.tsx'
import { GRAPH_NODE_TYPES, type GraphNodeData } from './GraphNode.tsx'
import { typeTone } from './model.ts'

type AnyNode = Node<GraphNodeData> | Node<CommentBoxData>

/**
 * 图表的节点图（效果图 A2 中间）：bp.graph 的节点有 UE 坐标（2.18 bp.layout）时照原位置画、注释画成框，
 * 没坐标时按连线自动排（graph.ts）；用面板共用的流程图画布画，只读。
 * 打开时按可读的缩放显示（TopLeftFit），放不下就从左上角开始，靠拖动和小地图看其余。
 * 执行线粗一点、用前景色，数据线按类型上色（和引脚同色）；没有框位置的注释节点列在左上角
 */
export function GraphCanvasView({
  nodes: raw,
  picked,
  onPick,
}: {
  nodes: GNode[]
  picked: string
  onPick: (id: string) => void
}) {
  const laid = useMemo(() => layoutGraph(raw), [raw])
  const nodes = useMemo<AnyNode[]>(
    () => [
      // 注释框先放（画在节点下面），zIndex 再压一层保险
      ...laid.boxes.map(
        (b): Node<CommentBoxData> => ({
          id: b.node.id,
          type: 'comment',
          position: { x: b.x, y: b.y },
          width: b.w,
          height: b.h,
          zIndex: -1,
          data: { box: b, picked: b.node.id === picked },
          selectable: true,
        }),
      ),
      ...laid.nodes.map(
        (p): Node<GraphNodeData> => ({
          id: p.node.id,
          type: 'bp',
          position: { x: p.x, y: p.y },
          width: p.w,
          height: p.h,
          data: { placed: p, picked: p.node.id === picked },
          selectable: true,
        }),
      ),
    ],
    [laid, picked],
  )
  const edges = useMemo<Edge[]>(
    () =>
      laid.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        sourceHandle: `out:${e.fromPin}`,
        targetHandle: `in:${e.toPin}`,
        style: {
          stroke: toneColor(typeTone(e.type)),
          strokeWidth: e.exec ? 2.2 : 1.6,
          opacity: picked && e.from !== picked && e.to !== picked ? 0.35 : 0.9,
        },
      })),
    [laid, picked],
  )
  return (
    <GraphCanvas<AnyNode, Edge>
      frameClassName="ue:min-h-0 ue:flex-1"
      nodes={nodes}
      edges={edges}
      nodeTypes={GRAPH_NODE_TYPES}
      onNodeClick={(_, n) => onPick(n.id)}
      onPaneClick={() => onPick('')}
      minimap={12}
      // 面板画布的自动适配为了放下整张图会缩到字看不清；和 GameTest 流程图一样不小于 0.75，放不下从左上角看起
      autoFit={false}
      // 照 UE 蓝图编辑器：右键（或中键）拖画布，左键点选节点 / 连线、空白处拉框选（用户 2026-11-20）。
      // 共用画布只读时默认左键也拖画布，这里覆盖回来；节点仍不能拖、不能连线（只读）
      panOnDrag={[1, 2]}
      selectionOnDrag
    >
      <TopLeftFit />
      {laid.comments.length > 0 && (
        <Panel position="top-left">
          <div className="ue:flex ue:max-w-80 ue:flex-col ue:gap-1">
            {laid.comments.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:truncate ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1 ue:text-left ue:text-caption ue:text-fg ue:shadow-card ue:hover:bg-hover"
              >
                <MessageSquare className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                <span className="ue:truncate">{c.title}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </GraphCanvas>
  )
}

const MIN_ZOOM = 0.75
const PAD = 40

/**
 * 打开时的视口：放得下整张居中；放不下时不缩到字看不清（不小于 0.75），从左上角（事件节点那一侧）看起。
 * 和 GameTest 流程图的 ReadableFit 一个意思，只是蓝图图表没有「开始」节点，直接对齐左上角。只在第一次量好尺寸时做
 */
function TopLeftFit() {
  const rf = useReactFlow()
  const ready = useNodesInitialized()
  const dom = useStore((s) => s.domNode)
  // 画布尺寸也作依赖：页签刚打开时容器可能还是 0 高（布局没排完），那次量不到就跳过，
  // 等尺寸出来再做；以前只看 ready/dom，第一次量到 0 就再也不做，节点按 UE 坐标落在视口外，看着是空白（用户 2026-11-20 报）
  const W = useStore((s) => s.width)
  const H = useStore((s) => s.height)
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current || !dom) return
    const nodes = rf.getNodes()
    if (!nodes.length || !W || !H) return
    done.current = true
    const b = getNodesBounds(nodes)
    const fit = Math.min((W - PAD * 2) / b.width, (H - PAD * 2) / b.height)
    const zoom = Math.max(MIN_ZOOM, Math.min(1, fit))
    if (zoom <= fit)
      void rf.setViewport({ x: (W - b.width * zoom) / 2 - b.x * zoom, y: (H - b.height * zoom) / 2 - b.y * zoom, zoom })
    else void rf.setViewport({ x: PAD - b.x * zoom, y: PAD + 56 - b.y * zoom, zoom })
  }, [ready, dom, rf, W, H])
  return null
}
