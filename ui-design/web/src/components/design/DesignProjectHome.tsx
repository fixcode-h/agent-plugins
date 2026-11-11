import { useState } from 'react'
import { ChevronRight, Gamepad2, Globe, Palette, Plus, Settings2 } from 'lucide-react'
import type { DesignMeta, DesignProject, DesignKind } from '@shared/design'
import { timeAgo } from '@shared/task'
import { useNav } from '@/lib/data'
import { useDesignData } from '@/lib/design-store'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyPanel } from '@/components/ui/empty-panel'
import { DesignProjectDialog, type DesignProjectSection } from '@/components/design/DesignProjectDialog'
import { designKind, groupByKind, kindLabel, projectDesigns, projectSummary } from '@/lib/design-projects'
import { t } from '@shared/i18n'

/** 分类的图标：和侧栏用同一套，新增一种界面类型时在这里加一行 */
const KIND_ICON: Record<DesignKind, typeof Gamepad2> = { game: Gamepad2, web: Globe }

/**
 * UI 项目主页：参考 Agent 的项目主页（上面是项目名和概况，下面是这个项目里的东西）。
 * 这里列的是这个项目里的各个界面，点一行进设计器；新建设计先回主页，进了设计器再点。
 */
export function DesignProjectHome({ projectId }: { projectId: string }) {
  const { designProjects, designProjectsLoaded, designs } = useDesignData()
  const { go } = useNav()
  const [editing, setEditing] = useState<DesignProject>()
  const [section, setSection] = useState<DesignProjectSection>('general')
  const project = designProjects.find((p) => p.id === projectId)
  const list = projectDesigns(designs, projectId)
  const groups = groupByKind(list)
  // 有正在跑的设计时每秒刷新，「N 分钟前」跟着走
  const now = useNow(list.some((d) => d.running))

  // 列表还没取回来时不能当成「项目被删了」：直接从地址进主页会先遇到空列表（data.tsx 的初值是 []），
  // 先渲染一个空壳，取回来再判。取失败时 designProjectsLoaded 也置真，不会一直停在这里
  if (!project && !designProjectsLoaded) return <main className="ud:flex-1" data-design-home={projectId} />
  if (!project) {
    return (
      <div className="ud:grid ud:flex-1 ud:place-items-center ud:p-8 ud:text-center ud:text-body ud:text-muted">
        <div>
          <p>{t('这个 UI 项目已经不在了。')}</p>
          <Button variant="ghost" className="ud:mt-3" onClick={() => go({ page: 'design' })}>
            {t('返回')}
          </Button>
        </div>
      </div>
    )
  }
  const summary = projectSummary(list, list[0]?.updatedAt ?? null)
  const openSettings = (s: DesignProjectSection) => {
    setSection(s)
    setEditing(project)
  }
  const newDesign = () => go({ page: 'design', id: 'new', sub: project.id })

  return (
    <main data-design-home={project.id} className="ud:flex ud:min-w-0 ud:flex-1 ud:flex-col ud:md:h-full">
      <div className="ud:flex ud:flex-1 ud:flex-col ud:md:min-h-0 ud:md:overflow-y-auto">
        <header className="ud:flex ud:h-14 ud:shrink-0 ud:items-center ud:gap-2 ud:px-3 ud:md:px-5">
          <Button variant="ghost" size="sm" className="ud:ml-auto" onClick={newDesign}>
            <Plus className="ud:h-4 ud:w-4" />
            {t('新建设计')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openSettings('general')}>
            <Settings2 className="ud:h-4 ud:w-4" />
            {t('项目设置')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openSettings('prompts')}>
            <Palette className="ud:h-4 ud:w-4" />
            {t('美术提示词')}
          </Button>
        </header>
        <div className="ud:mx-auto ud:flex ud:w-full ud:max-w-(--content-w) ud:flex-col ud:gap-8 ud:px-4 ud:pt-6 ud:pb-10 ud:md:px-6 ud:md:pt-12">
          <div className="ud:flex ud:flex-col ud:gap-2">
            <h1 className="ud:flex ud:items-center ud:gap-3 ud:font-serif ud:text-display ud:leading-tight ud:font-semibold ud:tracking-tight">
              <Palette className="ud:h-7 ud:w-7 ud:shrink-0 ud:text-accent-text" strokeWidth={2} />
              <span className="ud:min-w-0 ud:truncate">{project.name}</span>
            </h1>
            <p className="ud:flex ud:flex-wrap ud:items-center ud:gap-x-4 ud:gap-y-1 ud:text-body ud:text-subtle">
              <span>{t('{n} 个界面', { n: summary.total })}</span>
              {summary.games > 0 && (
                <span className="ud:flex ud:items-center ud:gap-1">
                  <Gamepad2 className="ud:h-3.5 ud:w-3.5" />
                  {t('游戏 UI {n} 个', { n: summary.games })}
                </span>
              )}
              {summary.webs > 0 && (
                <span className="ud:flex ud:items-center ud:gap-1">
                  <Globe className="ud:h-3.5 ud:w-3.5" />
                  {t('网页 UI {n} 个', { n: summary.webs })}
                </span>
              )}
              {summary.lastEdit && <span>{t('最近改动：{time}', { time: timeAgo(summary.lastEdit, now) })}</span>}
              {project.path && <span className="ud:max-w-full ud:truncate ud:font-mono">{project.path}</span>}
            </p>
          </div>

          {groups.length === 0 ? (
            <section className="ud:flex ud:flex-col">
              <h2 className="ud:mb-2 ud:flex ud:px-1 ud:text-xs ud:font-medium ud:text-subtle">
                <span className="ud:flex-1">{t('界面 · {n}', { n: 0 })}</span>
              </h2>
              <EmptyPanel as="div">
                <p>{t('这个项目里还没有界面。')}</p>
                <Button className="ud:mt-3" size="sm" onClick={newDesign}>
                  <Plus className="ud:h-4 ud:w-4" />
                  {t('新建设计')}
                </Button>
              </EmptyPanel>
            </section>
          ) : (
            groups.map((g) => {
              const Icon = KIND_ICON[g.kind]
              return (
                <section key={g.kind} className="ud:flex ud:flex-col">
                  <h2 className="ud:mb-2 ud:flex ud:items-center ud:gap-1.5 ud:px-1 ud:text-xs ud:font-medium ud:text-subtle">
                    <Icon className="ud:h-3.5 ud:w-3.5" />
                    <span>{kindLabel(g.kind)}</span>
                    <span className="ud:font-normal">· {g.items.length}</span>
                  </h2>
                  <ul className="ud:flex ud:flex-col ud:divide-y ud:overflow-hidden ud:rounded-xl ud:bg-card ud:shadow-card">
                    {g.items.map((d) => (
                      <DesignRow key={d.id} design={d} now={now} onOpen={() => go({ page: 'design', id: d.id })} />
                    ))}
                  </ul>
                </section>
              )
            })
          )}
        </div>
      </div>
      <DesignProjectDialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        project={editing}
        section={section}
        // 在主页里改完项目不回新建页：留在主页看这个名字下的界面
        onSaved={() => setEditing(undefined)}
      />
    </main>
  )
}

