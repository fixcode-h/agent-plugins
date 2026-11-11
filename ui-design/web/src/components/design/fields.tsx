import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ImageOff,
  StretchHorizontal,
  StretchVertical,
} from 'lucide-react'
import { parseColor, type Brush, type ImageFit, type Margin, type Vec2 } from '@shared/umg'
import type { DesignImage } from '@shared/design'
import { cn } from '@/lib/utils'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu'
import { t } from '@shared/i18n'

/** 属性面板里的小号控件：一行一个属性，左边名字、右边值，参照 UE 的 Details 面板 */

export const getPath = (o: any, path: string) => path.split('.').reduce((x, k) => x?.[k], o)
export function setPath<T>(o: T, path: string, v: unknown): T {
  const [k, ...rest] = path.split('.')
  const cur = (o as any) ?? {}
  return { ...cur, [k]: rest.length ? setPath(cur[k], rest.join('.'), v) : v }
}

// 属性面板的框都用 Input / Select 的 xs 档（h-7、0.75rem），和组件库同一套边框和焦点圈

export function FieldRow({
  label,
  children,
  title,
  leading,
}: {
  label: string
  children: React.ReactNode
  title?: string
  /** 属性名左边的按钮（UE 的关键帧菱形） */
  leading?: React.ReactNode
}) {
  return (
    <div data-field={label} className="ud:flex ud:min-h-8 ud:items-center ud:gap-2 ud:px-3 ud:py-0.5">
      {leading}
      {/* 固定宽度让右侧控件上下对齐，名字长时换行显示完整，不截断 */}
      <span
        title={title ?? label}
        className="ud:w-[104px] ud:shrink-0 ud:text-footnote ud:leading-tight ud:break-words ud:text-subtle"
      >
        {label}
      </span>
      <div className="ud:flex ud:min-w-0 ud:flex-1 ud:items-center ud:gap-1">{children}</div>
    </div>
  )
}

/**
 * 输入框改了值、还没按回车也没失焦就被卸载时，把这个值提交一次。
 * 点画布上别的控件时选中马上换掉，属性面板按控件 id 整个重建，blur 根本来不及触发，输入的值就丢了
 * （点控件树会先失焦，两种操作结果不一样）。提交给的是原来那个控件的 onChange，改到的是对的控件
 */
function useCommitOnUnmount(commit: () => void) {
  const ref = useRef(commit)
  ref.current = commit
  useEffect(() => () => ref.current(), [])
}

/** 数字：失去焦点或回车时提交，支持上下键微调 */
export function NumInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  prefix,
  label,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  prefix?: string
  label?: string
}) {
  const [text, setText] = useState(String(value ?? 0))
  useEffect(() => setText(String(+(value ?? 0).toFixed(4))), [value])
  const commit = (s: string) => {
    const n = Number(s)
    if (!Number.isFinite(n)) return setText(String(value))
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    if (c !== value) onChange(c)
    else setText(String(c))
  }
  useCommitOnUnmount(() => {
    if (text !== String(+(value ?? 0).toFixed(4))) commit(text)
  })
  return (
    <label className="ud:relative ud:flex ud:min-w-0 ud:flex-1 ud:items-center">
      {prefix && (
        <span className="ud:pointer-events-none ud:absolute ud:left-1.5 ud:font-mono ud:text-micro ud:text-subtle/80">
          {prefix}
        </span>
      )}
      <Input
        size="xs"
        aria-label={label ?? prefix}
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const n = (Number(text) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            commit(String(+n.toFixed(4)))
          }
        }}
        className={cn('ud:min-w-0 ud:font-mono ud:tabular-nums', prefix && 'ud:pl-4')}
      />
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  multiline,
  label,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  label: string
  placeholder?: string
}) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  // 多行时高度跟着内容走（最高 320px，再多就滚动）：长的描述不用拖拽就能看全；面板拉宽拉窄也重新算
  useLayoutEffect(() => {
    const el = ref.current
    if (!multiline || !el) return
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${Math.min(320, el.scrollHeight + el.offsetHeight - el.clientHeight)}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [multiline, text])
  useCommitOnUnmount(() => {
    if (text !== value) onChange(text)
  })
  const common = {
    'aria-label': label,
    placeholder,
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => text !== value && onChange(text),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) e.currentTarget.blur()
    },
  }
  return multiline ? (
    <Textarea
      ref={ref}
      rows={2}
      {...common}
      // 和 xs 输入框同一个字号和圆角，高度由上面的 fit 跟着内容算
      className="ud:min-w-0 ud:resize-none ud:overflow-y-auto ud:rounded-md ud:px-1.5 ud:py-1 ud:text-footnote ud:leading-snug"
    />
  ) : (
    <Input ref={ref} size="xs" {...common} className="ud:min-w-0" />
  )
}

