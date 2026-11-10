import { ArrowDown, Search, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import type { Instance, World } from '../server/types.ts'
import { useLaunch } from './launch.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'

/** UE 页的小组件：卡片、标签、状态点、页头、终端框、目标选择。样式全用面板主题变量，类名带 ue: 前缀 */

export function Card({
  title,
  aside,
  children,
  className,
  bodyClass,
  style,
  ref,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  style?: CSSProperties
  ref?: Ref<HTMLElement>
}) {
  const { cn } = h()
  return (
    <section
      ref={ref}
      style={style}
      className={cn('ue:flex ue:min-w-0 ue:flex-col ue:rounded-xl ue:border ue:border-line ue:bg-card', className)}
    >
      {(title || aside) && (
        <header className="ue:flex ue:min-h-11 ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-4 ue:py-2">
          <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:text-heading ue:font-medium ue:text-fg">
            {title}
          </div>
          {aside && (
            <div className="ue:ml-auto ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
              {aside}
            </div>
          )}
        </header>
      )}
      <div className={cn('ue:min-h-0 ue:flex-1', bodyClass)}>{children}</div>
    </section>
  )
}

const TONES = {
  ok: 'ue:bg-success/12 ue:text-success',
  warn: 'ue:bg-warning/12 ue:text-warning',
  danger: 'ue:bg-danger/10 ue:text-danger',
  accent: 'ue:bg-accent-soft ue:text-accent-text',
  run: 'ue:bg-run-soft ue:text-run',
  muted: 'ue:bg-hover ue:text-muted',
}
export type Tone = keyof typeof TONES

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={h().cn(
        'ue:inline-flex ue:h-5 ue:shrink-0 ue:items-center ue:rounded-sm ue:px-1.5 ue:text-caption ue:font-medium ue:whitespace-nowrap',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

const DOTS = {
  ok: 'ue:bg-success',
  warn: 'ue:bg-warning',
  danger: 'ue:bg-danger',
  run: 'ue:bg-run',
  muted: 'ue:bg-subtle/50',
}
export function Dot({ tone = 'muted' }: { tone?: keyof typeof DOTS }) {
  return <span className={h().cn('ue:inline-block ue:h-2 ue:w-2 ue:shrink-0 ue:rounded-full', DOTS[tone])} />
}

export function PageHead({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ue:flex ue:min-h-16 ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-2 ue:border-b ue:border-line ue:px-6 ue:py-3">
      <h1 className="ue:text-title ue:font-medium ue:text-fg">{title}</h1>
      {/* 长路径（.uproject、日志文件）一行放不下时截断，完整的放悬停提示（界面优化第 20 条） */}
      {desc && (
        <div
          className="ue:min-w-0 ue:flex-1 ue:basis-40 ue:truncate ue:text-body ue:text-subtle"
          title={typeof desc === 'string' ? desc : undefined}
        >
          {desc}
        </div>
      )}
      <div className="ue:ml-auto ue:flex ue:flex-wrap ue:items-center ue:gap-2">{children}</div>
    </header>
  )
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p className="ue:rounded-lg ue:bg-danger/8 ue:px-3 ue:py-2 ue:text-footnote ue:break-all ue:text-danger">
      {children}
    </p>
  )
}

export function Note({
  children,
  tone = 'warn',
  action,
}: {
  children: ReactNode
  tone?: 'warn' | 'info'
  action?: ReactNode
}) {
  return (
    <div
      className={h().cn(
        'ue:flex ue:items-start ue:gap-3 ue:rounded-lg ue:px-3 ue:py-2 ue:text-footnote',
        tone === 'warn' ? 'ue:bg-warning/10 ue:text-fg' : 'ue:bg-accent-soft ue:text-fg',
      )}
    >
      <div className="ue:min-w-0 ue:flex-1 ue:leading-relaxed">{children}</div>
      {action}
    </div>
  )
}

/** 深色终端框（控制台、日志、编译输出）：和面板里命令输出同一组 term-* 颜色 */
/**
 * 终端样式的输出框。follow：内容变化时跟到最底下（编译这类持续输出的地方用）；
 * 用户往上翻时暂停跟随，滚回底部附近又恢复，不然看历史输出时会被新行拽下去。
 * 暂停跟随时右下角出现「滚到最下」，点了回到底部并恢复跟随
 */
export function Term({ children, className, follow }: { children: ReactNode; className?: string; follow?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  // 故意不写依赖：每次渲染（新输出到了）都要检查一遍，滚动本身很便宜
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = box.current
    if (follow && el && stick.current) el.scrollTop = el.scrollHeight
  })
  const toBottom = () => {
    const el = box.current
    if (!el) return
    stick.current = true
    setAway(false)
    el.scrollTop = el.scrollHeight
  }
  return (
    <div
      ref={box}
      onScroll={
        follow
          ? (e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
              setAway(!stick.current)
            }
          : undefined
      }
      className={h().cn(
        'ue:overflow-auto ue:rounded-xl ue:bg-term-bg ue:px-4 ue:py-3 ue:font-mono ue:text-footnote ue:leading-relaxed ue:text-term-fg',
        className,
      )}
    >
      {children}
      {follow && away && (
        // sticky 贴在滚动区底部，高度为 0 不占行，按钮往上挪到可视区右下角
        <div className="ue:pointer-events-none ue:sticky ue:bottom-0 ue:flex ue:h-0 ue:justify-end">
          <button
            type="button"
            onClick={toBottom}
            className="ue:pointer-events-auto ue:flex ue:-translate-y-full ue:items-center ue:gap-1 ue:rounded-full ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1 ue:font-sans ue:text-caption ue:text-fg ue:shadow-md ue:hover:bg-hover"
          >
            <ArrowDown className="ue:h-3.5 ue:w-3.5" /> {t('滚到最下')}
          </button>
        </div>
      )}
    </div>
  )
}

export function kindLabel(kind: string) {
  return kind === 'editor'
    ? t('编辑器')
    : kind === 'game'
      ? t('游戏')
      : kind === 'server'
        ? t('专用服务器')
        : kind === 'background'
          ? t('后台编辑器')
          : kind
}

export function worldLabel(w: World) {
  if (w.type === 'Editor') return t('编辑器世界')
  if (w.type === 'PIE') {
    if (w.netMode === 'ListenServer' || w.netMode === 'DedicatedServer') return t('PIE · 服务器')
    if (w.netMode === 'Client') return t('PIE · 客户端 {n}', { n: w.pieInstance ?? '' })
    return t('PIE · 单机')
  }
  return w.netMode === 'Client' ? t('游戏 · 客户端') : w.netMode === 'DedicatedServer' ? t('服务器世界') : t('游戏世界')
}

/** 当前目标是哪个进程、哪个世界（没选时按服务端的默认：编辑器优先，世界由桥接挑） */
export function useTargetInfo() {
  const { state, target } = useUe()
  const list: Instance[] = (state?.instances ?? []).filter((i) => i.kind !== 'background')
  const inst =
    typeof target.instance === 'number'
      ? list.find((i) => i.pid === target.instance)
      : (list.find((i) => i.kind === target.instance) ?? list[0])
  const world = inst?.worlds.find((w) => w.id === target.world)
  return { list, inst, world }
}

/** 世界是服务器还是客户端（多人 PIE 时最容易改错边）：单机、编辑器世界不标 */
export function WorldBadge({ world }: { world: World }) {
  if (world.netMode === 'ListenServer' || world.netMode === 'DedicatedServer')
    return <Badge tone="warn">{t('服务器')}</Badge>
  if (world.netMode === 'Client') return <Badge tone="run">{t('客户端')}</Badge>
  return null
}

/** 对象是运行时实例、资源默认值还是类：颜色区分，运行时实例改了马上生效，默认值不影响正在跑的对象 */
export function KindBadge({ kind }: { kind?: 'instance' | 'asset' | 'class' }) {
  if (!kind) return null
  if (kind === 'instance') return <Badge tone="run">{t('运行时实例')}</Badge>
  if (kind === 'class') return <Badge>{t('类')}</Badge>
  return <Badge tone="warn">{t('资源默认值')}</Badge>
}

/** 小号文字按钮（行内的「撤回」「固定」） */
export function LinkBtn({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'danger'
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={h().cn(
        'ue:inline-flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-md ue:px-1.5 ue:py-0.5 ue:text-footnote ue:hover:bg-hover ue:disabled:opacity-50',
        tone === 'danger' ? 'ue:text-danger' : 'ue:text-accent-text',
      )}
    >
      {children}
    </button>
  )
}

export function fmtTime(iso: string) {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 搜索框：按回车或点「搜索」才搜，打字时不发请求（用户 2026-11-10 要求：怕搜索拖慢 UE，所有搜索都这样）。
 * initial 变了（切项目、从别处跳过来）不覆盖正在输入的内容，只在挂载时取一次
 */
export function SearchBox({
  initial = '',
  placeholder,
  hint,
  onSearch,
  busy,
  allowEmpty,
}: {
  initial?: string
  placeholder: string
  /** 输入框右侧的小字（「前缀」） */
  hint?: string
  onSearch: (q: string) => void
  busy?: boolean
  /** 空的也能搜（资源按类型列、日志清掉筛选） */
  allowEmpty?: boolean
}) {
  const [q, setQ] = useState(initial)
  const { Button } = h().ui
  const go = () => {
    if (q.trim() || allowEmpty) onSearch(q.trim())
  }
  return (
    <form
      className="ue:flex ue:items-center ue:gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <label className="ue:flex ue:h-8 ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-line-strong ue:bg-field ue:px-2.5 ue:focus-within:border-focus">
        <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle"
        />
        {hint && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{hint}</span>}
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={busy || (!q.trim() && !allowEmpty)}>
        {t('搜索')}
      </Button>
    </form>
  )
}

/** 确认弹窗（危险命令、清空日志、保存资源）：用面板的 Modal */
export function Confirm({
  open,
  title,
  children,
  okText,
  danger,
  onOk,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  okText: string
  danger?: boolean
  onOk: () => void
  onCancel: () => void
}) {
  const { Modal, Button } = h().ui
  return (
    <Modal
      open={open}
      onOpenChange={(o: boolean) => !o && onCancel()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('取消')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onOk}>
            {okText}
          </Button>
        </>
      }
    >
      <div className="ue:text-body ue:leading-relaxed ue:text-fg">{children}</div>
    </Modal>
  )
}

/**
 * UE 没在运行时的空页面：说明 + 直接启动（不用回概览），下面给不开编辑器也能做的事。
 * 桥接没装时启动了也连不上，按钮换成去「桥接与权限」
 */
export function NotRunning({ icon: Icon, what }: { icon: LucideIcon; what: string }) {
  const { state, go } = useUe()
  const { ui } = h()
  const launch = useLaunch()
  const link = (label: string, section: string, sub?: string) => (
    <button
      type="button"
      onClick={() => go(section, sub)}
      className="ue:cursor-pointer ue:text-accent-text ue:hover:underline"
    >
      {label}
    </button>
  )
  return (
    <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-6">
      <div className="ue:flex ue:max-w-lg ue:flex-col ue:items-center ue:gap-3 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:px-8 ue:py-8 ue:text-center">
        <span className="ue:flex ue:h-11 ue:w-11 ue:items-center ue:justify-center ue:rounded-xl ue:bg-hover ue:text-muted">
          <Icon className="ue:h-5 ue:w-5" strokeWidth={1.75} />
        </span>
        <h2 className="ue:text-heading ue:font-medium ue:text-fg">{t('UE 没在运行')}</h2>
        <p className="ue:text-body ue:leading-relaxed ue:text-subtle">{what}</p>
        {state && !state.bridge ? (
          <ui.Button onClick={() => go('bridge')}>{t('先装桥接插件')}</ui.Button>
        ) : (
          <div className="ue:flex ue:flex-wrap ue:justify-center ue:gap-2">
            <ui.Button disabled={launch.busy} onClick={() => void launch.start(false)}>
              {t('启动编辑器')}
            </ui.Button>
            <ui.Button variant="secondary" disabled={launch.busy} onClick={() => void launch.start(true)}>
              {t('启动编辑器并开始 PIE')}
            </ui.Button>
          </div>
        )}
        <p className="ue:flex ue:flex-wrap ue:justify-center ue:gap-x-2 ue:text-footnote ue:text-subtle">
          {t('不开编辑器也能：')}
          {link(t('查资源和数据表'), 'assets')}
          <span>·</span>
          {link(t('看上次的日志'), 'logs')}
          <span>·</span>
          {link(t('看崩溃记录'), 'logs', 'crash')}
        </p>
      </div>
    </div>
  )
}
