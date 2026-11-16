import { Copy, CopyPlus, ListPlus, Pin, Trash2, Undo2 } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { usePropMark } from './marks.ts'
import { show } from '../api.ts'
import { h, t } from '../host.ts'
import {
  Caret,
  Checkbox,
  Collapse,
  ContainerHead,
  EnumSelect,
  Muted,
  TextField,
  VecField,
  vecKeys,
} from './controls.tsx'
import { isNumberType, looksLikePath, toDisplay, type Prop } from './model.ts'
import { RefChip, type OpenHow } from './RefChip.tsx'

/** 一行（顶层属性，或展开后的结构体成员、数组元素）：path 是交给桥接的属性路径（Stats.MaxHP、Triggers[0]、Tags["Fire"]） */
export interface Node {
  key: string
  label: string
  path: string
  value: unknown
  type?: string
  /** 容器的元素类型（UInputTrigger*）：展开后子行按它挑控件（空的对象指针显示成「无」） */
  inner?: string
  enum?: string[]
  enumLabels?: string[]
  readOnly?: boolean
  readOnlyWhy?: string
  tooltip?: string
  replicated?: boolean
  container?: 'array' | 'set' | 'map'
  count?: number
  fixedSize?: boolean
  /** 数组元素：在父数组里的下标（行尾给插入、复制、删除） */
  element?: { array: string; index: number }
}

export function nodeOf(p: Prop): Node {
  return {
    key: p.name,
    label: p.displayName || toDisplay(p.name, p.type === 'bool'),
    path: p.name,
    value: p.value,
    type: p.type,
    enum: p.enum,
    enumLabels: p.enumLabels,
    readOnly: p.readOnly,
    readOnlyWhy: p.readOnlyWhy,
    tooltip: p.tooltip,
    replicated: p.replicated,
    // 旧桥接没有 container：数组只显示个数，不给加删按钮（旧桥接不认 array 参数）
    container: p.container,
    count: p.count,
    fixedSize: p.fixedSize,
    inner: p.inner,
  }
}

/** 细节面板的动作和状态，各行从这里取，不一层层传 */
export interface DetailsApi {
  q: string
  busy: string
  /** 每改一次加一：展开着的大值（列表里只有摘要）据此重取 */
  version: number
  /** 这次在网页上改过的（属性路径 → 原值） */
  changed: (path: string) => unknown
  isChanged: (path: string) => boolean
  setValue: (n: Node, raw: string) => void
  arrayOp: (path: string, op: 'add' | 'insert' | 'duplicate' | 'remove' | 'clear', index?: number) => void
  reset: (n: Node) => void
  pin?: (path: string) => void
  /** 点对象引用：via 是属性的显示名（导航条面包屑上写「经 Static Mesh」）；返回 undefined 表示这个引用不能点 */
  openRef: (p: string, via?: string) => ((how: OpenHow) => void) | undefined
  loadFull: (path: string) => Promise<unknown>
}
export const DetailsCtx = createContext<DetailsApi | null>(null)
const useDetails = () => useContext(DetailsCtx)!

/** 搜索命中的字加底色 */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="ue:rounded-[2px] ue:bg-warning/30 ue:text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/** 值是不是还要往下展开（结构体、数组、映射；向量按分量直接改，不展开） */
function expandable(n: Node) {
  const v = n.value as Record<string, unknown> | null
  if (n.container) return (n.count ?? 1) > 0 || !!v?._truncated
  if (Array.isArray(v)) return v.length > 0
  return typeof v === 'object' && v !== null && !vecKeys(v)
}

/**
 * 点整行展开时，这一下是不是该算「展开」：点在输入框、下拉、按钮、链接这类控件上的不算（它们有自己的事），
 * 从弹出层（下拉菜单在 portal 里，React 事件照样冒泡上来）来的不算，拖选文字的也不算
 */
