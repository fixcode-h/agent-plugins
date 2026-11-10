import { useState } from 'react'
import { h, t } from './host.ts'
import { show } from './api.ts'
import type { Prop } from './Props.tsx'

/** 单个值：布尔开关、枚举下拉、其余文本框（回车提交，失焦不提交，免得误改） */
export function ValueEdit({
  p,
  was,
  busy,
  onSet,
  note,
}: {
  p: Prop
  was?: string
  busy: boolean
  onSet: (v: string) => void
  /** 正在改时下面提示一行（改的是默认值时：正在跑的对象不会变） */
  note?: string
}) {
  const { ui, cn } = h()
  const [focus, setFocus] = useState(false)
  const v = show(p.value)
  const why = p.readOnly ? p.readOnlyWhy || t('这个属性不能改') : undefined
  if (p.type === 'bool')
    return (
      <button
        type="button"
        title={why}
        role="switch"
        aria-checked={p.value === true}
        disabled={busy || p.readOnly}
        onClick={() => onSet(String(!(p.value === true)))}
        className={cn(
          'ue:relative ue:h-5 ue:w-9 ue:rounded-full ue:transition-colors',
          p.readOnly ? 'ue:cursor-not-allowed ue:opacity-50' : 'ue:cursor-pointer',
          p.value === true ? 'ue:bg-accent' : 'ue:bg-line-strong',
        )}
      >
        <span
          className={cn(
            'ue:absolute ue:top-0.5 ue:h-4 ue:w-4 ue:rounded-full ue:bg-card ue:shadow-card ue:transition-all',
            p.value === true ? 'ue:left-4.5' : 'ue:left-0.5',
          )}
        />
      </button>
    )
  // 只读的值不给输入框和下拉，只显示文字，一眼看出改不了
  if (p.readOnly)
    return (
      <span
        title={why}
        className="ue:flex ue:h-7 ue:cursor-not-allowed ue:items-center ue:truncate ue:px-2 ue:font-mono ue:text-footnote ue:text-muted"
      >
        {v}
      </span>
    )
  if (p.enum?.length)
    return (
      <ui.Select
        size="xs"
        value={v}
        disabled={busy || p.readOnly}
        onChange={(e: { target: { value: string } }) => onSet(e.target.value)}
        options={p.enum.map((x) => ({ value: x, label: x }))}
      />
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSet(String(new FormData(e.currentTarget).get('v') ?? ''))
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className={cn(
          'ue:flex ue:h-7 ue:items-center ue:rounded-md ue:border ue:px-2 ue:focus-within:border-focus',
          was !== undefined ? CHANGED : 'ue:border-line ue:bg-field',
        )}
      >
        <input
          name="v"
          key={v}
          defaultValue={v}
          disabled={busy}
          readOnly={p.readOnly}
          aria-label={p.name}
          className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none"
        />
      </form>
      {was !== undefined && <Was v={was} />}
      {focus && note && <span className="ue:text-caption ue:text-warning">{note}</span>}
    </div>
  )
}

/**
 * 改过的值：中性边框 + 左边一道强调色竖条（以前是红框，看着像校验失败，用户 2026-11-10 定的界面优化第 4 条），
 * 下面一行小字写原值
 */
export const CHANGED = 'ue:border-line-strong ue:bg-field ue:shadow-[inset_3px_0_0_var(--accent)]'

export function Was({ v }: { v: string }) {
  return (
    <span className="ue:truncate ue:text-caption ue:text-accent-text" title={v}>
      {t('原 {v}', { v })}
    </span>
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
const LETTER: Record<string, string> = { pitch: 'P', yaw: 'Y', roll: 'R' }
/** X / Pitch / R 红，Y / Yaw / G 绿，Z / Roll / B 蓝，和 UE 细节面板一样 */
const AXIS_COLOR = ['ue:text-danger', 'ue:text-success', 'ue:text-run', 'ue:text-subtle']

/** 值是不是一个能按分量改的结构体：键正好是上面某一组、值都是数字 */
export function vecKeys(v: unknown): string[] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const keys = Object.keys(v as object)
  const lower = keys.map((k) => k.toLowerCase())
  if (!Object.values(v as object).every((x) => typeof x === 'number')) return undefined
  const hit = VEC_KEYS.find((g) => g.length === lower.length && g.every((k) => lower.includes(k)))
  return hit ? hit.map((k) => keys[lower.indexOf(k)]) : undefined
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/** 分量编辑（界面优化第 10 条）：每个分量一个小框，回车把整个结构体交给桥接（JSON 对象，键沿用桥接给的） */
export function VecEdit({
  p,
  keys,
  was,
  busy,
  onSet,
  note,
}: {
  p: Prop
  keys: string[]
  was?: string
  busy: boolean
  onSet: (v: string) => void
  note?: string
}) {
  const { cn } = h()
  const [focus, setFocus] = useState(false)
  const val = p.value as Record<string, number>
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <form
        className="ue:grid ue:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          const out: Record<string, number> = {}
          for (const k of keys) {
            const n = Number(fd.get(k))
            out[k] = Number.isFinite(n) ? n : val[k]
          }
          onSet(JSON.stringify(out))
        }}
      >
        {keys.map((k, i) => (
          <label
            key={k}
            className={cn(
              'ue:flex ue:h-7 ue:min-w-0 ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:px-2 ue:focus-within:border-focus',
              was !== undefined ? CHANGED : 'ue:border-line ue:bg-field',
            )}
          >
            <span className={cn('ue:shrink-0 ue:text-caption ue:font-medium', AXIS_COLOR[i])}>
              {LETTER[k.toLowerCase()] ?? k.toUpperCase()}
            </span>
            <input
              name={k}
              key={`${k}:${val[k]}`}
              defaultValue={fmt(val[k])}
              disabled={busy}
              aria-label={`${p.name}.${k}`}
              inputMode="decimal"
              className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none"
            />
          </label>
        ))}
        {/* 回车提交要有一个提交按钮；不显示 */}
        <button type="submit" hidden />
      </form>
      {was !== undefined && <Was v={was} />}
      {focus && note && <span className="ue:text-caption ue:text-warning">{note}</span>}
    </div>
  )
}
