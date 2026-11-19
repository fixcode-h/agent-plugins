import { SlidersHorizontal, X } from 'lucide-react'
import { op, useLoad } from '../../../api.ts'
import type { Comp } from '../../../CompTree.tsx'
import { useUe } from '../../../ctx.tsx'
import { PropMarksCtx } from '../../../details/marks.ts'
import { h, t } from '../../../host.ts'
import { Props } from '../../../Props.tsx'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import { Badge, Card, ErrorText } from '../../../ui.tsx'
import type { LayoutProps } from '../types.ts'
import type { GNode } from './graph.ts'
import { typeTone } from './model.ts'

/**
 * 右栏（效果图 A1–A3 右边）：
 * - 图表里选中了节点：节点的引脚、默认值和连线（bp.graph node=…，点连线跳到那头的节点）；
 * - 选中了组件：组件模板的细节（真实细节面板，能改，和资源页一样）；
 * - 什么都没选（或点了组件树顶上的「自身」）：类默认值，AssetForge 的导入标注只标在这里
 */
export function BpDetails({
  path,
  comp,
  node,
  onNode,
  onOpen,
  hint,
  marks,
}: Pick<LayoutProps, 'path' | 'onOpen' | 'hint' | 'marks'> & {
  comp?: Comp
  node: string
  onNode: (id: string) => void
}) {
  if (node) return <NodePins path={path} id={node} onNode={onNode} />
  const target = comp?.path ?? path
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <SlidersHorizontal className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {comp ? t('细节') : t('类默认值')}
        </>
      }
      aside={comp && <span className="ue:truncate">{`${comp.name} · ${comp.class}`}</span>}
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      <PropMarksCtx.Provider value={comp ? null : (marks ?? null)}>
        <Props key={target} path={target} bar noFns onOpen={onOpen} readOnlyHint={hint} />
      </PropMarksCtx.Provider>
    </Card>
  )
}

interface NodeFull extends GNode {
  class?: string
  tooltip?: string
  x?: number
  y?: number
}

/** 选中节点的细节：种类、类名、提示，下面引脚表（方向、名字、类型色点、默认值、连到哪） */
function NodePins({ path, id, onNode }: { path: string; id: string; onNode: (id: string) => void }) {
  const { project } = useUe()
  const { ui } = h()
  const d = useLoad(
    () => op<{ graph: string; node: NodeFull }>(project.id, 'bp.graph', { path, node: id }, undefined, 60000),
    [project.id, path, id],
  )
  const n = d.data?.node
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={<span className="ue:truncate">{n?.title ?? `#${id}`}</span>}
      aside={<ui.IconButton icon={X} size="sm" label={t('关闭')} onClick={() => onNode('')} />}
      bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto"
    >
      <div className="ue:flex ue:flex-col ue:gap-2 ue:p-3 ue:text-footnote">
        <ErrorText>{d.error || n?.error}</ErrorText>
        {n && (
          <>
            <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
              {n.class && <Badge>{n.class}</Badge>}
              {d.data?.graph && <Badge>{d.data.graph}</Badge>}
              {n.member && <Badge tone="accent">{n.member}</Badge>}
              <span className="ue:font-mono ue:text-caption ue:text-subtle">#{n.id}</span>
            </div>
            {n.comment && <p className="ue:text-subtle">{n.comment}</p>}
            {n.tooltip && <p className="ue:text-caption ue:text-subtle">{n.tooltip}</p>}
            <table className="ue:w-full ue:border-separate ue:border-spacing-0">
              <tbody>
                {n.pins.map((p) => (
                  <tr key={p.dir + p.name} className="ue:align-top">
                    <td className="ue:w-8 ue:py-1 ue:text-caption ue:text-subtle">
                      {p.dir === 'in' ? t('入') : t('出')}
                    </td>
                    <td className="ue:py-1 ue:pr-2">
                      <span className="ue:flex ue:items-center ue:gap-1.5">
                        <span
                          aria-hidden
                          className="ue:h-2 ue:w-2 ue:shrink-0 ue:rounded-full"
                          style={{ background: toneColor(typeTone(p.type)) }}
                        />
                        <span className="ue:font-mono ue:text-fg">{p.name}</span>
                      </span>
                      <span className="ue:text-caption ue:text-subtle">{p.type}</span>
                    </td>
                    <td className="ue:py-1 ue:font-mono ue:break-all">
                      {(p.to ?? []).map((link) => (
                        <button
                          key={link}
                          type="button"
                          className="ue:mr-2 ue:block ue:cursor-pointer ue:text-left ue:text-accent-text ue:hover:underline"
                          onClick={() => onNode(link.split('.')[0])}
                        >
                          {p.dir === 'in' ? '←' : '→'} {link}
                        </button>
                      ))}
                      {p.default !== undefined && <span className="ue:text-subtle">= {p.default}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Card>
  )
}