export function Vec2Input({
  value,
  onChange,
  labels = ['X', 'Y'],
  step,
}: {
  value: Vec2
  onChange: (v: Vec2) => void
  labels?: [string, string]
  step?: number
}) {
  const v = value ?? { X: 0, Y: 0 }
  return (
    <>
      <NumInput prefix={labels[0]} step={step} value={v.X} onChange={(X) => onChange({ ...v, X })} />
      <NumInput prefix={labels[1]} step={step} value={v.Y} onChange={(Y) => onChange({ ...v, Y })} />
    </>
  )
}

export function MarginInput({
  value,
  onChange,
  step,
}: {
  value: Margin
  onChange: (v: Margin) => void
  step?: number
}) {
  const v = value ?? { Left: 0, Top: 0, Right: 0, Bottom: 0 }
  return (
    <div className="ud:grid ud:w-full ud:grid-cols-4 ud:gap-1">
      {(['Left', 'Top', 'Right', 'Bottom'] as const).map((k) => (
        <NumInput
          key={k}
          prefix={k[0]}
          label={k}
          step={step}
          value={v[k]}
          onChange={(n) => onChange({ ...v, [k]: n })}
        />
      ))}
    </div>
  )
}

const hex2 = (n: number) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()

/** 颜色：色块（系统取色器）+ 十六进制 + 不透明度 */
export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [r, g, b, a] = parseColor(value)
  const rgb = `#${hex2(r)}${hex2(g)}${hex2(b)}`
  const [text, setText] = useState(String(value ?? ''))
  useEffect(() => setText(String(value ?? '')), [value])
  const commitColor = () => {
    const v = text.trim().toUpperCase()
    const ok = /^#?[0-9A-F]{6}([0-9A-F]{2})?$/.test(v)
    if (!ok) return setText(value)
    const h = v.startsWith('#') ? v : `#${v}`
    const next = h.length === 7 ? `${h}FF` : h
    if (next !== value) onChange(next)
  }
  useCommitOnUnmount(() => {
    if (text !== String(value ?? '')) commitColor()
  })
  return (
    <>
      <label
        className="ud:relative ud:h-7 ud:w-7 ud:shrink-0 ud:cursor-pointer ud:overflow-hidden ud:rounded-md ud:border ud:border-line-strong ud:bg-[length:8px_8px] ud:[background-image:conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)]"
        title={t('选择颜色')}
      >
        <span
          className="ud:absolute ud:inset-0"
          style={{ background: `rgba(${r * 255},${g * 255},${b * 255},${a})` }}
        />
        <input
          type="color"
          value={rgb.toLowerCase()}
          onChange={(e) => onChange(`${e.target.value.toUpperCase()}${hex2(a)}`)}
          className="ud:absolute ud:inset-0 ud:cursor-pointer ud:opacity-0"
          aria-label={t('选择颜色')}
        />
      </label>
      <Input
        size="xs"
        aria-label={t('颜色')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitColor}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="ud:min-w-0 ud:flex-1 ud:font-mono ud:uppercase"
      />
      <div className="ud:w-[52px] ud:shrink-0">
        <NumInput
          prefix="A"
          label={t('不透明度')}
          step={0.05}
          min={0}
          max={1}
          value={+a.toFixed(3)}
          onChange={(n) => onChange(`${rgb}${hex2(n)}`)}
        />
      </div>
    </>
  )
}

export function EnumInput({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  label: string
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options.map((o) => ({ value: o, label: o }))}
      size="xs"
    />
  )
}

