import { Camera, ChevronDown, Plus, Search, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectState, UeProject } from '../server/types.ts'
import { ppost } from './api.ts'
import { useUe } from './ctx.tsx'
import { GamepadIcon } from './icon.tsx'
import { h, t } from './host.ts'
import { Kbd } from './jump/parts.tsx'
import { Dot, kindLabel, useTargetInfo, WorldBadge, worldLabel } from './ui.tsx'

/**
 * UE 页左栏的几块（设计稿「界面优化」图 1）：项目卡、全局目标（只放这一处，各页页头不再各放一个下拉）、
 * 跳转入口（双击 Shift）、分区导航（旁边带「数字 + 一个词」的徽标）、底部常驻的截视口。
 */

const VCS_NAME: Record<string, string> = { git: 'Git', p4: 'Perforce', svn: 'SVN' }

/** 项目卡：名字 + 版本 · 代码 · 版本管理，点开换项目或添加 */
export function ProjectCard({
  list,
  onPick,
  onAdd,
  pinned = false,
}: {
  list: UeProject[]
  onPick: (id: string) => void
  onAdd: () => void
  /** 项目由面板定（从项目工具打开，插件接口 9）：只显示当前项目，不给切换 */
  pinned?: boolean
}) {
  const { project } = useUe()
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const meta = (p: UeProject) =>
    [`UE ${p.engine.version || '?'}`, p.cpp ? 'C++' : t('纯蓝图'), VCS_NAME[p.vcs]].filter(Boolean).join(' · ')
  // 从项目工具打开时 UE 页盖住会话侧栏（PluginPage.cover）：项目卡片换成面板的「回到项目」卡片，点一下回到项目对话。
  // 旧面板没有这个组件，照旧显示不能点的卡片
  const Back = h().ui.ProjectBackCard
  if (pinned && Back) return <Back projectId={project.id} name={project.name} meta={meta(project)} icon={GamepadIcon} />
  if (pinned)
    return (
      <div className="ue:flex ue:w-full ue:items-center ue:gap-2.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-2 ue:shadow-card">
        <span className="ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg ue:bg-fg ue:text-bg">
          <GamepadIcon className="ue:h-4 ue:w-4" />
        </span>
        <span className="ue:min-w-0 ue:flex-1">
          <span className="ue:block ue:truncate ue:text-body ue:font-medium ue:text-fg">{project.name}</span>
          <span className="ue:block ue:truncate ue:text-caption ue:text-subtle">{meta(project)}</span>
        </span>
      </div>
    )
  return (
    <div ref={box} className="ue:relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('UE 项目')}
        onClick={() => setOpen((o) => !o)}
        className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-2 ue:text-left ue:shadow-card ue:hover:border-line-strong"
      >
        <span className="ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg ue:bg-fg ue:text-bg">
          <GamepadIcon className="ue:h-4 ue:w-4" />
        </span>
        <span className="ue:min-w-0 ue:flex-1">
          <span className="ue:block ue:truncate ue:text-body ue:font-medium ue:text-fg">{project.name}</span>
          <span className="ue:block ue:truncate ue:text-caption ue:text-subtle">{meta(project)}</span>
        </span>
        <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="ue:absolute ue:inset-x-0 ue:top-full ue:z-30 ue:mt-1 ue:flex ue:flex-col ue:gap-0.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-1 ue:shadow-pop"
        >
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === project.id}
                onClick={() => {
                  setOpen(false)
                  onPick(p.id)
                }}
                className={cn(
                  'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                  p.id === project.id && 'ue:bg-sel',
                )}
              >
                <span className="ue:truncate ue:text-body ue:text-fg">{p.name}</span>
                <span className="ue:truncate ue:text-caption ue:text-subtle">{meta(p)}</span>
              </button>
            </li>
          ))}
          <li className="ue:mt-0.5 ue:border-t ue:border-line ue:pt-0.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
              className="ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:px-2.5 ue:text-body ue:text-muted ue:hover:bg-hover ue:hover:text-fg"
            >
              <Plus className="ue:h-3.5 ue:w-3.5" /> {t('添加 UE 项目')}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

/** 连接状态一句话（左栏目标卡、设置页共用） */
export function connLine(s: ProjectState | undefined) {
  if (!s) return { tone: 'muted' as const, text: t('检测中…') }
  const live = s.instances.filter((i) => i.kind !== 'background')
  if (!s.bridge) return { tone: 'warn' as const, text: t('还没装桥接插件') }
  if (!live.length) return { tone: 'muted' as const, text: t('UE 没在运行') }
  const bad = live.filter((i) => !i.online)
  if (bad.length) return { tone: 'danger' as const, text: t('{n} 个进程连不上', { n: bad.length }) }
  return { tone: 'ok' as const, text: t('已连接') }
}

/**
 * 目标卡：全局的「对哪个进程、哪个世界操作」。多人 PIE 时世界后面标服务器 / 客户端，
 * 一眼看出现在改的是哪边（同步属性在客户端改会被服务器盖掉）
 */
