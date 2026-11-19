import { ExternalLink, Hammer, X } from 'lucide-react'
import { useState } from 'react'
import { op, useAction, useLoad } from '../../../api.ts'
import { PseudoLine } from '../../../Blueprint.tsx'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { Badge, ErrorText, Term, type Tone } from '../../../ui.tsx'
import type { GNode } from './graph.ts'
import { GraphCanvasView } from './GraphCanvasView.tsx'
import type { BpOutline } from './model.ts'
import { graphLabel } from './MyBlueprint.tsx'

/** 一次最多画这么多节点（bp.graph 的 limit 上限 300）；再多的看伪代码 */
const LIMIT = 300

const STATUS: Record<string, { tone: Tone; label: () => string }> = {
  ok: { tone: 'ok', label: () => t('编译通过') },
  warnings: { tone: 'warn', label: () => t('有警告') },
  error: { tone: 'danger', label: () => t('编译出错') },
  dirty: { tone: 'warn', label: () => t('改了没编译') },
}

/**
 * 图表视图（效果图 A2 中间）：上面一排打开的图做成页签（左栏「我的蓝图」点开的，和它同步高亮），
 * 工具条切「节点图 / 伪代码」、编译、在 UE 里打开；节点图是网页按 UE 导出的节点和连线画的（不是截图），只读，点节点在右栏看引脚。
 * UELink 的节点列表不带坐标，节点按连线自动排，位置和 UE 里不一样（工具条上写明）
 */
export function GraphPane({
  path,
  outline,
  tabs,
  active,
  onActive,
  onClose,
  picked,
  onPick,
  onCompiled,
}: {
  path: string
  outline?: BpOutline
  tabs: string[]
  active: string
  onActive: (name: string) => void
  onClose: (name: string) => void
  picked: string
  onPick: (id: string) => void
  onCompiled: () => void
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const [format, setFormat] = useKept<'nodes' | 'pseudo'>(`${project.id}/bp/graph-format`, 'nodes')
  const [compiled, setCompiled] = useState<string>()
  const body = useLoad(
    () =>
      active
        ? op<{ pseudo?: string; more?: boolean; nodes?: GNode[]; total: number; next?: number }>(
            project.id,
            'bp.graph',
            format === 'pseudo' ? { path, graph: active } : { path, graph: active, format: 'json', limit: LIMIT },
            undefined,
            120000,
          ).then((r) => ({ key: `${active}/${format}`, r }))
        : Promise.resolve(undefined),
    [project.id, path, active, format],
  )
  const data = body.data?.key === `${active}/${format}` ? body.data.r : undefined
  const status = STATUS[compiled ?? outline?.compile?.status ?? outline?.status ?? '']
  const kind = (name: string) => outline?.graphs.find((g) => g.name === name)?.kind

  const compile = () =>
    run('compile', async () => {
      const r = await op<{ compile: { status: string } }>(project.id, 'bp.compile', { path }, undefined, 300000)
      setCompiled(r.compile.status)
      body.reload()
      onCompiled()
    })

  return (
    <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-card">
      <div className="ue:flex ue:min-h-10 ue:items-end ue:gap-1 ue:overflow-x-auto ue:border-b ue:border-line ue:px-2">
        {tabs.map((name) => (
          <div
            key={name}
            className={cn(
              'ue:flex ue:h-9 ue:shrink-0 ue:items-center ue:gap-1 ue:rounded-t-md ue:border ue:border-b-0 ue:pr-1 ue:pl-3 ue:text-footnote',
              name === active ? 'ue:border-line ue:bg-panel ue:text-fg' : 'ue:border-transparent ue:text-subtle',
            )}
          >
            <button type="button" className="ue:cursor-pointer ue:truncate" onClick={() => onActive(name)}>
              {graphLabel(name, kind(name))}
              {kind(name) === 'function' && name !== 'UserConstructionScript' && (
                <span className="ue:ml-1 ue:text-caption ue:text-subtle">{t('函数')}</span>
              )}
              {kind(name) === 'macro' && <span className="ue:ml-1 ue:text-caption ue:text-subtle">{t('宏')}</span>}
            </button>
            <ui.IconButton icon={X} size="sm" label={t('关闭')} onClick={() => onClose(name)} />
          </div>
        ))}
        <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:self-center">
          {status && <Badge tone={status.tone}>{status.label()}</Badge>}
          <ui.Segmented
            size="sm"
            label={t('节点图 / 伪代码')}
            value={format}
            onChange={setFormat}
            options={[
              { id: 'nodes', label: t('节点图') },
              { id: 'pseudo', label: t('伪代码') },
            ]}
          />
          <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void compile()}>
            <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')}
          </ui.Button>
          <ui.IconButton
            icon={ExternalLink}
            size="sm"
            label={t('在 UE 里打开')}
            onClick={() => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))}
          />
        </div>
      </div>
      {active && (
        <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
          <span className="ue:truncate">
            {outline?.name} › {graphLabel(active, kind(active))}
          </span>
          {data && <span>{t('{n} 个节点 · 只读', { n: data.total })}</span>}
          {format === 'nodes' && data?.next !== undefined && (
            <span className="ue:text-warning">{t('太大，只画了前 {n} 个；全部看伪代码', { n: LIMIT })}</span>
          )}
          {format === 'nodes' && (
            <span className="ue:ml-auto ue:shrink-0">{t('按连线自动排布（UELink 不给节点坐标）')}</span>
          )}
        </div>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        {!active && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('在左边「我的蓝图」里点一张图打开')}</p>}
        {body.error && (
          <div className="ue:p-4">
            <ErrorText>{body.error}</ErrorText>
          </div>
        )}
        {data?.nodes && <GraphCanvasView key={active} nodes={data.nodes} picked={picked} onPick={onPick} />}
        {data?.pseudo !== undefined && (
          <Term className="ue:m-3 ue:min-h-0 ue:flex-1">
            {data.pseudo.split('\n').map((line, i) => (
              <PseudoLine key={i} line={line} active={picked} onNode={onPick} />
            ))}
            {data.more && <div className="ue:mt-2 ue:text-term-dim">{t('太长，后面的没有显示')}</div>}
          </Term>
        )}
      </div>
    </section>
  )
}
