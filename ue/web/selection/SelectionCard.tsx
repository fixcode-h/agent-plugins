import { Box, FileBox, MousePointerClick, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Card, ErrorText } from '../ui.tsx'
import { useEditorSelection } from './use-selection.ts'

/**
 * 概览右栏「编辑器里选中」（设计稿「UE 插件优化与扩展」二 P0、效果图 1）：关卡里选中的 Actor、内容浏览器选中的资源、
 * 蓝图编辑器选中的节点，点了在对象页 / 资源页打开。同样的内容 Agent 在 ue_status 里也拿得到。
 * 编辑器没开时不占地方；桥接旧（没有 editor.selection）时说一句要升级
 */
export function SelectionCard() {
  const { go } = useUe()
  const sel = useEditorSelection()
  if (!sel.inst) return null
  const title = (
    <>
      <MousePointerClick className="ue:h-4 ue:w-4" /> {t('编辑器里选中')}
    </>
  )
  if (!sel.supported)
    return (
      <Card title={title}>
        <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
          {t('UELink 升级到 2.4 后，编辑器里选中的 Actor 和资源会显示在这里，也会告诉 Agent')}
        </p>
      </Card>
    )
  const d = sel.data
  const empty = d && !d.actors.length && !d.assets.length && !d.blueprint?.nodes.length
  return (
    <Card title={title}>
      <div className="ue:flex ue:flex-col ue:py-1">
        <div className="ue:px-4">
          <ErrorText>{sel.error}</ErrorText>
        </div>
        {empty && <p className="ue:px-4 ue:py-2 ue:text-footnote ue:text-subtle">{t('编辑器里现在什么都没选中')}</p>}
        {d?.actors.slice(0, 5).map((a) => (
          <Row key={a.path} icon={Box} label={a.label || a.name} aside={a.class} onClick={() => go('objects', a.path)} />
        ))}
        {d && d.actorCount > 5 && <More n={d.actorCount - 5} />}
        {d?.assets.slice(0, 5).map((a) => (
          <Row key={a.path} icon={FileBox} label={a.name} aside={a.class} onClick={() => go('assets', a.path)} />
        ))}
        {d && d.assets.length > 5 && <More n={d.assets.length - 5} />}
        {d?.blueprint && d.blueprint.nodes.length > 0 && (
          <Row
            icon={Workflow}
            label={`${d.blueprint.path.split('/').pop()} · ${d.blueprint.nodes.map((n) => n.title).join('、')}`}
            aside={d.blueprint.graph}
            onClick={() => go('assets', d.blueprint!.path)}
          />
        )}
      </div>
    </Card>
  )
}

function Row({ icon: Icon, label, aside, onClick }: { icon: typeof Box; label: ReactNode; aside?: string; onClick: () => void }) {
  const { cn } = h()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'ue:flex ue:min-h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-4 ue:text-left ue:hover:bg-hover',
      )}
    >
      <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-body ue:text-fg">{label}</span>
      {aside && <span className="ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">{aside}</span>}
    </button>
  )
}

const More = ({ n }: { n: number }) => (
  <p className="ue:px-4 ue:py-1 ue:text-caption ue:text-subtle">{t('还有 {n} 个', { n })}</p>
)