export function TargetCard() {
  const { state, setTarget } = useUe()
  const { list, inst, world } = useTargetInfo()
  const { Select } = h().ui
  const conn = connLine(state)
  const w = world ?? inst?.worlds.find((x) => x.type === 'PIE') ?? inst?.worlds[0]
  const options = list.flatMap((i) => [
    { value: `${i.pid}|`, label: `${kindLabel(i.kind)} · ${t('默认世界')}`, group: `${kindLabel(i.kind)} ${i.pid}` },
    ...i.worlds.map((x) => ({
      value: `${i.pid}|${x.id}`,
      label: worldLabel(x),
      group: `${kindLabel(i.kind)} ${i.pid}`,
    })),
  ])
  return (
    <section
      aria-label={t('目标')}
      className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-2.5 ue:shadow-card"
    >
      <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
        {t('目标')}
        <span className="ue:ml-auto ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          <Dot tone={conn.tone} />
          <span className="ue:truncate">{conn.text}</span>
        </span>
      </div>
      {list.length ? (
        <>
          <Select
            size="sm"
            aria-label={t('目标')}
            value={inst ? `${inst.pid}|${world?.id ?? ''}` : ''}
            options={options}
            onChange={(e: { target: { value: string } }) => {
              const [pid, wid] = e.target.value.split('|')
              const i = list.find((x) => x.pid === Number(pid))
              setTarget(Number(pid), i?.kind ?? '', wid ?? '')
            }}
          />
          <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
            {w && <WorldBadge world={w} />}
            <span className="ue:truncate" title={inst?.error}>
              {inst?.online
                ? [`PID ${inst.pid}`, w?.map, w?.player].filter(Boolean).join(' · ')
                : inst?.error || t('连不上')}
            </span>
          </div>
        </>
      ) : (
        <div className="ue:flex ue:items-center ue:gap-2 ue:text-body ue:text-subtle">
          <Dot /> {t('没有运行中的 UE')}
        </div>
      )}
      <BackgroundLine />
    </section>
  )
}

/**
 * 后台编辑器（编辑器没开时读资源、AssetForge 导入导出用的不开窗口的编辑器）常驻显示在目标卡底部：
 * 在跑就让人看得见、能手动关（用户 2026-11-15）；没在跑不占地方
 */
function BackgroundLine() {
  const { project, state, reload } = useUe()
  const [busy, setBusy] = useState(false)
  const bg = state?.background
  if (!bg || (!bg.running && !bg.starting && !bg.error)) return null
  const stop = () => {
    setBusy(true)
    void ppost(project.id, 'background', { action: 'stop' })
      .catch((e: Error) => h().toast.error(e.message))
      .finally(() => {
        setBusy(false)
        reload()
      })
  }
  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:border-t ue:border-line ue:pt-1.5 ue:text-caption ue:text-subtle">
      <Dot tone={bg.running ? 'ok' : bg.starting ? 'run' : 'danger'} />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate" title={bg.error}>
        {bg.running
          ? t('后台编辑器运行中{pid}', { pid: bg.pid ? ` · PID ${bg.pid}` : '' })
          : bg.starting
            ? t('后台编辑器启动中…')
            : t('后台编辑器出错：{e}', { e: bg.error ?? '' })}
      </span>
      {(bg.running || bg.starting) && (
        <button
          type="button"
          disabled={busy}
          onClick={stop}
          title={t('关掉后台编辑器：正在做的导入导出会中断，下次读资源时再自动启动')}
          className="ue:shrink-0 ue:cursor-pointer ue:rounded-md ue:px-1.5 ue:py-0.5 ue:text-muted ue:hover:bg-hover ue:hover:text-fg ue:disabled:opacity-50"
        >
          {t('关闭')}
        </button>
      )}
    </div>
  )
}

/** 导航的一项：右边的数字（错误数红色，其余灰） */
export function NavItem({
  icon: Icon,
  label,
  on,
  onClick,
  count,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  onClick: () => void
  count?: { text: string; tone?: 'danger' | 'warn'; title?: string }
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'ue:flex ue:h-8 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:px-2.5 ue:text-body ue:whitespace-nowrap',
        on ? 'ue:bg-active ue:text-fg' : 'ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
      )}
    >
      <Icon className="ue:h-4 ue:w-4 ue:shrink-0" strokeWidth={1.75} />
      {label}
      {count && (
        <span
          title={count.title}
          className={cn(
            'ue:ml-auto ue:pl-2 ue:font-mono ue:text-caption',
            count.tone === 'danger' ? 'ue:text-danger' : count.tone === 'warn' ? 'ue:text-warning' : 'ue:text-subtle',
          )}
        >
          {count.text}
        </span>
      )}
    </button>
  )
}

/**
 * 跳转入口（设计稿三.2）：放在目标卡下面，写明双击 Shift 也能打开；弹窗和 Ctrl+K 是同一个。
 * 窄屏上左栏底部收起时也在，手机上同样能点开
 */
export function JumpEntry({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('跳转：双击 Shift 或 Ctrl+K')}
      className="ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-dashed ue:border-line-strong ue:px-2.5 ue:text-footnote ue:text-subtle ue:hover:bg-hover ue:hover:text-fg"
    >
      <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-left">{t('搜对象、资源、GM…')}</span>
      <Kbd>{t('双击 Shift')}</Kbd>
    </button>
  )
}

/** 左栏底部：截视口（随时能点，结果在浮层里看）、添加项目；跳转的入口在目标卡下面（JumpEntry） */
export function SideFoot({ onShot, onAdd }: { onShot: () => void; onAdd: () => void }) {
  const row = (icon: LucideIcon, label: string, onClick: () => void) => {
    const Icon = icon
    return (
      <button
        type="button"
        onClick={onClick}
        className="ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:px-2.5 ue:text-body ue:text-muted ue:hover:bg-hover ue:hover:text-fg"
      >
        <Icon className="ue:h-4 ue:w-4" strokeWidth={1.75} /> {label}
      </button>
    )
  }
  return (
    <div className="ue:mt-auto ue:hidden ue:flex-col ue:gap-0.5 ue:pt-2 ue:md:flex">
      {row(Camera, t('截视口'), onShot)}
      {row(Plus, t('添加 UE 项目'), onAdd)}
    </div>
  )
}
