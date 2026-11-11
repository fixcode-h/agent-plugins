import { useEffect, useRef, useState } from 'react'
import {
  Eraser,
  Eye,
  EyeOff,
  Hand,
  MapPin,
  MousePointer2,
  MoveUpRight,
  Paintbrush,
  PenLine,
  Square,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
  Play,
} from 'lucide-react'
import { ANNOTATION_KINDS, annotationBox, type Annotation, type AnnotationKind, type MaskStroke } from '@shared/design'
import { walk, type Widget } from '@shared/umg'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/input'
import { t } from '@shared/i18n'

/**
 * 标注：在效果图上框选、画箭头、圈画、打点，标出要改的地方，再在 AI 对话里一起发出去。
 * 颜色表示意思：红色修改、蓝色新增、橙色删除、绿色保持不变。
 */
export type Tool = 'select' | 'hand' | 'play' | 'rect' | 'arrow' | 'pen' | 'pin' | 'mask'

// 颜色定义在 index.css 的 --mark-*：SVG 的 fill / stroke 和行内 background 都认 var()
export const KIND_COLOR: Record<AnnotationKind, string> = {
  change: 'var(--mark-change)',
  add: 'var(--mark-add)',
  remove: 'var(--mark-remove)',
  keep: 'var(--mark-keep)',
}
/** 蒙版不是标注的意思，用单独的颜色，和四种标注区分开 */
export const MASK_COLOR = 'var(--mark-mask)'
export const kindLabel = (k: AnnotationKind) =>
  ({ change: t('修改'), add: t('新增'), remove: t('删除'), keep: t('保持不变') })[k]
/** 标注显示的颜色和名字：蒙版是块状涂抹，不是修改 / 新增这类意思 */
export const markColor = (a: Pick<Annotation, 'shape' | 'kind'>) =>
  a.shape === 'mask' ? MASK_COLOR : KIND_COLOR[a.kind]
export const markLabel = (a: Pick<Annotation, 'shape' | 'kind'>) => (a.shape === 'mask' ? t('蒙版') : kindLabel(a.kind))
const KIND_HINT: Record<AnnotationKind, string> = {
  change: t('这里要改'),
  add: t('在这里加东西'),
  remove: t('把这里去掉'),
  keep: t('这部分别动，可以当参考'),
}

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string; text?: string }[] = [
  { id: 'select', icon: MousePointer2, label: t('选择'), key: 'V' },
  { id: 'hand', icon: Hand, label: t('拖动画布'), key: 'H' },
  { id: 'play', icon: Play, label: t('运行模式：像游戏里一样点按钮看效果'), key: 'G' },
  // text 是工具栏上图标下面那行字：只有图标的工具认不出是能标注的，写清楚是哪种标注
  { id: 'rect', icon: Square, label: t('框选标注'), text: t('框选'), key: 'R' },
  { id: 'arrow', icon: MoveUpRight, label: t('箭头标注'), text: t('箭头'), key: 'A' },
  { id: 'pen', icon: PenLine, label: t('画笔标注'), text: t('画笔'), key: 'P' },
  { id: 'pin', icon: MapPin, label: t('打点标注'), text: t('打点'), key: 'T' },
  { id: 'mask', icon: Paintbrush, label: t('蒙版涂抹：涂出要重绘的区域'), text: t('蒙版'), key: 'M' },
]

/** 当前工具怎么用：工具栏下面那行常显的说明，不用悬停就知道下一步点哪里拖 */
const TOOL_HINTS: Partial<Record<Tool, string>> = {
  rect: t('在图上拖出一个框，标出要改的区域'),
  arrow: t('从起点拖到终点，用箭头指向要改的地方'),
  pen: t('按住拖动，把要改的地方圈出来'),
  pin: t('点一下要改的位置，打一个点'),
}
export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((x) => [x.key.toLowerCase(), x.id]))
export const isMarkTool = (tool: Tool) => tool !== 'select' && tool !== 'hand' && tool !== 'play'

