import { Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Instance, World } from '../server/types.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'

/** UE 页的小组件：卡片、标签、状态点、页头、终端框、目标选择。样式全用面板主题变量，类名带 ue: 前缀 */

export function Card({
  title,
  aside,
  children,
  className,
  bodyClass,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  const { cn } = h()
  return (
    <section
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
      {desc && <div className="ue:min-w-0 ue:truncate ue:text-body ue:text-subtle">{desc}</div>}
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
export function Term({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={h().cn(
        'ue:overflow-auto ue:rounded-xl ue:bg-term-bg ue:px-4 ue:py-3 ue:font-mono ue:text-footnote ue:leading-relaxed ue:text-term-fg',
        className,
      )}
    >
      {children}
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

/** 顶栏的「目标」选择：进程 + 世界（设计文档 4.2） */
export function TargetPicker() {
  const { setTarget } = useUe()
  const { list, inst, world } = useTargetInfo()
  const { Select } = h().ui
  if (!list.length)
    return (
      <span className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:text-body ue:text-subtle">
        <Dot /> {t('没有运行中的 UE')}
      </span>
    )
  const options = list.flatMap((i) => [
    { value: `${i.pid}|`, label: `${kindLabel(i.kind)} · ${t('默认世界')}`, group: `${kindLabel(i.kind)} ${i.pid}` },
    ...i.worlds.map((w) => ({
      value: `${i.pid}|${w.id}`,
      label: worldLabel(w),
      group: `${kindLabel(i.kind)} ${i.pid}`,
    })),
  ])
  return (
    <div className="ue:flex ue:items-center ue:gap-2">
      <span className="ue:text-body ue:text-subtle">{t('目标实例')}</span>
      <Select
        size="sm"
        className="ue:w-56"
        aria-label={t('目标实例')}
        value={inst ? `${inst.pid}|${world?.id ?? ''}` : ''}
        options={options}
        onChange={(e: { target: { value: string } }) => {
          const [pid, w] = e.target.value.split('|')
          const i = list.find((x) => x.pid === Number(pid))
          setTarget(Number(pid), i?.kind ?? '', w ?? '')
        }}
      />
    </div>
  )
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
