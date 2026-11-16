import {
  Blocks,
  Box,
  Braces,
  Cpu,
  Database,
  Eye,
  FileCode2,
  FileSliders,
  FlaskConical,
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
import { keep, kept } from './keep.ts'
import { Assets } from './sections/assets/Assets.tsx'
import { Bridge } from './sections/Bridge.tsx'
import { Console } from './sections/Console.tsx'
import { ConfigPage } from './sections/config/ConfigPage.tsx'
import { Gm } from './sections/Gm.tsx'
import { History } from './sections/History.tsx'
import { Logs } from './sections/Logs.tsx'
import { Lua } from './sections/lua/LuaPage.tsx'
import { Objects } from './sections/objects/Objects.tsx'
import { showOutline } from './sections/objects/Browse.tsx'
import { scopeOf, syncNav } from './inspect/history.ts'
import { Overview } from './sections/overview/Overview.tsx'
import { upgradesOf, useExtStatus } from './sections/overview/ext-data.ts'
import { Perf } from './sections/Perf.tsx'
import { Forge } from './sections/uekit/Forge.tsx'
import { GameTest } from './sections/uekit/GameTest.tsx'
import { Plugins } from './sections/uekit/Plugins.tsx'
import { Watch } from './sections/Watch.tsx'
import { SplitHandle, usePane } from './split.tsx'
import { usePendingPie } from './launch.ts'
import { useLaunchEvents } from './launch-progress/store.ts'
import { Jump } from './Jump.tsx'
import { useJumpKeys } from './jump/keys.ts'
import { loadIndex } from './jump/index-data.ts'
import { ShotDialog } from './Shot.tsx'
import { JumpEntry, NavItem, ProjectCard, SideFoot, TargetCard } from './Side.tsx'

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
  /** 只在条件满足时列出（Lua：项目里有 UnLua，或有进程的桥接编进了 UnLua 支持） */
  when?: (s: ProjectState | undefined) => boolean
}

const SECTIONS: Section[] = [
  { id: 'overview', label: () => t('概览'), icon: LayoutGrid, group: () => t('运行时'), View: Overview },
  { id: 'console', label: () => t('控制台'), icon: SquareTerminal, group: () => t('运行时'), View: Console },
  // 配置和 GameplayTag 浏览（只读，UE 没开也能看磁盘上的 ini）：放在控制台旁边（设计稿「UE 插件优化与扩展」二 P2）
  { id: 'config', label: () => t('配置'), icon: FileSliders, group: () => t('运行时'), View: ConfigPage },
  { id: 'gm', label: () => 'GM', icon: Wand2, group: () => t('运行时'), View: Gm },
  {
    id: 'lua',
    label: () => 'Lua',
    icon: Braces,
    group: () => t('运行时'),
    View: Lua,
    when: (s) => !!s?.unlua || !!s?.instances.some((i) => i.lua),
  },
  // 对象页（用户 2026-11-15 定）：原来的 Actor 页（世界大纲）和 Object 页（UObject 树、按类搜）合成一页，
  // 浏览栏三个页签；和资源页同一套检视区、共用一份导航历史（设计稿 designs/对象页合并与资源导航-设计稿.md）
  { id: 'objects', label: () => t('对象'), icon: Box, group: () => t('数据'), View: Objects },
  { id: 'assets', label: () => t('资源'), icon: Database, group: () => t('数据'), View: Assets },
  // UEKit 扩展：项目里装了才列出（UE 插件页安装）
  {
    id: 'assetforge',
    label: () => 'AssetForge',
    icon: FileCode2,
    group: () => t('扩展'),
    View: Forge,
    when: (s) => !!s?.extensions?.some((x) => x.name === 'AssetForge'),
  },
  {
    id: 'gametest',
    label: () => 'GameTest',
    icon: FlaskConical,
    group: () => t('扩展'),
    View: GameTest,
    when: (s) => !!s?.extensions?.some((x) => x.name === 'GameTest'),
  },
  { id: 'watch', label: () => t('监视'), icon: Eye, group: () => t('观察'), View: Watch },
  { id: 'perf', label: () => t('性能'), icon: Gauge, group: () => t('观察'), View: Perf },
  { id: 'logs', label: () => t('运行日志'), icon: List, group: () => t('观察'), View: Logs },
  { id: 'history', label: () => t('操作记录'), icon: Undo2, group: () => t('观察'), View: History },
  { id: 'plugins', label: () => t('UE 插件'), icon: Blocks, group: () => t('项目'), View: Plugins },
  { id: 'bridge', label: () => t('权限与设置'), icon: SlidersHorizontal, group: () => t('项目'), View: Bridge },
]

/**
 * project：从侧栏「项目工具」打开时面板给的当前项目（插件接口 9 的 scope = project），页面里不再切项目；
 * 旧面板不给，照旧按地址里的项目或第一个接入的
 */