/** 界面列表里的一行：名字、类型、最近改动时间；点开进设计器 */
function DesignRow({ design, now, onOpen }: { design: DesignMeta; now: number; onOpen: () => void }) {
  const kind = designKind(design)
  const Icon = KIND_ICON[kind]
  return (
    <li className="ud:flex ud:items-center ud:transition-colors ud:hover:bg-sel/60">
      <button
        onClick={onOpen}
        className="ud:flex ud:min-w-0 ud:flex-1 ud:cursor-pointer ud:items-center ud:gap-3 ud:px-4 ud:py-3 ud:text-left"
      >
        <Icon className="ud:h-4 ud:w-4 ud:shrink-0 ud:text-subtle" />
        <span className="ud:flex ud:min-w-0 ud:flex-1 ud:flex-col ud:gap-0.5">
          <span className="ud:truncate ud:text-prose">{design.title}</span>
          <span className="ud:truncate ud:text-xs ud:text-subtle">
            {kind === 'web' ? t('网页 UI') : t('游戏 UI（UE5 UMG）')}
          </span>
        </span>
        <span
          className={cn(
            'ud:hidden ud:shrink-0 ud:text-xs ud:sm:block',
            design.running ? 'ud:text-accent-text' : 'ud:text-subtle',
          )}
        >
          {design.asking ? t('等你处理') : design.running ? t('执行中') : timeAgo(design.updatedAt, now)}
        </span>
        <ChevronRight className="ud:h-4 ud:w-4 ud:shrink-0 ud:text-subtle" />
      </button>
    </li>
  )
}
