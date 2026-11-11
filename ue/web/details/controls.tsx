import { Check, ChevronDown, CirclePlus, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { refName } from './model.ts'

/**
 * 细节面板的值控件，照 UE 细节面板：方形勾选框、紧凑的下拉和输入框（不铺满整列）、向量每个分量左边一道轴色竖条、
 * 对象引用是一个带名字的小框、数组是「N 个元素」加上加号和垃圾桶。只读时控件照样画、整体变灰，一眼看出是什么类型但改不了
 */

const FIELD =
  'ue:flex ue:h-7 ue:min-w-0 ue:items-center ue:rounded-[3px] ue:border ue:px-2 ue:transition-colors ue:focus-within:border-focus'
/**
 * 能改和只读分开画（用户 2026-11-11：照 UE，两种要一眼分得清）：能改的是深色输入框、亮字、悬停边框变亮；
 * 只读的是灰底、灰字、没有边框，鼠标是禁止符号。改过的值左边一道强调色竖条（不用红框，看着像校验失败）
 */
const fieldTone = (disabled?: boolean, changed?: boolean) =>
  disabled
    ? 'ue:cursor-not-allowed ue:border-transparent ue:bg-hover ue:text-subtle'
    : changed
      ? 'ue:border-line-strong ue:bg-field ue:text-fg ue:shadow-[inset_2px_0_0_var(--accent)]'
      : 'ue:border-line ue:bg-field ue:text-fg ue:hover:border-line-strong'
const INPUT =
  'ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none ue:disabled:cursor-not-allowed ue:disabled:text-subtle'

export function Checkbox({
  checked,
  disabled,
  title,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  title?: string
  label: string
  onChange: (v: boolean) => void
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'ue:flex ue:h-[18px] ue:w-[18px] ue:shrink-0 ue:items-center ue:justify-center ue:rounded-[3px] ue:border ue:transition-colors',
        disabled
          ? 'ue:cursor-not-allowed ue:border-transparent ue:bg-hover'
          : cn(
              'ue:cursor-pointer ue:hover:border-focus',
              checked ? 'ue:border-accent ue:bg-accent/15' : 'ue:border-line-strong ue:bg-field',
            ),
      )}
    >
      {checked && (
        <Check
          strokeWidth={3}
          className={cn('ue:h-3 ue:w-3 ue:motion-safe:animate-fade', disabled ? 'ue:text-subtle' : 'ue:text-accent')}
        />
      )}
    </button>
  )
}

/** 枚举下拉：显示名（Axis1D (float)），提交的是值名；当前值不在列表里（编辑器里藏起来的值）也补上 */
export function EnumSelect({
  value,
  names,
  labels,
  disabled,
  title,
  label,
  onChange,
}: {
  value: string
  names: string[]
  labels?: string[]
  disabled?: boolean
  title?: string
  label: string
  onChange: (v: string) => void
}) {
  const { cn } = h()
  // 桥接给的枚举值可能带前缀（EInputActionValueType::Axis1D），值里只有后半截
  const opts = names.map((n, i) => ({ value: n, label: labels?.[i] || n }))
  const hit = opts.find((o) => o.value === value || o.value.endsWith(`::${value}`))
  if (!hit && value) opts.unshift({ value, label: value })
  return (
    <label className={cn(FIELD, fieldTone(disabled), 'ue:relative ue:w-56 ue:max-w-full ue:pr-1')} title={title}>
      <select
        aria-label={label}
        value={hit?.value ?? value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:appearance-none ue:truncate ue:bg-transparent ue:pr-5 ue:text-footnote ue:text-inherit ue:outline-none ue:disabled:cursor-not-allowed"
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value} className="ue:bg-card ue:text-fg">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="ue:pointer-events-none ue:absolute ue:right-1.5 ue:h-3.5 ue:w-3.5 ue:opacity-70" />
    </label>
  )
}

