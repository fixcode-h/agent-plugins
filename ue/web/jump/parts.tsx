import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../host.ts'

/** 跳转弹窗的几块（Jump.tsx 用，设置 →「组件」的示例也用）：分组标题、一行选项、底栏按键提示 */

export function JumpGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ue:flex ue:flex-col ue:gap-0.5">
      <div className="ue:px-1 ue:pt-1 ue:pb-0.5 ue:text-caption ue:text-subtle">{title}</div>
      <ul className="ue:flex ue:flex-col ue:gap-0.5">{children}</ul>
    </section>
  )
}

export function JumpRow({
  opt,
  on,
  onHover,
}: {
  opt: { icon: LucideIcon; tone?: string; label: string; detail?: string; hint?: string; run: () => void }
  on: boolean
  onHover: () => void
}) {
  const { cn } = h()
  return (
    <li>
      <button
        type="button"
        onMouseEnter={onHover}
        onClick={opt.run}
        className={cn(
          'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:px-3 ue:py-2 ue:text-left ue:text-body ue:text-fg',
          on && 'ue:bg-sel',
        )}
      >
        <opt.icon className={cn('ue:h-4 ue:w-4 ue:shrink-0', opt.tone ?? 'ue:text-subtle')} />
        <span className="ue:min-w-0 ue:shrink-0 ue:truncate">{opt.label}</span>
        {opt.detail && (
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-subtle">{opt.detail}</span>
        )}
        {opt.hint && <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{opt.hint}</span>}
      </button>
    </li>
  )
}

/** 按键提示里的键帽 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ue:rounded ue:border ue:border-line ue:px-1 ue:font-mono ue:text-caption ue:text-subtle">
      {children}
    </kbd>
  )
}

export function JumpFoot({ chat }: { chat: boolean }) {
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-1 ue:border-t ue:border-line ue:pt-2 ue:text-caption ue:text-subtle">
      <span className="ue:flex ue:items-center ue:gap-1">
        <Kbd>↑↓</Kbd> {t('选择')}
      </span>
      <span className="ue:flex ue:items-center ue:gap-1">
        <Kbd>↵</Kbd> {t('打开')}
      </span>
      {chat && (
        <span className="ue:flex ue:items-center ue:gap-1">
          <Kbd>Ctrl ↵</Kbd> {t('发给对话')}
        </span>
      )}
      <span className="ue:flex ue:items-center ue:gap-1">
        <Kbd>Esc</Kbd> {t('关闭')}
      </span>
      <span className="ue:ml-auto">{t('双击 Shift 或 Ctrl K 打开')}</span>
    </div>
  )
}
