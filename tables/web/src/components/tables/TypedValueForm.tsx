import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { emptyValue, nodeText, type ScalarNode, type StructNode, type TValue, type TypeNode } from '@shared/table-codec'
import type { EnumOption } from '@shared/table-struct'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, Select } from '@/components/ui/input'

/** 枚举名 / 引用写法 → 能选的值（表格页的 struct.enumOpts、refOpts） */
export interface TypedOpts {
  enums: Map<string, EnumOption[]>
  refs: Map<string, EnumOption[]>
}

const asF = (v: TValue) => (typeof v === 'object' && 'f' in v ? v.f : {})
const asItems = (v: TValue) => (typeof v === 'object' && 'items' in v ? v.items : [])
const asPairs = (v: TValue) => (typeof v === 'object' && 'pairs' in v ? v.pairs : [])

/**
 * 按类型树一层层填值：结构体一个字段一格，数组一项一行（能加、删、挪），映射一对一行，
 * 枚举、引用、布尔是下拉，颜色带色块和拾色器。表格页改格子的弹窗、一行的表单、设置 → 组件里的示例共用
 */
export function TypedValueForm({
  node,
  value,
  onChange,
  opts,
  label,
  placeholder,
}: {
  node: TypeNode
  value: TValue
  onChange: (v: TValue) => void
  opts?: TypedOpts
  /** 读屏用：这一格是什么（字段名、第几项） */
  label: string
  /** 空着时的提示：可不填的字段写默认值 */
  placeholder?: string
}) {
  if (node.k === 'scalar')
    return (
      <ScalarInput
        placeholder={placeholder}
        node={node}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        opts={opts}
        label={label}
      />
    )
  if (node.k === 'struct') return <StructForm node={node} value={value} onChange={onChange} opts={opts} label={label} />
  if (node.k === 'list') {
    const items = asItems(value)
    const put = (next: TValue[]) => onChange({ items: next })
    const move = (i: number, d: -1 | 1) => {
      const next = [...items]
      ;[next[i], next[i + d]] = [next[i + d], next[i]]
      put(next)
    }
    return (
      <div className="tb:flex tb:flex-col tb:gap-1.5">
        {items.map((x, i) => (
          <div key={i} className="tb:flex tb:items-start tb:gap-2">
            <span className="tb:w-6 tb:shrink-0 tb:pt-1.5 tb:text-right tb:font-mono tb:text-caption tb:text-subtle">
              {i + 1}
            </span>
            <div className={cn('tb:min-w-0 tb:flex-1', node.of.k !== 'scalar' && 'tb:rounded-lg tb:bg-sel tb:p-2')}>
              <TypedValueForm
                node={node.of}
                value={x}
                onChange={(v) => put(items.map((y, j) => (j === i ? v : y)))}
                opts={opts}
                label={t('{label} 第 {n} 项', { label, n: i + 1 })}
              />
            </div>
            <span className="tb:flex tb:shrink-0 tb:items-center tb:pt-0.5">
              <IconButton
                icon={ArrowUp}
                size="xs"
                label={t('第 {n} 项往上挪', { n: i + 1 })}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                icon={ArrowDown}
                size="xs"
                label={t('第 {n} 项往下挪', { n: i + 1 })}
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              />
              <IconButton
                icon={X}
                size="xs"
                label={t('删掉第 {n} 项', { n: i + 1 })}
                onClick={() => put(items.filter((_, j) => j !== i))}
              />
            </span>
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={() => put([...items, emptyValue(node.of)])}>
            <Plus className="tb:h-3.5 tb:w-3.5" />
            {node.set ? t('加一个') : t('加一项')}
          </Button>
        </div>
      </div>
    )
  }
  const pairs = asPairs(value)
  const put = (next: [TValue, TValue][]) => onChange({ pairs: next })
  return (
    <div className="tb:flex tb:flex-col tb:gap-1.5">
      {pairs.length > 0 && (
        <div className="tb:flex tb:gap-2 tb:text-caption tb:text-subtle" aria-hidden>
          <span className="tb:min-w-0 tb:flex-1">
            {t('键')} · {nodeText(node.key)}
          </span>
          <span className="tb:min-w-0 tb:flex-[2]">
            {t('值')} · {nodeText(node.val)}
          </span>
          <span className="tb:w-6 tb:shrink-0" />
        </div>
      )}
      {pairs.map(([k, v], i) => (
        <div key={i} className="tb:flex tb:items-start tb:gap-2">
          <div className="tb:min-w-0 tb:flex-1">
            <TypedValueForm
              node={node.key}
              value={k}
              onChange={(x) => put(pairs.map((p, j) => (j === i ? [x, p[1]] : p)))}
              opts={opts}
              label={t('第 {n} 对的键', { n: i + 1 })}
            />
          </div>
          <div className={cn('tb:min-w-0 tb:flex-[2]', node.val.k !== 'scalar' && 'tb:rounded-lg tb:bg-sel tb:p-2')}>
            <TypedValueForm
              node={node.val}
              value={v}
              onChange={(x) => put(pairs.map((p, j) => (j === i ? [p[0], x] : p)))}
              opts={opts}
              label={t('第 {n} 对的值', { n: i + 1 })}
            />
          </div>
          <IconButton
            icon={X}
            size="xs"
            className="tb:mt-1"
            label={t('删掉第 {n} 对', { n: i + 1 })}
            onClick={() => put(pairs.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => put([...pairs, [emptyValue(node.key), emptyValue(node.val)]])}>
          <Plus className="tb:h-3.5 tb:w-3.5" />
          {t('加一对')}
        </Button>
      </div>
    </div>
  )
}

function StructForm({
  node,
  value,
  onChange,
  opts,
  label,
}: {
  node: StructNode
  value: TValue
  onChange: (v: TValue) => void
  opts?: TypedOpts
  label: string
}) {
  const f = asF(value)
  const color = colorOf(node, f)
  return (
    <div className="tb:flex tb:flex-col tb:gap-1.5" role="group" aria-label={label}>
      {color && (
        <label className="tb:flex tb:items-center tb:gap-2 tb:text-caption tb:text-subtle">
          <input
            type="color"
            aria-label={t('选颜色')}
            value={color.hex}
            onChange={(e) => onChange({ f: { ...f, ...color.from(e.target.value) } })}
            className="tb:h-7 tb:w-10 tb:cursor-pointer tb:rounded-md tb:border tb:bg-transparent"
          />
          {color.hex.toUpperCase()}
        </label>
      )}
      {node.fields.map((fd) => (
        <div key={fd.name} className="tb:grid tb:grid-cols-[minmax(80px,auto)_1fr] tb:items-start tb:gap-x-3">
          <span className="tb:pt-1.5 tb:text-footnote tb:whitespace-nowrap tb:text-muted" title={fd.note}>
            {fd.name}
            <span className="tb:ml-1.5 tb:font-mono tb:text-caption tb:text-subtle">
              {nodeText(fd.node)}
              {fd.optional ? ` · ${t('可不填')}` : ''}
            </span>
          </span>
          <div className={cn('tb:min-w-0', fd.node.k !== 'scalar' && 'tb:rounded-lg tb:bg-sel tb:p-2')}>
            <TypedValueForm
              node={fd.node}
              value={f[fd.name] ?? emptyValue(fd.node)}
              onChange={(v) => onChange({ f: { ...f, [fd.name]: v } })}
              opts={opts}
              label={fd.name}
              placeholder={fd.def}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ScalarInput({
  node,
  value,
  onChange,
  opts,
  label,
  placeholder,
}: {
  node: ScalarNode
  value: string
  onChange: (v: string) => void
  opts?: TypedOpts
  label: string
  placeholder?: string
}) {
  const list = node.enumName ? opts?.enums.get(node.enumName) : node.ref ? opts?.refs.get(node.ref) : undefined
  if (list?.length) {
    // 已有的值不在选项里也留着，免得一打开就被换掉
    const names = list.map((o) => o.name)
    return (
      <Select
        size="sm"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: t('（空）') },
          ...(value && !names.includes(value) ? [{ value, label: value }] : []),
          ...list.slice(0, 500).map((o) => ({ value: o.name, label: o.desc ? `${o.name} · ${o.desc}` : o.name })),
        ]}
      />
    )
  }
  if (node.kind === 'bool') {
    // 照这一格原来的写法（True / true / 1）给选项
    const pair = /^[01]$/.test(value) ? ['1', '0'] : /^[A-Z]/.test(value) ? ['True', 'False'] : ['true', 'false']
    return (
      <Select
        size="sm"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[{ value: '', label: t('（空）') }, ...pair.map((v) => ({ value: v, label: v }))]}
      />
    )
  }
  const num = node.kind === 'int' || node.kind === 'uint' || node.kind === 'float'
  const range = node.min !== undefined || node.max !== undefined ? `${node.min ?? ''} ~ ${node.max ?? ''}` : undefined
  return (
    <Input
      size="sm"
      aria-label={label}
      value={value}
      inputMode={num ? 'decimal' : undefined}
      placeholder={placeholder ? t('默认 {v}', { v: placeholder }) : range}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      className={cn(num && 'tb:font-mono')}
    />
  )
}

/**
 * 颜色结构体（有 R、G、B 字段）：给拾色器。字段是 0–255 的整数（FColor）还是 0–1 的小数（FLinearColor）按字段类型分
 */
function colorOf(node: StructNode, f: Record<string, TValue>) {
  const by = new Map(node.fields.map((x) => [x.name, x.node]))
  const r = by.get('R')
  if (!r || !by.get('G') || !by.get('B') || r.k !== 'scalar') return undefined
  const unit = r.kind === 'float'
  const get = (k: string) => {
    const n = Number(typeof f[k] === 'string' ? f[k] : '')
    const v = Number.isFinite(n) ? (unit ? n * 255 : n) : 0
    return Math.max(0, Math.min(255, Math.round(v)))
  }
  const hex = `#${['R', 'G', 'B'].map((k) => get(k).toString(16).padStart(2, '0')).join('')}`
  const from = (h: string) => {
    const out: Record<string, string> = {}
    ;['R', 'G', 'B'].forEach((k, i) => {
      const n = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
      out[k] = unit ? String(Math.round((n / 255) * 1000) / 1000) : String(n)
    })
    return out
  }
  return { hex, from }
}