/** 文字 / 数字框：回车提交，Esc 恢复（失焦不提交，免得点走时误改了运行中的值） */
export function TextField({
  value,
  numeric,
  disabled,
  changed,
  title,
  label,
  suffix,
  onSubmit,
}: {
  value: string
  numeric?: boolean
  disabled?: boolean
  changed?: boolean
  title?: string
  label: string
  suffix?: string
  onSubmit: (v: string) => void
}) {
  const { cn } = h()
  return (
    <form
      title={title}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(String(new FormData(e.currentTarget).get('v') ?? ''))
      }}
      className={cn(FIELD, fieldTone(disabled, changed), numeric ? 'ue:w-40' : 'ue:w-full ue:max-w-80')}
    >
      <input
        name="v"
        key={value}
        defaultValue={value}
        disabled={disabled}
        aria-label={label}
        inputMode={numeric ? 'decimal' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.value = value
        }}
        className={INPUT}
      />
      {suffix && <span className="ue:shrink-0 ue:pl-1 ue:text-caption ue:text-subtle">{suffix}</span>}
    </form>
  )
}

/** 向量、旋转、颜色这类结构体的分量：桥接按 FJsonObjectConverter 导出，键是小写（x / pitch / r） */
const VEC_KEYS = [
  ['x', 'y', 'z', 'w'],
  ['x', 'y', 'z'],
  ['x', 'y'],
  ['pitch', 'yaw', 'roll'],
  ['r', 'g', 'b', 'a'],
]
/** X / Pitch / R 红，Y / Yaw / G 绿，Z / Roll / B 蓝，和 UE 细节面板一样 */
const AXIS = ['var(--danger)', 'var(--success)', 'var(--run)', 'var(--subtle)']

/** 值是不是一个能按分量改的结构体：键正好是上面某一组、值都是数字 */
export function vecKeys(v: unknown): string[] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const keys = Object.keys(v as object)
  const lower = keys.map((k) => k.toLowerCase())
  if (!Object.values(v as object).every((x) => typeof x === 'number')) return undefined
  const hit = VEC_KEYS.find((g) => g.length === lower.length && g.every((k) => lower.includes(k)))
  return hit ? hit.map((k) => keys[lower.indexOf(k)]) : undefined
}

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6)

/** 分量编辑：每个分量一个框，左边轴色竖条；回车把整个结构体交给桥接（JSON 对象，键沿用桥接给的） */
export function VecField({
  value,
  keys,
  disabled,
  changed,
  title,
  label,
  onSubmit,
}: {
  value: Record<string, number>
  keys: string[]
  disabled?: boolean
  changed?: boolean
  title?: string
  label: string
  onSubmit: (v: string) => void
}) {
  const { cn } = h()
  const rot = keys[0]?.toLowerCase() === 'pitch'
  const color = keys[0]?.toLowerCase() === 'r'
  // 旋转在 UE 里按 Roll、Pitch、Yaw 的顺序显示（X、Y、Z 轴），值的键不变
  const order = rot ? [keys[2], keys[0], keys[1]] : keys
  const swatch =
    color &&
    `rgba(${[0, 1, 2].map((i) => Math.round(Math.min(1, Math.max(0, value[keys[i]])) * (value[keys[i]] > 1 ? 1 : 255))).join(',')},${keys[3] ? Math.min(1, value[keys[3]]) : 1})`
  return (
    <form
      title={title}
      className="ue:flex ue:w-full ue:max-w-xl ue:items-center ue:gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const out: Record<string, number> = {}
        for (const k of keys) {
          const n = Number(fd.get(k))
          out[k] = Number.isFinite(n) ? n : value[k]
        }
        onSubmit(JSON.stringify(out))
      }}
    >
      {swatch && (
        <span
          className="ue:h-7 ue:w-7 ue:shrink-0 ue:rounded-[3px] ue:border ue:border-line-strong"
          style={{ background: swatch }}
        />
      )}
      {order.map((k, i) => (
        <label
          key={k}
          className={cn(FIELD, fieldTone(disabled, changed), 'ue:flex-1 ue:overflow-hidden ue:pl-0')}
          title={k}
        >
          <span className="ue:mr-1.5 ue:h-full ue:w-[3px] ue:shrink-0" style={{ background: AXIS[i] }} />
          <input
            name={k}
            key={`${k}:${value[k]}`}
            defaultValue={fmt(value[k])}
            disabled={disabled}
            aria-label={`${label}.${k}`}
            inputMode="decimal"
            className={INPUT}
          />
          {rot && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">°</span>}
        </label>
      ))}
      {/* 回车提交要有一个提交按钮；不显示 */}
      <button type="submit" hidden />
    </form>
  )
}