export function BoolInput({
  value,
  onChange,
  label,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return <Switch aria-label={label} checked={!!value} onCheckedChange={onChange} />
}

const H_OPTS = [
  { id: 'HAlign_Left', icon: AlignStartVertical, label: t('左对齐') },
  { id: 'HAlign_Center', icon: AlignCenterVertical, label: t('水平居中') },
  { id: 'HAlign_Right', icon: AlignEndVertical, label: t('右对齐') },
  { id: 'HAlign_Fill', icon: StretchHorizontal, label: t('水平填充') },
]
const V_OPTS = [
  { id: 'VAlign_Top', icon: AlignStartHorizontal, label: t('顶部对齐') },
  { id: 'VAlign_Center', icon: AlignCenterHorizontal, label: t('垂直居中') },
  { id: 'VAlign_Bottom', icon: AlignEndHorizontal, label: t('底部对齐') },
  { id: 'VAlign_Fill', icon: StretchVertical, label: t('垂直填充') },
]

/** 对齐方式：和 UE 一样四个图标按钮 */
export function AlignInput({
  axis,
  value,
  onChange,
}: {
  axis: 'h' | 'v'
  value: string
  onChange: (v: string) => void
}) {
  const opts = axis === 'h' ? H_OPTS : V_OPTS
  return (
    <Segmented
      size="sm"
      iconOnly
      label={axis === 'h' ? t('水平对齐') : t('垂直对齐')}
      value={value}
      onChange={onChange}
      options={opts}
    />
  )
}

/** 图片选择：缩略图按钮，点开列出设计里的图片 */
export function ImagePick({
  value,
  images,
  url,
  onChange,
}: {
  value: string
  images: DesignImage[]
  url: (img: DesignImage) => string | undefined
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const id = value?.startsWith('img:') ? value.slice(4) : ''
  const cur = images.find((i) => i.id === id)
  const src = cur && url(cur)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="ud:flex ud:h-8 ud:min-w-0 ud:flex-1 ud:cursor-pointer ud:items-center ud:gap-2 ud:rounded-md ud:border ud:border-line ud:bg-field ud:px-1 ud:text-left ud:text-footnote ud:hover:border-line-strong">
          <Thumb src={src} className="ud:h-6 ud:w-6" />
          <span className={cn('ud:min-w-0 ud:flex-1 ud:truncate', !cur && 'ud:text-subtle')}>
            {cur ? cur.name : id ? t('图片不存在') : t('无图片（纯色）')}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="ud:max-h-[320px] ud:w-[240px] ud:overflow-y-auto ud:p-1">
        <button
          onClick={() => (onChange(''), setOpen(false))}
          className="ud:flex ud:h-9 ud:w-full ud:cursor-pointer ud:items-center ud:gap-2 ud:rounded-md ud:px-1.5 ud:text-left ud:text-footnote ud:hover:bg-sel"
        >
          <span className="ud:grid ud:h-7 ud:w-7 ud:place-items-center ud:rounded-sm ud:border ud:border-dashed ud:border-line-strong">
            <ImageOff className="ud:h-3.5 ud:w-3.5 ud:text-subtle" />
          </span>
          {t('无图片（纯色）')}
        </button>
        {images.map((i) => (
          <button
            key={i.id}
            onClick={() => (onChange(`img:${i.id}`), setOpen(false))}
            className={cn(
              'ud:flex ud:h-9 ud:w-full ud:cursor-pointer ud:items-center ud:gap-2 ud:rounded-md ud:px-1.5 ud:text-left ud:text-footnote ud:hover:bg-sel',
              i.id === id && 'ud:bg-accent-soft',
            )}
          >
            <Thumb src={url(i)} className="ud:h-7 ud:w-7" />
            <span className="ud:min-w-0 ud:flex-1 ud:truncate">{i.name}</span>
            <span className="ud:font-mono ud:text-caption ud:text-subtle">
              {i.width}×{i.height}
            </span>
          </button>
        ))}
        {!images.length && (
          <p className="ud:px-2 ud:py-2 ud:text-xs ud:text-subtle">{t('还没有图片：在「图片」里上传或让 AI 生成。')}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** 图片缩略图：透明的地方用灰白方格表示，一眼能看出哪里是透明的 */
export function Thumb({ src, className }: { src?: string; className?: string }) {
  return (
    <span
      className={cn(
        'ud:grid ud:shrink-0 ud:place-items-center ud:overflow-hidden ud:rounded-sm ud:border ud:border-line',
        src
          ? 'ud:bg-[#fff] ud:bg-[length:12px_12px] ud:[background-image:conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)]'
          : 'ud:bg-sel',
        className,
      )}
    >
      {src ? <img src={src} alt="" className="ud:max-h-full ud:max-w-full ud:object-contain" /> : null}
    </span>
  )
}

/** 画刷：图片、绘制方式、尺寸、九宫格边距、颜色 */
export function BrushInput({
  value,
  onChange,
  images,
  url,
}: {
  value: Brush
  onChange: (b: Brush) => void
  images: DesignImage[]
  url: (img: DesignImage) => string | undefined
}) {
  const b = value ?? ({} as Brush)
  const set = (patch: Partial<Brush>) => onChange({ ...b, ...patch })
  const showMargin = b.DrawAs === 'Box' || b.DrawAs === 'Border'
  return (
    <div className="ud:flex ud:w-full ud:flex-col ud:gap-1">
      <div className="ud:flex ud:items-center ud:gap-1">
        <ImagePick
          value={b.ResourceObject}
          images={images}
          url={url}
          onChange={(v) => {
            // 选了图片：尺寸、九宫格跟着图片的设置走
            const img = images.find((i) => `img:${i.id}` === v)
            if (!img) return set({ ResourceObject: v })
            const ns = img.nineSlice
            set({
              ResourceObject: v,
              ImageSize: { X: img.width, Y: img.height },
              // 九宫格图自动按 Box 拉伸：ImageFit 在这里用不上，和切 DrawAs 时一样清掉
              ...(ns ? { DrawAs: 'Box', Margin: ns, ImageFit: undefined } : {}),
            })
          }}
        />
      </div>
      <div className="ud:flex ud:items-center ud:gap-1">
        <span className="ud:w-12 ud:shrink-0 ud:text-caption ud:text-subtle">DrawAs</span>
        <EnumInput
          label="DrawAs"
          value={b.DrawAs ?? 'Image'}
          options={['Image', 'Box', 'Border', 'RoundedBox', 'NoDrawType']}
          onChange={(v) => {
            const next: Brush = { ...b, DrawAs: v as Brush['DrawAs'] }
            // 九宫格、平铺不用 ImageFit，切过去时清掉，免得留下面板上看不到的属性
            if (v !== 'Image') delete next.ImageFit
            onChange(next)
          }}
        />
      </div>
      {/* 旧数据不写 DrawAs，按 Image 算，和上面的下拉显示保持一致 */}
      {(b.DrawAs ?? 'Image') === 'Image' && (
        <div className="ud:flex ud:items-center ud:gap-1">
          <span className="ud:w-12 ud:shrink-0 ud:text-caption ud:text-subtle">Fit</span>
          <EnumInput
            label="ImageFit"
            value={b.ImageFit ?? 'Fill'}
            options={['Fill', 'Contain', 'Cover', 'Original']}
            onChange={(v) => {
              // Fill 就是旧数据的默认行为，不写进属性里，和以前的设计保持一致
              if (v === 'Fill') {
                const { ImageFit: _, ...rest } = b
                onChange(rest)
              } else onChange({ ...b, ImageFit: v as ImageFit })
            }}
          />
        </div>
      )}
      <div className="ud:flex ud:items-center ud:gap-1">
        <span className="ud:w-12 ud:shrink-0 ud:text-caption ud:text-subtle">Size</span>
        <Vec2Input value={b.ImageSize} onChange={(ImageSize) => set({ ImageSize })} />
      </div>
      {showMargin && (
        <div className="ud:flex ud:items-center ud:gap-1">
          <span className="ud:w-12 ud:shrink-0 ud:text-caption ud:text-subtle">Margin</span>
          <MarginInput step={0.05} value={b.Margin} onChange={(Margin) => set({ Margin })} />
        </div>
      )}
      <div className="ud:flex ud:items-center ud:gap-1">
        <span className="ud:w-12 ud:shrink-0 ud:text-caption ud:text-subtle">Tint</span>
        <ColorInput value={b.TintColor} onChange={(TintColor) => set({ TintColor })} />
      </div>
    </div>
  )
}