export function rowClickToggles(e: MouseEvent<HTMLElement>) {
  const el = e.target as Element
  if (!(el instanceof Element) || !e.currentTarget.contains(el)) return false
  const hit = el.closest(
    'button,a,input,select,textarea,label,[role="button"],[role="checkbox"],[role="combobox"],[role="switch"],[contenteditable="true"],[data-no-row-toggle]',
  )
  if (hit && e.currentTarget.contains(hit)) return false
  return !window.getSelection()?.toString()
}

/** 子行：从完整的值里拆出结构体成员 / 数组元素 / 映射的键 */
function childrenOf(n: Node, full: unknown): Node[] {
  const ro = n.readOnly || n.container === 'set'
  const why = n.container === 'set' ? t('集合的元素不能单独改') : n.readOnlyWhy
  const base = { readOnly: ro, readOnlyWhy: why, type: n.inner }
  if (Array.isArray(full))
    return full.map((v, i) => ({
      ...base,
      key: `${n.key}[${i}]`,
      label: t('索引 [{i}]', { i }),
      path: `${n.path}[${i}]`,
      value: v,
      ...(n.container === 'array' ? { element: { array: n.path, index: i } } : {}),
    }))
  if (full && typeof full === 'object')
    return Object.entries(full as Record<string, unknown>).map(([k, v]) => ({
      ...base,
      key: `${n.key}.${k}`,
      label: n.container === 'map' ? k : toDisplay(k),
      path: n.container === 'map' ? `${n.path}[${JSON.stringify(k)}]` : `${n.path}.${k}`,
      value: v,
      container: Array.isArray(v) ? ('array' as const) : undefined,
      count: Array.isArray(v) ? v.length : undefined,
    }))
  return []
}

/**
 * 一行属性：左边名字（缩进、展开箭头、同步标记），中间一道细线，右边值控件，最右是重置箭头和固定到监视。
 * 名字列宽来自外层的 CSS 变量 --ue-name-w（拖动分隔线改）
 */
