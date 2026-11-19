import { useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { selectorLabel } from '../gt-selector-label.ts'
import { TargetPickDialog } from './TargetPickDialog.tsx'

/**
 * 控件选择器（WBP_X:Root/Btn、$item>BtnClaim）：框里只显示，点一下弹窗选（用户 2026-11-19：输入框里下拉操作空间太小）。
 * 弹窗里按界面找、点控件树，也能直接改选择器原文
 */
export function TargetInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title={value || undefined}
        onClick={() => setOpen(true)}
        // 照面板输入框（components/ui/input.tsx 的 fieldClass，sm 档）的样子画，和同一列的输入框对齐
        className="ue:flex ue:h-8 ue:w-full ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-(--c-input-radius) ue:border-(length:--c-input-border) ue:border-line-strong ue:bg-(--c-input-bg) ue:px-2.5 ue:text-left ue:text-body ue:outline-none ue:focus-visible:border-focus"
      >
        <span className={cn('ue:min-w-0 ue:flex-1 ue:truncate', value ? 'ue:font-mono ue:text-fg' : 'ue:text-subtle')}>
          {value ? selectorLabel(value) : (placeholder ?? t('点这里选控件'))}
        </span>
        <MousePointerClick className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      </button>
      {open && (
        <TargetPickDialog
          value={value}
          onClose={() => setOpen(false)}
          onPick={(v) => {
            onChange(v)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}
