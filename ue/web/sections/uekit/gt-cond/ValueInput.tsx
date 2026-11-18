import { h } from '../../../host.ts'
import { ExprInput } from './ExprInput.tsx'

/**
 * 填值的地方（协议 1.1）：普通值直接写；以 = 开头就是表达式，换成表达式框（标错、补全）。
 * 要写真正以 = 开头的文字时写 \=
 */
export function ValueInput({
  value,
  onChange,
  placeholder,
  className,
  mono = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  mono?: boolean
}) {
  const { ui, cn } = h()
  if (value.startsWith('='))
    return <ExprInput className={className} value={value.slice(1)} onChange={(v) => onChange(`=${v}`)} autoFocus />
  return (
    <ui.Input
      size="sm"
      spellCheck={false}
      className={cn('ue:w-full', mono && 'ue:font-mono', className)}
      placeholder={placeholder}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
    />
  )
}