/** 效果区上方的工具栏 */
export function AnnotationToolbar({
  tool,
  onTool,
  kind,
  onKind,
  count,
  visible,
  onToggleVisible,
  onClear,
  tools,
  /**
   * 在图标下写出每种标注是哪种、并给一行用法说明。
   * 只给原画阶段用：那里是用户第一次碰到标注、光看图标认不出；画布和切图预览上方已有其他控件，放不下两行。
   */
  labels,
  mask,
}: {
  /** 只列出这些工具（看大图时只要标注工具和选择） */
  tools?: Tool[]
  tool: Tool
  onTool: (t: Tool) => void
  kind: AnnotationKind
  onKind: (k: AnnotationKind) => void
  count: number
  visible: boolean
  onToggleVisible: () => void
  onClear: () => void
  /** 在图标下写文字标签和用法说明（原画阶段用） */
  labels?: boolean
  /** 蒙版工具的参数：笔刷大小、橡皮擦、撤销上一笔 */
  mask?: {
    size: number
    erase: boolean
    canUndo: boolean
    onSize: (n: number) => void
    onErase: (v: boolean) => void
    onUndo: () => void
  }
}) {
  // 已经标了几处时，用户最需要知道的是「怎么发出去」，这句优先；还没标的时候教当前工具怎么画。
  // 蒙版交给原画面板底部那句（还要勾「只重绘蒙版区域」）：这里再说一遍会和它说法不一致。
  const hint =
    tool === 'mask'
      ? ''
      : count
        ? t('已经有 {n} 处标注，点「发送标注给 AI」就按标注改这张原画', { n: count })
        : (TOOL_HINTS[tool] ?? t('选一种标注工具，在图上标出要改的地方'))
  return (
    // 外层 pointer-events-none：这个容器在画布上盖满一条，不能拦住下面的点击；只有工具栏本身吃指针
    <div className="ud:pointer-events-none ud:flex ud:w-full ud:min-w-0 ud:flex-col ud:items-center ud:gap-1">
      <div
        role="toolbar"
        aria-label={t('标注工具')}
        className="ud:pointer-events-auto ud:flex ud:max-w-full ud:flex-wrap ud:items-center ud:justify-center ud:gap-0.5 ud:rounded-xl ud:bg-canvas-bar ud:p-1 ud:text-canvas-fg ud:shadow-pop"
      >
        {TOOLS.filter((x) => !tools || tools.includes(x.id)).map((x, i, list) => (
          <span key={x.id} className="ud:flex ud:items-center">
            {i > 0 && isMarkTool(x.id) && !isMarkTool(list[i - 1].id) && <Sep />}
            <ToolButton
              label={`${x.label} (${x.key})`}
              on={tool === x.id}
              onClick={() => onTool(x.id)}
              text={labels ? x.text : undefined}
              tall={labels}
            >
              <x.icon className="ud:h-4 ud:w-4" strokeWidth={2.2} />
            </ToolButton>
          </span>
        ))}
        {mask && tool === 'mask' && (
          <>
            <Sep />
            <div className="ud:flex ud:items-center ud:gap-1 ud:px-0.5">
              <input
                type="range"
                min={8}
                max={160}
                step={4}
                value={mask.size}
                onChange={(e) => mask.onSize(Number(e.target.value))}
                aria-label={t('蒙版笔刷大小')}
                title={t('笔刷大小：{n} 像素', { n: mask.size })}
                className="ud:h-1 ud:w-16 ud:cursor-pointer ud:accent-mark-mask"
              />
              <span className="ud:w-7 ud:text-center ud:font-mono ud:text-caption ud:text-canvas-subtle">
                {mask.size}
              </span>
              <ToolButton label={t('橡皮擦')} on={mask.erase} onClick={() => mask.onErase(!mask.erase)}>
                <Eraser className="ud:h-4 ud:w-4" strokeWidth={2.2} />
              </ToolButton>
              <ToolButton label={t('撤销上一笔')} onClick={mask.onUndo} disabled={!mask.canUndo}>
                <Undo2 className="ud:h-4 ud:w-4" strokeWidth={2.2} />
              </ToolButton>
            </div>
          </>
        )}
        {tool === 'mask' ? null : (
          <>
            <Sep />
            <div
              role="radiogroup"
              aria-label={t('标注的意思')}
              className="ud:flex ud:items-center ud:gap-0.5 ud:px-0.5"
            >
              {ANNOTATION_KINDS.map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={kind === k}
                  aria-label={kindLabel(k)}
                  onClick={() => onKind(k)}
                  title={`${kindLabel(k)}：${KIND_HINT[k]}`}
                  className={cn(
                    'ud:flex ud:h-7 ud:cursor-pointer ud:items-center ud:gap-1.5 ud:rounded-lg ud:px-2 ud:text-footnote ud:transition-colors ud:hover:text-canvas-strong',
                    kind === k && 'ud:bg-canvas-sel ud:font-medium ud:text-canvas-strong',
                  )}
                >
                  <span
                    className="ud:h-2.5 ud:w-2.5 ud:shrink-0 ud:rounded-full"
                    style={{ background: KIND_COLOR[k] }}
                  />
                  {/* 只给选中的写字，工具栏在窄的效果区里也放得下 */}
                  {kind === k && <span className="ud:whitespace-nowrap">{kindLabel(k)}</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {count > 0 && (
          <>
            <Sep />
            <ToolButton label={visible ? t('隐藏标注') : t('显示标注')} onClick={onToggleVisible}>
              {visible ? <Eye className="ud:h-4 ud:w-4" /> : <EyeOff className="ud:h-4 ud:w-4" />}
            </ToolButton>
            <ToolButton label={t('清除所有标注')} onClick={onClear}>
              <Trash2 className="ud:h-4 ud:w-4" />
            </ToolButton>
          </>
        )}
      </div>
      {/* 常显的用法说明：只给图标时用户不知道这是标注工具，也不知道该点哪里拖 */}
      {labels && hint && (
        <p className="ud:max-w-[460px] ud:rounded-md ud:bg-canvas-bar/90 ud:px-2 ud:py-0.5 ud:text-center ud:text-caption ud:leading-relaxed ud:text-canvas-fg">
          {hint}
        </p>
      )}
    </div>
  )
}

const Sep = () => <span aria-hidden className="ud:mx-1 ud:h-5 ud:w-px ud:bg-canvas-line" />

function ToolButton({
  label,
  on,
  onClick,
  disabled,
  text,
  tall,
  children,
}: {
  label: string
  on?: boolean
  onClick: () => void
  disabled?: boolean
  /** 图标下面那行字：标注工具写出来是哪一种，只有图标认不出 */
  text?: string
  /** 这一行有带文字的按钮：只带图标的也撑到一样高，不然同一行上下错位 */
  tall?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      variant="on-canvas"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn(
        'ud:flex-col ud:font-normal',
        // 同一行里的按钮一样高（有文字的和只有图标的对齐）；原画阶段要放下文字，画布上用原来的紧凑高度
        text ? 'ud:h-10 ud:w-11 ud:gap-0.5' : tall && 'ud:h-10',
        // 选中的工具和「标注的意思」分段一样用画布上的选中底，整条工具栏只有一种选中样子
        on && 'ud:bg-canvas-sel ud:text-canvas-strong',
      )}
    >
      {children}
      {text && <span className="ud:text-micro ud:leading-none">{text}</span>}
    </Button>
  )
}

/** 标注范围里的控件名：框选取大部分落在框里的控件，点和箭头取指到的最里层控件 */
export function widgetsIn(stage: HTMLElement, scale: number, root: Widget, a: Pick<Annotation, 'shape' | 'points'>) {
  const names = new Map<string, string>()
  walk(root, (w) => void names.set(w.id, w.Name))
  const s = stage.getBoundingClientRect()
  const els = [...stage.querySelectorAll<HTMLElement>('[data-wid]')]
    .filter((el) => el.dataset.wid !== root.id && names.has(el.dataset.wid!))
    .map((el) => {
      const r = el.getBoundingClientRect()
      return {
        id: el.dataset.wid!,
        x: (r.left - s.left) / scale,
        y: (r.top - s.top) / scale,
        w: r.width / scale,
        h: r.height / scale,
      }
    })
    .filter((r) => r.w > 0 && r.h > 0)
  const b = annotationBox(a)
  let hit: typeof els
  if (b.w > 4 && b.h > 4) {
    hit = els.filter((r) => {
      const ix = Math.max(0, Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x))
      const iy = Math.max(0, Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y))
      return (ix * iy) / (r.w * r.h) >= 0.6
    })
    // 框比所有控件都小：取包含框中心的最小控件
    if (!hit.length) hit = containing(els, b.x + b.w / 2, b.y + b.h / 2).slice(0, 1)
  } else hit = containing(els, b.x, b.y).slice(0, 2)
  return [...new Set(hit.map((r) => names.get(r.id)!))].slice(0, 12)
}

function containing<T extends { x: number; y: number; w: number; h: number }>(els: T[], x: number, y: number) {
  return els
    .filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)
}