export function UePage({ path, project: fixed }: { path: string; project?: string }) {
  const { ui, hooks } = h()
  const route = hooks.usePluginRoute()
  const [pid, rawSection = 'overview', ...rest] = path.split('/').map(decodeURIComponent)
  // 旧地址 actors/…（Actor 页合进了对象页）：按对象页打开，下面的 effect 再把地址改过来
  const sectionId = rawSection === 'actors' ? 'objects' : rawSection
  const sub = rest.join('/')
  const projects = useLoad(() => get<{ projects: UeProject[] }>('/projects').then((r) => r.projects), [])
  const [adding, setAdding] = useState(false)
  // 左边分区栏宽度可拖（md 以上），右边内容至少留 480px
  const nav = usePane('nav', '232px', 180)
  const navRef = useRef<HTMLElement>(null)
  const list = projects.data ?? []
  const project = fixed ? list.find((p) => p.id === fixed) : (list.find((p) => p.id === pid) ?? list[0])

  const go = (section: string, s?: string) => {
    // go('actors', p)：Actor 页合进了对象页，转过去并把浏览栏切到「大纲」，调用方不用改
    if (section === 'actors') {
      if (project) showOutline(project.id)
      section = 'objects'
    }
    route.go('main', [project?.id ?? '', section, s ?? ''].map(encodeURIComponent).join('/').replace(/\/+$/, ''))
  }
  const state = useLoad(
    () => (project ? pget<ProjectState>(project.id, 'state') : Promise.resolve(undefined)),
    [project?.id],
    3000,
  )
  // 选目标：内存里记 PID（同类进程有多个时分得开），项目登记里存类型和世界
  const [pidTarget, setPidTarget] = useState<number>()
  const [shot, setShot] = useState(false)
  const [jump, setJump] = useState(false)
  // 左栏的数字：5 秒一次，一个请求取全（服务端 badges.ts）；在概览页时同一个请求多带概览要的几项（server/overview.ts）
  const onOverview = sectionId === 'overview'
  const badges = useLoad(
    () =>
      project ? pget<Badges>(project.id, onOverview ? 'badges?overview=1' : 'badges') : Promise.resolve(undefined),
    [project?.id, onOverview],
    5000,
  )
  // 左栏「UE 插件 · N 可升级」：扩展的可升级情况换项目时取一次（服务端缓存了插件库目录）
  const ext = useExtStatus(project?.id)
  // Ctrl+K（Mac 上 Cmd+K）、双击 Shift 打开跳转；只在 UE 页里生效
  useJumpKeys(() => setJump(true))
  useEffect(() => {
    setPidTarget(undefined)
    // 跳转的本地索引先在后台建起来（不碰 UE，只读 UEToVS 的索引文件或扫磁盘），第一次按快捷键时就能直接筛
    if (project) void loadIndex(project.id).catch(() => undefined)
  }, [project?.id])
  // 记下每个分区最后停在哪（选中的对象、资源）：从左栏切回来时回到原处，不是回到空白页
  useEffect(() => {
    if (project) keep(`${project.id}/sub/${sectionId}`, sub || undefined)
  }, [project, sectionId, sub])
  // 旧地址 actors/… 改成 objects/…，浏览栏切到「大纲」
  useEffect(() => {
    if (project && rawSection === 'actors') go('actors', sub)
    // 只看地址
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, rawSection])
  // 对象页、资源页的导航历史跟着地址走（inspect/history.ts）：点了东西、后退前进、从别处 go 进来都对得上
  const scope = scopeOf({ instance: pidTarget ?? (project?.target.kind || undefined), world: project?.target.world })
  useEffect(() => {
    if (project && rawSection !== 'actors' && (sectionId === 'objects' || sectionId === 'assets'))
      syncNav(project.id, sectionId, sub, scope)
    // scope 只在记新条目时用，换了世界不用重新对一遍
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, sectionId, sub])

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
          <h1 className="ue:text-subtitle ue:font-medium ue:text-fg">
            {fixed ? t('这个项目还没接入 UE') : t('还没有接入 UE 项目')}
          </h1>
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
          preset={fixed}
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
  // 徽标统一写成「数字 + 一个词」：错误红、待处理黄、其他灰（设计稿三.4）
  const ups = upgradesOf(state.data, ext.data?.items).length
  const counts: Record<string, Parameters<typeof NavItem>[0]['count']> = {
    logs: b?.errors
      ? { text: t('{n} 错误', { n: b.errors }), tone: 'danger', title: t('本次日志 {n} 个错误', { n: b.errors }) }
      : undefined,
    watch: b?.watch ? { text: t('{n} 项', { n: b.watch }), title: t('监视着 {n} 项', { n: b.watch }) } : undefined,
    history: b?.undoable
      ? {
          text: t('{n} 可撤', { n: b.undoable }),
          tone: 'warn',
          title: t('{n} 处运行时修改还在生效，可以撤回', { n: b.undoable }),
        }
      : undefined,
    assets: b?.dirty ? { text: t('{n} 未存', { n: b.dirty }), tone: 'warn' } : undefined,
    plugins: ups ? { text: t('{n} 可升级', { n: ups }), title: t('有 {n} 个 UE 插件能升级', { n: ups }) } : undefined,
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
            pinned={!!fixed}
            list={list}
            onAdd={() => setAdding(true)}
            onPick={(id) => route.go('main', `${encodeURIComponent(id)}/${section.id}`)}
          />
          <TargetCard />
          <JumpEntry onClick={() => setJump(true)} />
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
                      onClick={() => go(s.id, kept<string>(`${project.id}/sub/${s.id}`))}
                      count={counts[s.id]}
                    />
                  ))}
              </div>
            ))}
          </nav>
          <SideFoot onShot={() => setShot(true)} onAdd={() => setAdding(true)} />
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

/** 「启动编辑器并开始 PIE」排着的 PIE、编辑器启动进度的推送：要在 Ctx 里面才拿得到项目和状态 */
function PendingPie() {
  usePendingPie()
  useLaunchEvents()
  return null
}
