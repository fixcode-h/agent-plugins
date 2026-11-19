import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { h } from '../../../host.ts'
import type { CommentBox } from './graph.ts'

export type CommentBoxData = { box: CommentBox; picked: boolean }

/** UE 的注释颜色是 sRGB #rrggbb；只认这个写法，别的（或没给）用主题的淡色，不拼不认识的字符串进样式 */
const safeColor = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined)

/**
 * 注释框（UELink 2.18 bp.layout 给了位置、大小、颜色）：照 UE 画在节点下面，标题条用注释的颜色，框体是同色的淡底。
 * 点标题条选中（右栏看注释节点的细节），框体不拦点击，下面的节点照常能点
 */
function CommentBoxView({ data }: NodeProps<Node<CommentBoxData>>) {
  const { cn } = h()
  const ink = safeColor(data.box.color) ?? 'var(--subtle)'
  return (
    <div
      className={cn(
        'ue:pointer-events-none ue:h-full ue:w-full ue:rounded-md ue:border',
        data.picked && 'ue:ring-2 ue:ring-accent',
      )}
      style={{
        borderColor: `color-mix(in oklab, ${ink} 55%, transparent)`,
        background: `color-mix(in oklab, ${ink} 10%, transparent)`,
      }}
    >
      <div
        className="ue:pointer-events-auto ue:cursor-pointer ue:truncate ue:rounded-t-md ue:px-2 ue:py-1 ue:text-footnote ue:font-medium ue:text-fg"
        style={{ background: `color-mix(in oklab, ${ink} 35%, transparent)` }}
      >
        {data.box.node.title}
      </div>
    </div>
  )
}

export const CommentBoxNode = memo(CommentBoxView)