export function Row({ n, depth = 0 }: { n: Node; depth?: number }) {
  const d = useDetails()
  const { cn, ui } = h()
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<unknown>()
  const [err, setErr] = useState('')
  const canOpen = expandable(n)
  const changed = d.isChanged(n.path)
  const mark = usePropMark(n.path, depth)
  const ro = n.readOnly
  const why = ro ? n.readOnlyWhy || t('这个属性不能改') : undefined

  const toggle = async () => {
    if (open) return setOpen(false)
    setErr('')
    try {
      // 列表里大的值是摘要（_truncated），展开时按路径取完整的；小的直接用
      const v = n.value as Record<string, unknown> | null
      setFull(v && typeof v === 'object' && !v._truncated ? v : await d.loadFull(n.path))
      setOpen(true)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const truncated = !!(n.value as { _truncated?: boolean } | null)?._truncated
  // 列表里是摘要的大值：展开着时每改一次重取（小的值直接跟着列表重读走）
  useEffect(() => {
    if (!open || !truncated) return
    d.loadFull(n.path).then(setFull, (e: Error) => setErr(e.message))
    // 只在改过之后重取
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [d.version])
  const kids = open ? childrenOf(n, truncated ? full : n.value) : []

  return (
    <>
      {/* 能展开的行点整行都能展开收起（用户嫌只能点箭头，2026-11-16）；点在值控件、按钮上的不算 */}
      <div
        onClick={(e) => {
          if (canOpen && rowClickToggles(e)) void toggle()
        }}
        className={cn(
          'ue:group ue:grid ue:min-h-8 ue:grid-cols-[var(--ue-name-w)_minmax(0,1fr)_4.5rem] ue:border-b ue:border-line/50 ue:transition-colors ue:hover:bg-hover/50',
          canOpen && 'ue:cursor-pointer',
          mark && 'ue:bg-warning/8 ue:shadow-[inset_2px_0_0_var(--warning)]',
        )}
      >
        <div
          data-name-cell
          className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:border-r ue:border-line/50 ue:py-1 ue:pr-2"
          style={{ paddingLeft: 12 + depth * 14 }}
          title={[n.label !== n.path && n.path, n.type, n.tooltip, why].filter(Boolean).join('\n')}
        >
          {canOpen ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? t('收起') : t('展开')}
              onClick={(e) => {
                e.stopPropagation()
                void toggle()
              }}
              className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:text-muted ue:hover:text-fg"
            >
              <Caret open={open} />
            </button>
          ) : (
            <span className="ue:w-4 ue:shrink-0" />
          )}
          {/* 只读的名字也压暗一档（UE 一样），和能改的一眼分开 */}
          <span className={cn('ue:truncate ue:text-footnote', ro ? 'ue:text-muted' : 'ue:text-fg')}>
            <Hl text={n.label} q={depth ? '' : d.q} />
          </span>
          {n.replicated && (
            <span
              title={t('同步属性')}
              className="ue:shrink-0 ue:rounded-[3px] ue:bg-run-soft ue:px-1 ue:text-caption ue:text-run"
            >
              {t('同步')}
            </span>
          )}
        </div>
        <div className="ue:flex ue:min-w-0 ue:flex-col ue:justify-center ue:gap-0.5 ue:px-3 ue:py-1">
          <Value n={n} why={why} changed={changed} />
          {mark && (
            <span
              className="ue:truncate ue:font-mono ue:text-caption ue:text-warning"
              title={t('导入后：{v}', { v: show(mark.after) })}
            >
              {t('导入后 → {v}', { v: show(mark.after) })}
            </span>
          )}
          {err && <span className="ue:text-caption ue:text-danger">{err}</span>}
        </div>
        <div className="ue:flex ue:items-center ue:justify-end ue:gap-0.5 ue:pr-2">
          {n.element && !ro && (
            <span className="ue:flex ue:gap-0.5 ue:opacity-0 ue:transition-opacity ue:group-hover:opacity-100 ue:focus-within:opacity-100">
              <ui.IconButton
                icon={ListPlus}
                label={t('在前面插入')}
                size="xs"
                onClick={() => d.arrayOp(n.element!.array, 'insert', n.element!.index)}
              />
              <ui.IconButton
                icon={CopyPlus}
                label={t('复制这个元素')}
                size="xs"
                onClick={() => d.arrayOp(n.element!.array, 'duplicate', n.element!.index)}
              />
              <ui.IconButton
                icon={Trash2}
                label={t('删除这个元素')}
                size="xs"
                onClick={() => d.arrayOp(n.element!.array, 'remove', n.element!.index)}
              />
            </span>
          )}
          {!n.element && d.pin && !depth && (
            <span className="ue:opacity-0 ue:transition-opacity ue:group-hover:opacity-100 ue:focus-within:opacity-100">
              <ui.IconButton icon={Pin} label={t('固定到监视')} size="xs" onClick={() => d.pin!(n.path)} />
            </span>
          )}
          {!n.element && !depth && (
            <span className="ue:opacity-0 ue:transition-opacity ue:group-hover:opacity-100 ue:focus-within:opacity-100">
              <ui.IconButton
                icon={Copy}
                label={t('复制值')}
                size="xs"
                onClick={() => void navigator.clipboard.writeText(show(n.value))}
              />
            </span>
          )}
          {/* 改过的值：UE 那个重置箭头，点了恢复成这次改之前的值 */}
          {changed && !ro && (
            <ui.IconButton
              icon={Undo2}
              label={t('恢复原值 {v}', { v: show(d.changed(n.path)) })}
              size="xs"
              onClick={() => d.reset(n)}
            />
          )}
        </div>
      </div>
      {canOpen && (
        <Collapse open={open}>
          {kids.map((c) => (
            <Row key={c.key} n={c} depth={depth + 1} />
          ))}
        </Collapse>
      )}
    </>
  )
}

/** 值控件：按类型挑（勾选框、枚举下拉、向量、对象引用、容器、数字 / 文字框） */
function Value({ n, why, changed }: { n: Node; why?: string; changed: boolean }) {
  const d = useDetails()
  const busy = d.busy === n.path
  const ro = n.readOnly
  const v = n.value
  const off = ro || busy
  if (n.container) {
    const canEdit = !ro && n.container === 'array' && !n.fixedSize
    return (
      <ContainerHead
        count={n.count ?? (Array.isArray(v) ? v.length : undefined)}
        canAdd={canEdit}
        canClear={!ro && !n.fixedSize}
        busy={d.busy === `${n.path}#array`}
        onAdd={() => d.arrayOp(n.path, 'add')}
        onClear={() => d.arrayOp(n.path, 'clear')}
      />
    )
  }
  if (n.type === 'bool' || typeof v === 'boolean')
    return (
      <Checkbox
        checked={v === true}
        disabled={off}
        title={why}
        label={n.label}
        onChange={(x) => d.setValue(n, String(x))}
      />
    )
  if (n.enum?.length)
    return (
      <EnumSelect
        value={show(v)}
        names={n.enum}
        labels={n.enumLabels}
        disabled={off}
        title={why}
        label={n.label}
        onChange={(x) => d.setValue(n, x)}
      />
    )
  const vec = vecKeys(v)
  if (vec)
    return (
      <VecField
        value={v as Record<string, number>}
        keys={vec}
        disabled={off}
        changed={changed}
        title={why}
        label={n.label}
        onSubmit={(x) => d.setValue(n, x)}
      />
    )
  if (Array.isArray(v))
    return <ContainerHead count={v.length} canAdd={false} canClear={false} onAdd={noop} onClear={noop} />
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    if (o._truncated)
      return <Muted title={String(o._preview ?? '')}>{t('{n} 个字符，展开看全部', { n: Number(o._chars) || 0 })}</Muted>
    return <Muted>{t('{n} 个成员', { n: Object.keys(o).length })}</Muted>
  }
  // 对象引用（路径字符串，或者属性类型是对象指针而值是空）
  const isRef =
    (typeof v === 'string' && looksLikePath(v)) ||
    ((v === null || v === '' || v === 'None') && /\*|Ptr<|Class<|^U[A-Z]|^A[A-Z]/.test(n.type ?? ''))
  if (isRef)
    return (
      <RefChip
        path={typeof v === 'string' ? v : ''}
        disabled={ro}
        onOpen={typeof v === 'string' ? d.openRef(v, viaOf(n)) : undefined}
        onClear={ro ? undefined : () => d.setValue(n, 'None')}
      />
    )
  const numeric = typeof v === 'number' || isNumberType(n.type ?? '')
  return (
    <TextField
      value={show(v)}
      numeric={numeric}
      disabled={off}
      changed={changed}
      title={why}
      label={n.label}
      onSubmit={(x) => d.setValue(n, x)}
    />
  )
}

