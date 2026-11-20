import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import type { CommentBox } from './graph.ts'
import { UE_CANVAS, UE_COMMENT, UE_TEXT } from './ue-theme.ts'

export type CommentBoxData = { box: CommentBox; picked: boolean }

/** UE 的注释颜色是 sRGB #rrggbb；只认这个写法，别的（或没给）用 UE 默认的白色，不拼不认识的字符串进样式 */
const safeColor = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : UE_COMMENT.fallback)

const alpha = (c: string, a: number) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`

/**
 * 注释框（UELink 2.18 bp.layout 给了位置、大小、颜色）：照 UE 画在节点下面，半透明的色块，顶上一条更深的标题条，标题字大。
 * 点标题条选中（右栏看注释节点的细节），框体不拦点击，下面的节点照常能点
 */
function CommentBoxView({ data, selected }: NodeProps<Node<CommentBoxData>>) {
  const ink = safeColor(data.box.color)
  const on = data.picked || !!selected
  return (
    <div
      className="ue:pointer-events-none ue:h-full ue:w-full ue:rounded-[4px]"
      style={{
        background: alpha(ink, UE_COMMENT.bodyAlpha),
        boxShadow: on ? `0 0 0 2px ${UE_CANVAS.selected}` : `0 0 0 1px ${alpha(ink, 0.3)}`,
      }}
    >
      <div
        className="ue:pointer-events-auto ue:cursor-pointer ue:truncate ue:rounded-t-[4px] ue:px-2.5 ue:py-1 ue:text-[18px] ue:font-semibold ue:leading-tight"
        style={{
          background: alpha(ink, UE_COMMENT.titleAlpha),
          color: UE_COMMENT.text,
          textShadow: UE_COMMENT.textShadow,
          ...UE_TEXT,
        }}
      >
        {data.box.node.title}
      </div>
    </div>
  )
}

export const CommentBoxNode = memo(CommentBoxView)
