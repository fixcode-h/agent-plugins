import { getNodesBounds, useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'
import { useEffect, useRef } from 'react'

/** 最小缩放：再小节点上的字就看不清了（效果图 1 的画面差不多是原大） */
const MIN_ZOOM = 0.75
const PAD = 48

/**
 * GameTest 流程图打开时的视口：放得下就整张居中；放不下时不缩到看不清，按原大附近从「开始」那一侧显示，
 * 主流程那一行放在画布偏上，守护栏在下面露出来，剩下的靠拖动和小地图。
 * 面板通用画布的自动适配为了尽量放下整张图最小缩到 0.45，脚本稍长字就小得没法看，所以这里自己算一次。
 * 只在第一次量好尺寸时做，之后用户怎么拖就怎么样
 */
export function ReadableFit() {
  const rf = useReactFlow()
  const ready = useNodesInitialized()
  const dom = useStore((s) => s.domNode)
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current || !dom) return
    const nodes = rf.getNodes()
    const W = dom.clientWidth
    const H = dom.clientHeight
    if (!nodes.length || !W || !H) return
    done.current = true
    const b = getNodesBounds(nodes)
    const fit = Math.min((W - PAD * 2) / b.width, (H - PAD * 2) / b.height)
    const zoom = Math.max(MIN_ZOOM, Math.min(1, fit))
    if (zoom <= fit) {
      void rf.setViewport({ x: (W - b.width * zoom) / 2 - b.x * zoom, y: (H - b.height * zoom) / 2 - b.y * zoom, zoom })
      return
    }
    const start = nodes.find((n) => n.id === '#start')
    const rowY = start ? start.position.y : b.y
    void rf.setViewport({ x: PAD - b.x * zoom, y: Math.max(PAD - b.y * zoom, H * 0.35 - rowY * zoom), zoom })
  }, [ready, dom, rf])
  return null
}
