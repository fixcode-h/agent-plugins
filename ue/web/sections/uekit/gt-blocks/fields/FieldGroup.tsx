import type { ReactNode } from 'react'
import { Switch } from '@panel/web/src/components/ui/switch'
import { Row } from '../parts.tsx'

/**
 * 检查器里的一组字段（执行、跳过、判定…）：组名一行小字，下面的行和别的组同一条左对齐线（Row 的标签列）。
 * 用户 2026-11-19：「出错和说明」太乱，按用途分组、对齐；别的检查器要分组也用它
 */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      <span className="ue:text-caption ue:font-medium ue:text-fg">{title}</span>
      <div className="ue:flex ue:flex-col ue:gap-2.5">{children}</div>
    </div>
  )
}

/** 开关行：标签在左列，开关和一句说明在右列；和输入框行同一套对齐 */
export function SwitchRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row label={label}>
      <div className="ue:flex ue:min-h-8 ue:items-center ue:gap-2">
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
        {desc && <span className="ue:text-footnote ue:text-subtle">{desc}</span>}
      </div>
    </Row>
  )
}
