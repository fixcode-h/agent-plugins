import {
  Box,
  Cpu,
  Database,
  Eye,
  LayoutGrid,
  List,
  Plus,
  SlidersHorizontal,
  SquareTerminal,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import type { ProjectState, UeProject } from '../server/types.ts'
import { AddProject } from './AddProject.tsx'
import { get, pget, ppost, useLoad } from './api.ts'
import { Ctx, type UeCtx } from './ctx.tsx'
import { GamepadIcon } from './icon.tsx'
import { h, t } from './host.ts'
import { Actors } from './sections/Actors.tsx'
import { Assets } from './sections/Assets.tsx'
import { Bridge } from './sections/Bridge.tsx'
import { Console } from './sections/Console.tsx'
import { Gm } from './sections/Gm.tsx'
import { History } from './sections/History.tsx'
import { Logs } from './sections/Logs.tsx'
import { Objects } from './sections/Objects.tsx'
import { Overview } from './sections/Overview.tsx'
import { Watch } from './sections/Watch.tsx'
import { Dot } from './ui.tsx'

/**
 * UE 管理页（设计文档 4.2，图 1）：左栏切项目和分区，右边是分区内容。地址 #/plugin/ue/main/<项目>/<分区>/<子位置>，
 * 刷新、后退都回到原位。
 */
interface Section {
  id: string
  label: () => string
  icon: LucideIcon
  group: () => string
  View: ComponentType
}

const SECTIONS: Section[] = [
  { id: 'overview', label: () => t('概览'), icon: LayoutGrid, group: () => t('运行时'), View: Overview },
  { id: 'console', label: () => t('控制台'), icon: SquareTerminal, group: () => t('运行时'), View: Console },
  { id: 'gm', label: () => 'GM', icon: Wand2, group: () => t('运行时'), View: Gm },
  { id: 'actors', label: () => 'Actor', icon: Box, group: () => t('数据'), View: Actors },
  { id: 'objects', label: () => t('运行时对象'), icon: Cpu, group: () => t('数据'), View: Objects },
  { id: 'assets', label: () => t('资源'), icon: Database, group: () => t('数据'), View: Assets },
  { id: 'watch', label: () => t('监视'), icon: Eye, group: () => t('观察'), View: Watch },
  { id: 'logs', label: () => t('运行日志'), icon: List, group: () => t('观察'), View: Logs },
  { id: 'history', label: () => t('操作记录'), icon: Undo2, group: () => t('观察'), View: History },
  { id: 'bridge', label: () => t('桥接与权限'), icon: SlidersHorizontal, group: () => t('项目'), View: Bridge },
]

function connLine(s: ProjectState | undefined) {
  if (!s) return { tone: 'muted' as const, text: t('检测中…') }
  const live = s.instances.filter((i) => i.kind !== 'background')
  if (!s.bridge) return { tone: 'warn' as const, text: t('还没装桥接插件') }
  if (!live.length)
    return { tone: 'muted' as const, text: s.background.running ? t('UE 没在运行 · 后台编辑器在线') : t('UE 没在运行') }
  const pie = live.some((i) => i.worlds.some((w) => w.type === 'PIE'))
  const bad = live.filter((i) => !i.online)
  if (bad.length) return { tone: 'danger' as const, text: t('{n} 个进程连不上', { n: bad.length }) }
  const ed = live.some((i) => i.kind === 'editor')
  return {
    tone: 'ok' as const,
    text: (ed ? t('编辑器已连接') : t('游戏已连接')) + (pie ? ` · ${t('PIE 运行中')}` : ''),
  }
}

export function UePage({ path }: { path: string }) {
  const { cn, ui, hooks } = h()
  const route = hooks.usePluginRoute()
  const [pid, sectionId = 'overview', ...rest] = path.split('/').map(decodeURIComponent)
  const sub = rest.join('/')
  const projects = useLoad(() => get<{ projects: UeProject[] }>('/projects').then((r) => r.projects), [])
  const [adding, setAdding] = useState(false)
  const list = projects.data ?? []
  const project = list.find((p) => p.id === pid) ?? list[0]

  const go = (section: string, s?: string) =>
    route.go('main', [project?.id ?? '', section, s ?? ''].map(encodeURIComponent).join('/').replace(/\/+$/, ''))
  const state = useLoad(
    () => (project ? pget<ProjectState>(project.id, 'state') : Promise.resolve(undefined)),
    [project?.id],
    3000,
  )
  // 选目标：内存里记 PID（同类进程有多个时分得开），项目登记里存类型和世界
  const [pidTarget, setPidTarget] = useState<number>()
  useEffect(() => {
    setPidTarget(undefined)
  }, [project?.id])

  const ctx: UeCtx | null = useMemo(
    () =>
      project
        ? {
            project,
            state: state.data,
            reload: () => void state.reload(),
            target: { instance: pidTarget ?? (project.target.kind || undefined), world: project.target.world },
            setTarget: (p, kind, world) => {
              setPidTarget(p)
              projects.setData(list.map((x) => (x.id === project.id ? { ...x, target: { kind, world } } : x)))
              void ppost(project.id, 'settings', { target: { kind, world } })
            },
            section: sectionId,
            sub,
            go,
          }
        : null,
    // go、list 每次渲染都是新的，按数据变化重建就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [project, state.data, pidTarget, sectionId, sub],
  )

  if (projects.loading && !projects.data)
    return <div className="ue:w-full ue:flex-1 ue:p-8 ue:text-body ue:text-subtle">{t('加载中…')}</div>

  if (!project)
    return (
      <div className="ue:flex ue:h-full ue:w-full ue:min-w-0 ue:flex-1 ue:items-center ue:justify-center ue:bg-panel ue:p-8">
        <div className="ue:flex ue:max-w-md ue:flex-col ue:items-center ue:gap-4 ue:text-center">
          <span className="ue:flex ue:h-12 ue:w-12 ue:items-center ue:justify-center ue:rounded-xl ue:bg-hover ue:text-fg">
            <GamepadIcon className="ue:h-6 ue:w-6" />
          </span>
          <h1 className="ue:text-subtitle ue:font-medium ue:text-fg">{t('还没有接入 UE 项目')}</h1>
          <p className="ue:text-body ue:leading-relaxed ue:text-muted">
            {t(
              '从 Agent 模式里已经添加的项目中选一个 UE 项目（5.4 及以上），装上桥接插件后，就能在这里执行控制台命令、跑 GM、读改运行时属性和资源；对话里的 Agent 也能用这些操作。',
            )}
          </p>
          <ui.Button onClick={() => setAdding(true)}>
            <Plus className="ue:h-4 ue:w-4" /> {t('添加 UE 项目')}
          </ui.Button>
          {projects.error && <p className="ue:text-footnote ue:text-danger">{projects.error}</p>}
        </div>
        <AddProject
          open={adding}
          onOpenChange={setAdding}
          onAdded={(p) => void projects.reload().then(() => route.go('main', p.id))}
        />
      </div>
    )

  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0]
  const conn = connLine(state.data)
  const errs = state.data ? undefined : state.error
  const groups = [...new Set(SECTIONS.map((s) => s.group()))]
  const View = section.View
  return (
    <Ctx.Provider value={ctx}>
      <div className="ue:flex ue:h-full ue:min-h-0 ue:w-full ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-bg ue:md:flex-row">
        <aside className="ue:flex ue:shrink-0 ue:flex-col ue:gap-2 ue:border-line ue:bg-panel ue:p-3 ue:md:w-58 ue:md:border-r">
          <ui.Select
            aria-label={t('UE 项目')}
            value={project.id}
            options={[
              ...list.map((p) => ({ value: p.id, label: `${p.name} · UE ${p.engine.version}` })),
              { value: '__add__', label: t('＋ 添加 UE 项目') },
            ]}
            onChange={(e: { target: { value: string } }) =>
              e.target.value === '__add__'
                ? setAdding(true)
                : route.go('main', `${encodeURIComponent(e.target.value)}/${section.id}`)
            }
          />
          <div className="ue:flex ue:items-center ue:gap-2 ue:px-1 ue:text-footnote ue:text-muted" title={errs}>
            <Dot tone={conn.tone} />
            <span className="ue:truncate">{conn.text}</span>
          </div>
          <nav
            className="ue:flex ue:gap-1 ue:overflow-x-auto ue:md:mt-2 ue:md:flex-col ue:md:overflow-visible"
            aria-label={t('UE 页分区')}
          >
            {groups.map((g) => (
              <div key={g} className="ue:flex ue:gap-1 ue:md:flex-col">
                <div className="ue:hidden ue:px-2 ue:pt-3 ue:pb-1 ue:text-caption ue:text-subtle ue:md:block">{g}</div>
                {SECTIONS.filter((s) => s.group() === g).map((s) => {
                  const Icon = s.icon
                  const on = s.id === section.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => go(s.id)}
                      aria-current={on ? 'page' : undefined}
                      className={cn(
                        'ue:flex ue:h-8 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:px-2.5 ue:text-body ue:whitespace-nowrap',
                        on ? 'ue:bg-active ue:text-fg' : 'ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
                      )}
                    >
                      <Icon className="ue:h-4 ue:w-4 ue:shrink-0" strokeWidth={1.75} />
                      {s.label()}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ue:mt-auto ue:hidden ue:h-8 ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:px-2.5 ue:text-body ue:text-muted ue:hover:bg-hover ue:hover:text-fg ue:md:flex"
          >
            <Plus className="ue:h-4 ue:w-4" /> {t('添加 UE 项目')}
          </button>
        </aside>
        <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">
          <View key={`${project.id}/${section.id}`} />
        </main>
      </div>
      <AddProject
        open={adding}
        onOpenChange={setAdding}
        onAdded={(p) => void projects.reload().then(() => route.go('main', encodeURIComponent(p.id)))}
      />
    </Ctx.Provider>
  )
}