/** 对象引用：名字小框（悬停看完整路径），点开跳过去；能改的给一个清空（设成 None） */
export function RefValue({
  path,
  disabled,
  onOpen,
  onClear,
}: {
  path: string
  disabled?: boolean
  onOpen?: () => void
  onClear?: () => void
}) {
  const { cn, ui } = h()
  const none = !path || path === 'None'
  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
      <button
        type="button"
        title={none ? undefined : path}
        onClick={none ? undefined : onOpen}
        className={cn(
          FIELD,
          // 引用不能改时照样能点开看，只是底色按只读画
          disabled ? 'ue:border-transparent ue:bg-hover ue:text-subtle' : 'ue:border-line ue:bg-field ue:text-fg',
          'ue:w-56 ue:max-w-full ue:text-left ue:text-footnote',
          none && 'ue:text-subtle',
          !none && onOpen && 'ue:cursor-pointer ue:hover:border-line-strong ue:hover:text-accent-text',
        )}
      >
        <span className="ue:truncate">{none ? t('无') : refName(path)}</span>
      </button>
      {!none && onClear && !disabled && <ui.IconButton icon={X} label={t('清空引用')} size="xs" onClick={onClear} />}
    </div>
  )
}

/** 数组、集合、映射的一行：「N 个元素」+ 加一个 + 清空（集合、映射只给清空） */
export function ContainerHead({
  count,
  canAdd,
  canClear,
  busy,
  onAdd,
  onClear,
}: {
  count?: number
  canAdd: boolean
  canClear: boolean
  busy?: boolean
  onAdd: () => void
  onClear: () => void
}) {
  const { ui } = h()
  return (
    <div className="ue:flex ue:items-center ue:gap-1">
      <span className="ue:min-w-24 ue:text-footnote ue:text-muted">
        {count === undefined ? t('数组') : t('{n} 个元素', { n: count })}
      </span>
      {canAdd && <ui.IconButton icon={CirclePlus} label={t('添加元素')} size="xs" disabled={busy} onClick={onAdd} />}
      {canClear && !!count && (
        <ui.IconButton icon={Trash2} label={t('清空所有元素')} size="xs" disabled={busy} onClick={onClear} />
      )}
    </div>
  )
}

/** 只读的纯文字值（结构体摘要、截断的大值） */
export function Muted({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="ue:block ue:truncate ue:font-mono ue:text-footnote ue:text-muted">
      {children}
    </span>
  )
}

/** 打开 / 关上时箭头转 90°（分类条、可展开的行都用） */
export function Caret({ open, className }: { open: boolean; className?: string }) {
  const { cn } = h()
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn(
        'ue:h-2.5 ue:w-2.5 ue:shrink-0 ue:fill-current ue:transition-transform ue:duration-150',
        open && 'ue:rotate-90',
        className,
      )}
    >
      <path d="M3 1.5 L7.5 5 L3 8.5 Z" />
    </svg>
  )
}

/** 展开收起的动画外壳：grid 行高 0fr ↔ 1fr，内容不用量高度 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const { cn } = h()
  const [seen, setSeen] = useState(open)
  if (open && !seen) setSeen(true)
  return (
    <div
      className={cn(
        'ue:grid ue:transition-[grid-template-rows] ue:duration-200 ue:ease-out',
        open ? 'ue:grid-rows-[1fr]' : 'ue:grid-rows-[0fr]',
      )}
    >
      {/* 没展开过的不渲染（大对象几百行属性，收着的分类不白画） */}
      <div className="ue:min-h-0 ue:overflow-hidden">{seen && children}</div>
    </div>
  )
}
