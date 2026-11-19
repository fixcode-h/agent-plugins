import { Check } from 'lucide-react'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { cellOf } from './model.ts'

/** 数据表的一个单元格（效果图 B1）：颜色块 + 十六进制、勾选框、右对齐数字、「3 项」、资源名、枚举小标签 */
export function CellView({ value, type }: { value: unknown; type: string }) {
  const { cn } = h()
  const c = cellOf(value, type)
  const title = show(value)
  switch (c.kind) {
    case 'empty':
      return <span className="ue:text-subtle">—</span>
    case 'bool':
      return (
        <span
          title={title}
          className={cn(
            'ue:inline-flex ue:h-3.5 ue:w-3.5 ue:items-center ue:justify-center ue:rounded-[3px] ue:border',
            c.on ? 'ue:border-accent ue:bg-accent ue:text-on-accent' : 'ue:border-line-strong ue:bg-field',
          )}
        >
          {c.on && <Check className="ue:h-3 ue:w-3" strokeWidth={3} />}
        </span>
      )
    case 'num':
      return (
        <span className="ue:font-mono" title={title}>
          {c.text}
        </span>
      )
    case 'color':
      return (
        <span className="ue:inline-flex ue:items-center ue:gap-1.5 ue:font-mono ue:text-muted" title={title}>
          <span className="ue:h-3 ue:w-5 ue:rounded-sm ue:border ue:border-line" style={{ background: c.css }} />
          {c.hex}
        </span>
      )
    case 'count':
      return (
        <span className="ue:rounded ue:bg-hover ue:px-1.5 ue:py-px ue:text-caption ue:text-muted" title={title}>
          {t('{n} 项', { n: c.n })}
        </span>
      )
    case 'ref':
      return (
        <span className="ue:block ue:max-w-56 ue:truncate ue:font-mono ue:text-muted" title={c.path}>
          {c.name}
        </span>
      )
    case 'enum':
      return (
        <span
          className="ue:rounded ue:bg-accent-soft ue:px-1.5 ue:py-px ue:text-caption ue:text-accent-text"
          title={title}
        >
          {c.text}
        </span>
      )
    default:
      return (
        <span className="ue:block ue:max-w-72 ue:truncate" title={title}>
          {c.text}
        </span>
      )
  }
}