/**
 * 标注层：盖在效果图上，坐标是设计稿像素。画图工具下拖动新建标注；选择工具下点编号可以写说明、改意思、删掉。
 */
type Draft = Pick<Annotation, 'shape' | 'points' | 'kind' | 'strokes'>

export function AnnotationLayer({
  size,
  scale,
  tool,
  kind,
  list,
  visible,
  active,
  brush = 48,
  erase = false,
  onActive,
  onCreate,
  onChange,
  onRemove,
}: {
  size: { X: number; Y: number }
  scale: number
  tool: Tool
  kind: AnnotationKind
  list: Annotation[]
  visible: boolean
  active: string
  /** 蒙版笔刷大小（设计稿像素） */
  brush?: number
  /** 蒙版橡皮擦：擦掉涂过的区域 */
  erase?: boolean
  onActive: (id: string) => void
  onCreate: (a: Draft) => void
  onChange: (a: Annotation) => void
  onRemove: (id: string) => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const drawing = isMarkTool(tool)

  const toDesign = (e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect()
    const c = (v: number, max: number) => Math.round(Math.max(0, Math.min(max, v)))
    return [c((e.clientX - r.left) / scale, size.X), c((e.clientY - r.top) / scale, size.Y)]
  }

  const start = (e: React.PointerEvent) => {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const [x, y] = toDesign(e)
    if (tool === 'pin') {
      onCreate({ shape: 'pin', points: [x, y], kind, strokes: [] })
      return
    }
    // 蒙版：一笔一个笔画，涂满一片半透明区域；橡皮擦是同样宽的黑笔画，渲染时盖掉涂抹
    if (tool === 'mask') {
      let cur: Draft = {
        shape: 'mask',
        kind,
        points: [x, y, 0, 0],
        strokes: [{ erase, w: brush, points: [x, y] }],
      }
      setDraft(cur)
      const move = (ev: PointerEvent) => {
        const [mx, my] = toDesign(ev)
        const s = cur.strokes[0]
        const p = s.points
        // 点太密时跳过，蒙版数据不会太大
        if (Math.hypot(mx - p[p.length - 2], my - p[p.length - 1]) < 2 / scale) return
        cur = { ...cur, strokes: [{ ...s, points: [...p, mx, my] }] }
        setDraft(cur)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDraft(null)
        onCreate(cur)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    const shape = tool as 'rect' | 'arrow' | 'pen'
    let cur: Draft = {
      shape,
      kind,
      points: shape === 'rect' ? [x, y, 0, 0] : shape === 'arrow' ? [x, y, x, y] : [x, y],
      strokes: [],
    }
    setDraft(cur)
    const move = (ev: PointerEvent) => {
      const [mx, my] = toDesign(ev)
      if (shape === 'rect')
        cur = { ...cur, points: [Math.min(x, mx), Math.min(y, my), Math.abs(mx - x), Math.abs(my - y)] }
      else if (shape === 'arrow') cur = { ...cur, points: [x, y, mx, my] }
      else {
        const p = cur.points
        // 点太密时跳过，画笔数据不会太大
        if (Math.hypot(mx - p[p.length - 2], my - p[p.length - 1]) < 3 / scale) return
        cur = { ...cur, points: [...p, mx, my] }
      }
      setDraft(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      const b = annotationBox(cur)
      const tiny =
        shape === 'rect'
          ? b.w < 6 || b.h < 6
          : shape === 'arrow'
            ? Math.hypot(cur.points[2] - cur.points[0], cur.points[3] - cur.points[1]) < 10
            : cur.points.length < 6
      if (!tiny) onCreate(cur)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const shown = visible ? list : []
  const editing = shown.find((a) => a.id === active)
  return (
    <div
      ref={layer}
      onPointerDown={start}
      className={cn('ud:absolute ud:inset-0', drawing ? 'ud:cursor-crosshair' : 'ud:pointer-events-none')}
    >
      <svg
        viewBox={`0 0 ${size.X} ${size.Y}`}
        width={size.X * scale}
        height={size.Y * scale}
        className="ud:pointer-events-none ud:absolute ud:inset-0 ud:overflow-visible"
      >
        <defs>
          {Object.entries(KIND_COLOR).map(([k, c]) => (
            <marker
              key={k}
              id={`ann-head-${k}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {shown.map((a) => (
          <Shape key={a.id} id={a.id} a={a} scale={scale} size={size} on={a.id === active} />
        ))}
        {draft && <Shape id="draft" a={draft} scale={scale} size={size} on />}
      </svg>
      {shown.map((a, i) => {
        const b = annotationBox(a)
        const [x, y] = a.shape === 'arrow' ? [a.points[0], a.points[1]] : [b.x, b.y]
        return (
          <button
            key={a.id}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onActive(a.id === active ? '' : a.id)
            }}
            title={a.note || markLabel(a)}
            aria-label={t('标注 {n}', { n: i + 1 })}
            style={{ left: x * scale, top: y * scale, background: markColor(a) }}
            className={cn(
              'ud:pointer-events-auto ud:absolute ud:z-10 ud:grid ud:h-5 ud:min-w-5 ud:-translate-x-1/2 ud:-translate-y-1/2 ud:cursor-pointer ud:place-items-center ud:rounded-full ud:px-1 ud:font-mono ud:text-caption ud:font-semibold ud:text-white ud:shadow-pop ud:ring-2 ud:ring-white/90',
              a.id === active && 'ud:ring-[3px]',
            )}
          >
            {i + 1}
          </button>
        )
      })}
      {editing && (
        <AnnotationEditor
          key={editing.id}
          a={editing}
          index={shown.indexOf(editing) + 1}
          scale={scale}
          size={size}
          onChange={onChange}
          onRemove={() => onRemove(editing.id)}
          onClose={() => onActive('')}
        />
      )}
    </div>
  )
}

function Shape({
  id,
  a,
  scale,
  size,
  on,
}: {
  id: string
  a: Draft
  scale: number
  size: { X: number; Y: number }
  on: boolean
}) {
  const c = markColor(a)
  // 线宽按屏幕像素算，缩放后不会变粗变细
  const sw = (on ? 3 : 2.25) / scale
  const p = a.points
  if (a.shape === 'mask') return <MaskShape id={id} a={a} size={size} scale={scale} />
  if (a.shape === 'rect')
    return (
      <rect
        x={p[0]}
        y={p[1]}
        width={p[2]}
        height={p[3]}
        rx={4 / scale}
        fill={c}
        fillOpacity={0.12}
        stroke={c}
        strokeWidth={sw}
      />
    )
  if (a.shape === 'arrow')
    return (
      <line
        x1={p[0]}
        y1={p[1]}
        x2={p[2]}
        y2={p[3]}
        stroke={c}
        strokeWidth={sw}
        strokeLinecap="round"
        markerEnd={`url(#ann-head-${a.kind})`}
      />
    )
  if (a.shape === 'pen')
    return (
      <polyline
        points={p.join(' ')}
        fill="none"
        stroke={c}
        strokeWidth={sw * 1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  return <circle cx={p[0]} cy={p[1]} r={14 / scale} fill={c} fillOpacity={0.18} stroke={c} strokeWidth={sw} />
}

/**
 * 蒙版：一块半透明的涂抹区域，不是细线。涂抹的笔画是白、橡皮擦是黑，
 * 合成一个 SVG mask，再用它给整块画面涂上颜色
 */
function MaskShape({
  id,
  a,
  size,
  scale,
}: {
  id: string
  a: Pick<Annotation, 'shape' | 'points' | 'kind' | 'strokes'>
  size: { X: number; Y: number }
  scale: number
}) {
  const maskId = `ann-mask-${id}`
  const w = Math.max(1, size.X)
  const h = Math.max(1, size.Y)
  const strokes = (a.strokes ?? []).filter((s) => s.points.length >= 2)
  return (
    <g>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <rect x={0} y={0} width={w} height={h} fill="black" />
          {strokes.map((s, i) => (
            <StrokePath key={i} s={s} color={s.erase ? 'black' : 'white'} />
          ))}
        </mask>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill={MASK_COLOR} fillOpacity={0.42} mask={`url(#${maskId})`} />
      {/* 涂抹的轮廓，看得出蒙版边界在哪 */}
      {strokes
        .filter((s) => !s.erase)
        .map((s, i) => (
          <StrokePath key={i} s={s} color={MASK_COLOR} width={1 / scale} opacity={0.85} />
        ))}
    </g>
  )
}

function StrokePath({ s, color, width, opacity }: { s: MaskStroke; color: string; width?: number; opacity?: number }) {
  const p = s.points
  const w = width ?? s.w
  if (p.length === 2) return <circle cx={p[0]} cy={p[1]} r={Math.max(0.5, w / 2)} fill={color} fillOpacity={opacity} />
  return (
    <polyline
      points={p.join(' ')}
      fill="none"
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

/** 选中一个标注时旁边弹出的小卡片：写说明、改意思、删除 */
function AnnotationEditor({
  a,
  index,
  scale,
  size,
  onChange,
  onRemove,
  onClose,
}: {
  a: Annotation
  index: number
  scale: number
  size: { X: number; Y: number }
  onChange: (a: Annotation) => void
  onRemove: () => void
  onClose: () => void
}) {
  const b = annotationBox(a)
  const W = 260
  // 放在标注右边，放不下就放左边；纵向不超出效果图
  const right = (b.x + b.w) * scale + 14
  const left = right + W > size.X * scale ? Math.max(4, b.x * scale - W - 14) : right
  const top = Math.max(4, Math.min(b.y * scale, size.Y * scale - 190))
  const [note, setNote] = useState(a.note)
  useEffect(() => setNote(a.note), [a.note])
  const commit = () => note !== a.note && onChange({ ...a, note })
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left, top, width: W }}
      className="ud:pointer-events-auto ud:absolute ud:z-20 ud:rounded-xl ud:bg-card ud:p-3 ud:text-fg ud:shadow-pop"
    >
      <div className="ud:mb-2 ud:flex ud:items-center ud:gap-2">
        <span
          className="ud:grid ud:h-5 ud:min-w-5 ud:place-items-center ud:rounded-full ud:px-1 ud:font-mono ud:text-caption ud:font-semibold ud:text-white"
          style={{ background: markColor(a) }}
        >
          {index}
        </span>
        <span className="ud:flex-1 ud:truncate ud:text-footnote ud:text-muted">
          {a.shape === 'mask'
            ? t('只重绘涂过的这块，其余保持不变')
            : a.widgets.length
              ? a.widgets.join('、')
              : t('没有对上具体的控件')}
        </span>
        <IconButton icon={X} label={t('关闭')} onClick={onClose} />
      </div>
      <div className={cn('ud:mb-2 ud:grid ud:grid-cols-4 ud:gap-1', a.shape === 'mask' && 'ud:hidden')}>
        {ANNOTATION_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => onChange({ ...a, note, kind: k })}
            title={KIND_HINT[k]}
            className={cn(
              'ud:flex ud:h-7 ud:cursor-pointer ud:items-center ud:justify-center ud:gap-1 ud:rounded-md ud:text-caption ud:transition-colors',
              a.kind === k
                ? 'ud:font-medium ud:text-white'
                : 'ud:bg-sel/70 ud:text-muted ud:hover:bg-sel ud:hover:text-fg',
            )}
            style={a.kind === k ? { background: KIND_COLOR[k] } : undefined}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <Textarea
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            commit()
            onClose()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            commit()
            onClose()
          }
        }}
        rows={3}
        placeholder={
          a.shape === 'mask'
            ? t('说明这块要改成什么，例如：换成金色描边的按钮')
            : t('说明要怎么改，例如：按钮换成金色描边')
        }
        aria-label={t('标注说明')}
        className="ud:block ud:resize-none ud:px-2.5 ud:py-2 ud:text-footnote"
      />
      <div className="ud:mt-2 ud:flex ud:items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="ud:h-7 ud:gap-1 ud:px-1.5 ud:text-footnote ud:font-normal ud:text-subtle ud:hover:bg-danger/10 ud:hover:text-danger"
        >
          <Trash2 className="ud:h-3.5 ud:w-3.5" />
          {t('删除标注')}
        </Button>
        <span className="ud:ml-auto ud:text-caption ud:text-subtle">{t('回车保存')}</span>
      </div>
    </div>
  )
}

/** 还没发出去的标注，一个个小标签列在输入框上面：编号、意思、说明，可以单独删掉 */
export function AnnotationChips({ list, onRemove }: { list: Annotation[]; onRemove?: (id: string) => void }) {
  return (
    <div className="ud:flex ud:flex-wrap ud:gap-1">
      {list.map((a, i) => (
        <span
          key={a.id}
          title={[a.widgets.join('、'), a.note].filter(Boolean).join('\n')}
          className="ud:group ud:flex ud:max-w-full ud:items-center ud:gap-1.5 ud:rounded-md ud:bg-sel/70 ud:py-0.5 ud:pr-1 ud:pl-1 ud:text-caption ud:text-muted"
        >
          <span
            className="ud:grid ud:h-4 ud:min-w-4 ud:place-items-center ud:rounded-full ud:px-0.5 ud:font-mono ud:text-micro ud:font-semibold ud:text-white"
            style={{ background: markColor(a) }}
          >
            {i + 1}
          </span>
          <span className="ud:shrink-0">{markLabel(a)}</span>
          {(a.note || a.widgets[0]) && (
            <span className="ud:max-w-[140px] ud:truncate ud:text-subtle">{a.note || a.widgets[0]}</span>
          )}
          {onRemove && (
            <IconButton
              icon={X}
              size="2xs"
              label={t('删除标注')}
              onClick={() => onRemove(a.id)}
              className="ud:h-4 ud:w-4"
            />
          )}
        </span>
      ))}
    </div>
  )
}
