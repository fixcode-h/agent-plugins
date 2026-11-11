import {
  Box,
  Braces,
  Cpu,
  Database,
  Eye,
  Gauge,
  LayoutGrid,
  List,
  Plus,
  SlidersHorizontal,
  SquareTerminal,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import type { ProjectState, UeProject } from '../server/types.ts'
import { AddProject } from './AddProject.tsx'
import { get, pget, ppost, useLoad } from './api.ts'
import { Ctx, type Badges, type UeCtx } from './ctx.tsx'
import { GamepadIcon } from './icon.tsx'
import { h, t } from './host.ts'
import { Assets } from './sections/Assets.tsx'
import { Bridge } from './sections/Bridge.tsx'
import { Console } from './sections/Console.tsx'
import { Gm } from './sections/Gm.tsx'
import { History } from './sections/History.tsx'
import { Logs } from './sections/Logs.tsx'
import { Lua } from './sections/Lua.tsx'
import { Objects } from './sections/Objects.tsx'
import { Overview } from './sections/Overview.tsx'
import { Perf } from './sections/Perf.tsx'
import { Watch } from './sections/Watch.tsx'
import { SplitHandle, usePane } from './split.tsx'
import { usePendingPie } from './launch.ts'
import { Jump } from './Jump.tsx'
import { ShotDialog } from './Shot.tsx'
import { NavItem, ProjectCard, SideFoot, TargetCard } from './Side.tsx'

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
  /** 只在条件满足时列出（Lua：有进程的桥接编进了 UnLua 支持） */
  when?: (s: ProjectState | undefined) => boolean
}

const SECTIONS: Section[] = [
  { id: 'overview', label: () => t('概览'), icon: LayoutGrid, group: () => t('运行时'), View: Overview },
  { id: 'console', label: () => t('控制台'), icon: SquareTerminal, group: () => t('运行时'), View: Console },
  { id: 'gm', label: () => 'GM', icon: Wand2, group: () => t('运行时'), View: Gm },
  {
    id: 'lua',
    label: () => 'Lua',
    icon: Braces,
    group: () => t('运行时'),
    View: Lua,
    when: (s) => !!s?.instances.some((i) => i.lua),
  },
  { id: 'objects', label: () => 'Object', icon: Box, group: () => t('数据'), View: Objects },
  { id: 'assets', label: () => t('资源'), icon: Database, group: () => t('数据'), View: Assets },
  { id: 'watch', label: () => t('监视'), icon: Eye, group: () => t('观察'), View: Watch },
  { id: 'perf', label: () => t('性能'), icon: Gauge, group: () => t('观察'), View: Perf },
  { id: 'logs', label: () => t('运行日志'), icon: List, group: () => t('观察'), View: Logs },
  { id: 'history', label: () => t('操作记录'), icon: Undo2, group: () => t('观察'), View: History },
  { id: 'bridge', label: () => t('桥接与权限'), icon: SlidersHorizontal, group: () => t('项目'), View: Bridge },
]

export function UePage({ path }: { path: string }) {
  const { ui, hooks } = h()
  const route = hooks.usePluginRoute()
  const [pid, rawSection = 'overview', ...rest] = path.split('/').map(decodeURIComponent)
  // Actor 页并进了 Object 页：以前记下的地址、别处写死的链接照样能打开
  const sectionId = rawSection === 'actors' ? 'objects' : rawSection
  const sub = rest.join('/')
  const projects = useLoad(() => get<{ projects: UeProject[] }>('/projects').then((r) => r.projects), [])
  const [adding, setAdding] = useState(false)
  // 左边分区栏宽度可拖（md 以上），右边内容至少留 480px
  const nav = usePane('nav', '232px', 180)
  const navRef = useRef<HTMLElement>(null)
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
  const [shot, setShot] = useState(false)
  const [jump, setJump] = useState(false)
  // 左栏的数字：5 秒一次，一个请求取全（服务端 badges.ts）
  const badges = useLoad(
    () => (project ? pget<Badges>(project.id, 'badges') : Promise.resolve(undefined)),
    [project?.id],
    5000,
  )
  // Ctrl+K（Mac 上 Cmd+K）打开跳转；只在 UE 页里生效
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setJump(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
            badges: badges.data,
            reloadBadges: () => void badges.reload(),
            openShot: () => setShot(true),
            openJump: () => setJump(true),
          }
        : null,
    // go、list 每次渲染都是新的，按数据变化重建就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [project, state.data, pidTarget, sectionId, sub, badges.data],
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

  // 有条件的分区：条件不满足时不列，但地址直接指向它时照样打开（页面里会说明为什么用不了）
  const visible = SECTIONS.filter((s) => !s.when || s.when(state.data) || s.id === sectionId)
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0]
  const groups = [...new Set(visible.map((s) => s.group()))]
  const View = section.View
  const b = badges.data
  const counts: Record<string, Parameters<typeof NavItem>[0]['count']> = {
    logs: b?.errors
      ? { text: String(b.errors), tone: 'danger', title: t('本次日志 {n} 个错误', { n: b.errors }) }
      : undefined,
    watch: b?.watch ? { text: String(b.watch) } : undefined,
    history: b?.undoable
      ? { text: t('{n} 可撤', { n: b.undoable }), title: t('{n} 处运行时修改还在生效，可以撤回', { n: b.undoable }) }
      : undefined,
    assets: b?.dirty ? { text: t('{n} 未存', { n: b.dirty }), tone: 'warn' } : undefined,
  }
  return (
    <Ctx.Provider value={ctx}>
      <PendingPie />
      <div className="ue:flex ue:h-full ue:min-h-0 ue:w-full ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-bg ue:md:flex-row">
        <aside
          ref={navRef}
          style={nav.style('calc(100% - 480px)')}
          className="ue:relative ue:flex ue:shrink-0 ue:flex-col ue:gap-2 ue:border-line ue:bg-panel ue:p-3 ue:md:w-(--ue-w) ue:md:max-w-(--ue-max) ue:md:overflow-y-auto ue:md:border-r"
        >
          <ProjectCard
            list={list}
            onAdd={() => setAdding(true)}
            onPick={(id) => route.go('main', `${encodeURIComponent(id)}/${section.id}`)}
          />
          <TargetCard />
          <nav
            className="ue:flex ue:gap-1 ue:overflow-x-auto ue:md:mt-1 ue:md:flex-col ue:md:overflow-visible"
            aria-label={t('UE 页分区')}
          >
            {groups.map((g) => (
              <div key={g} className="ue:flex ue:gap-1 ue:md:flex-col">
                <div className="ue:hidden ue:px-2 ue:pt-3 ue:pb-1 ue:text-caption ue:text-subtle ue:md:block">{g}</div>
                {visible
                  .filter((s) => s.group() === g)
                  .map((s) => (
                    <NavItem
                      key={s.id}
                      icon={s.icon}
                      label={s.label()}
                      on={s.id === section.id}
                      onClick={() => go(s.id)}
                      count={counts[s.id]}
                    />
                  ))}
              </div>
            ))}
          </nav>
          <SideFoot onShot={() => setShot(true)} onJump={() => setJump(true)} onAdd={() => setAdding(true)} />
          <SplitHandle pane={nav} paneRef={navRef} reserve={() => 480} edge />
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
      {shot && <ShotDialog onClose={() => setShot(false)} />}
      {jump && <Jump onClose={() => setJump(false)} />}
    </Ctx.Provider>
  )
}

/** 「启动编辑器并开始 PIE」排着的 PIE：要在 Ctx 里面才拿得到项目和状态 */
function PendingPie() {
  usePendingPie()
  return null
}