const noop = () => {}

/** 面包屑上「经哪个属性」：顶层属性用显示名，数组元素、结构体成员用属性路径（Static Materials[0] 比「索引 [0]」看得懂） */
const viaOf = (n: Node) => (n.path.includes('.') || n.path.includes('[') ? n.path : n.label)

/** 分类折叠条：整行一条稍亮的底，左边箭头和名字；子分类、「高级」往里缩一级 */
export function CategoryBar({
  title,
  open,
  depth = 0,
  count,
  onToggle,
  q,
}: {
  title: string
  open: boolean
  depth?: number
  count?: number
  onToggle: () => void
  q: string
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      style={{ paddingLeft: 10 + depth * 14 }}
      className={cn(
        'ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/70 ue:pr-3 ue:text-left ue:transition-colors',
        depth ? 'ue:bg-hover/40 ue:hover:bg-hover/70' : 'ue:bg-hover ue:hover:bg-active',
      )}
    >
      <Caret open={open} className="ue:text-muted" />
      <span className={cn('ue:truncate ue:text-footnote ue:text-fg', !depth && 'ue:font-medium')}>
        <Hl text={title} q={q} />
      </span>
      {count !== undefined && !open && <span className="ue:text-caption ue:text-subtle">{count}</span>}
    </button>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="ue:motion-safe:animate-fade">{children}</div>
}
