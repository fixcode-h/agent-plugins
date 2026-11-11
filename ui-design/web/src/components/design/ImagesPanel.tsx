import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, ImagePlus, Loader2, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react'
import type { Annotation, AnnotationKind, DesignImage } from '@shared/design'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/input'
import { t } from '@shared/i18n'
import { FieldRow, MarginInput, NumInput, TextInput, Thumb } from './fields'
import { AnnotationLayer, AnnotationToolbar, isMarkTool, type Tool } from './Annotations'
import { AiFixButton } from '@/components/ui/ai-fix'

/** 设计里的一个控件：在哪棵树（空是主界面，否则是子控件名）、id、名字、类型 */
export interface WidgetRef {
  target: string
  id: string
  name: string
  type?: string
}

export const readFile = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(f)
  })

/** 图片列表：设计里用到的所有图片，生成中的转圈，失败的标红 */
export function ImagesPanel({
  images,
  url,
  selected,
  onSelect,
  onUpload,
  onPreview,
  usedIds,
  onGenerateAll,
  canGenerate,
  onDragImage,
}: {
  /** 开始 / 结束把图片拖到画布的控件上：画布据此高亮能放的控件 */
  onDragImage?: (img: DesignImage | null) => void
  /** 生成这些还没生成或失败的图 */
  onGenerateAll: (ids: string[]) => void
  canGenerate: boolean
  images: DesignImage[]
  url: (img: DesignImage) => string | undefined
  selected: string
  onSelect: (id: string) => void
  onUpload: (files: File[]) => void
  /** 双击：在左边的画布区域放大看 */
  onPreview: (id: string) => void
  usedIds: Set<string>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<'all' | 'unused' | 'missing' | 'failed'>('all')
  const busy = (i: DesignImage) => i.status === 'generating' || i.status === 'pending'
  const missing = images.filter((i) => !i.variants.length && !busy(i) && i.prompt.trim())
  const failed = images.filter((i) => i.status === 'failed')
  const unused = images.filter((i) => !usedIds.has(i.id))
  const todo = [...new Set([...missing, ...failed])].filter((i) => !busy(i))
  const filters = [
    { id: 'all' as const, label: t('全部'), n: images.length },
    { id: 'unused' as const, label: t('未用'), n: unused.length },
    { id: 'missing' as const, label: t('未生成'), n: missing.length },
    { id: 'failed' as const, label: t('失败'), n: failed.length },
  ]
  const shown = { all: images, unused, missing, failed }[filter]
  return (
    <div className="ud:flex ud:flex-col ud:gap-2 ud:p-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          onUpload([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        className="ud:w-full ud:justify-center"
        onClick={() => input.current?.click()}
      >
        <Upload className="ud:h-3.5 ud:w-3.5" />
        {t('上传图片')}
      </Button>
      {images.length > 0 && (
        <div className="ud:flex ud:flex-wrap ud:items-center ud:gap-1">
          {filters
            .filter((f) => f.id === 'all' || f.n > 0 || filter === f.id)
            .map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  'ud:h-6 ud:cursor-pointer ud:rounded-md ud:px-2 ud:text-caption',
                  filter === f.id ? 'ud:bg-sel ud:font-medium ud:text-fg' : 'ud:text-subtle ud:hover:text-fg',
                  f.id === 'failed' && f.n > 0 && filter !== f.id && 'ud:text-danger',
                )}
              >
                {f.label} {f.n}
              </button>
            ))}
          {todo.length > 0 && (
            <Button
              variant="link"
              onClick={() => onGenerateAll(todo.map((i) => i.id))}
              disabled={!canGenerate}
              title={t('生成还没生成和失败的图片')}
              className="ud:ml-auto ud:px-1 ud:text-caption"
            >
              <RefreshCw className="ud:h-3 ud:w-3" />
              {t('生成 {n} 张', { n: todo.length })}
            </Button>
          )}
        </div>
      )}
      {!images.length && (
        <p className="ud:px-1 ud:py-4 ud:text-center ud:text-footnote ud:leading-relaxed ud:text-subtle">
          {t('还没有图片。在左边告诉 AI 想要什么界面，它会列出需要的图片并生成。')}
        </p>
      )}
      <div className="ud:grid ud:grid-cols-2 ud:gap-2">
        {shown.map((i) => (
          <button
            key={i.id}
            onClick={() => onSelect(i.id)}
            onDoubleClick={() => url(i) && onPreview(i.id)}
            title={url(i) ? t('双击放大预览，拖到画布的控件上直接用上') : undefined}
            draggable={!!url(i) && !!onDragImage}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'copy'
              e.dataTransfer.setData('application/x-design-image', i.id)
              onDragImage?.(i)
            }}
            onDragEnd={() => onDragImage?.(null)}
            className={cn(
              'ud:group ud:flex ud:cursor-pointer ud:flex-col ud:overflow-hidden ud:rounded-lg ud:bg-field ud:text-left ud:transition-colors',
              selected === i.id ? 'ud:ring-2 ud:ring-accent' : 'ud:hover:bg-sel',
            )}
          >
            <span className="ud:relative ud:block">
              <Thumb src={url(i)} className="ud:aspect-square ud:w-full ud:rounded-none ud:border-0" />
              {(i.status === 'generating' || i.status === 'pending') && (
                <span className="ud:absolute ud:inset-0 ud:grid ud:place-items-center ud:bg-scrim ud:text-white">
                  <Loader2 className={cn('ud:h-5 ud:w-5', i.status === 'generating' && 'ud:animate-spin')} />
                </span>
              )}
              {i.status === 'failed' && (
                <span
                  className="ud:absolute ud:top-1 ud:right-1 ud:rounded-full ud:bg-card ud:p-0.5 ud:text-danger"
                  title={i.error}
                >
                  <AlertCircle className="ud:h-3.5 ud:w-3.5" />
                </span>
              )}
              {i.variants.length > 1 && (
                <span className="ud:absolute ud:bottom-1 ud:left-1 ud:rounded-sm ud:bg-scrim ud:px-1 ud:font-mono ud:text-micro ud:text-white">
                  {i.selected + 1}/{i.variants.length}
                </span>
              )}
            </span>
            <span className="ud:flex ud:items-center ud:gap-1 ud:px-1.5 ud:py-1">
              <span className="ud:min-w-0 ud:flex-1 ud:truncate ud:font-mono ud:text-caption">{i.name}</span>
              {!usedIds.has(i.id) && (
                <span className="ud:shrink-0 ud:text-micro ud:text-subtle" title={t('设计里没有用到这张图')}>
                  {t('未用')}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 选中一张图片时的属性：描述、尺寸、透明、九宫格、生成过的每一版 */
export function ImageDetails({
  image,
  url,
  onChange,
  onGenerate,
  onRefine,
  onUpload,
  onDelete,
  canGenerate,
  sourceLabel,
  marks,
  onPreview,
  users,
  candidates,
  onJump,
  onAssign,
}: {
  /** 用到这张图的控件，点一下跳过去 */
  users: WidgetRef[]
  /** 能放这张图的控件（Image、Border、Button），没用到时可以直接用上 */
  candidates: WidgetRef[]
  onJump: (w: WidgetRef) => void
  onAssign: (w: WidgetRef) => void
  /** 在大图上画的修改标记（列在右边对话框上面，发送时按它重新生成） */
  marks: Annotation[]
  /** 打开大图预览（在图上画标记） */
  onPreview: () => void
  image: DesignImage
  url: (file: string) => string
  onChange: (img: DesignImage, key: string) => void
  onGenerate: () => void
  /** 有模板、写了 ref 的图从模板里抠；精修是照着抠出来的那块重画（和原画不够像时不选用） */
  onRefine?: () => void
  onUpload: (file: File) => void
  onDelete: () => void
  canGenerate: boolean
  sourceLabel: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<DesignImage>, key: string) => onChange({ ...image, ...patch }, `img:${image.id}:${key}`)
  const busy = image.status === 'generating' || image.status === 'pending'
  return (
    <div className="ud:text-footnote">
      <div className="ud:flex ud:items-center ud:gap-2 ud:border-b ud:px-3 ud:py-2">
        <ImagePlus className="ud:h-4 ud:w-4 ud:shrink-0 ud:text-accent-text" />
        <span className="ud:min-w-0 ud:flex-1 ud:truncate ud:font-mono ud:text-footnote ud:font-medium">
          {image.name}
        </span>
        <IconButton icon={Trash2} tone="danger" label={t('删除图片')} onClick={onDelete} />
      </div>
      {image.variants.length > 0 && (
        <div className="ud:flex ud:gap-1.5 ud:overflow-x-auto ud:border-b ud:p-2">
          {image.variants.map((v, i) => (
            <button
              key={v.file}
              onClick={() => set({ selected: i }, 'sel')}
              title={`${v.width}×${v.height} · ${{ cli: t('图片模型'), browser: t('浏览器'), local: t('本机模型'), upload: t('上传'), crop: t('从原画抠的') }[v.source]}${v.score !== undefined && v.source !== 'crop' ? ` · ${t('和原画相似度 {n}', { n: `${Math.round(v.score * 100)}%` })}` : ''}`}
              className={cn(
                'ud:relative ud:shrink-0 ud:cursor-pointer ud:rounded-md ud:border-2 ud:p-px',
                i === image.selected ? 'ud:border-accent' : 'ud:border-transparent ud:hover:border-line-strong',
              )}
            >
              <Thumb src={url(v.file)} className="ud:h-14 ud:w-14" />
              <VariantBadge source={v.source} score={v.score} />
            </button>
          ))}
        </div>
      )}
      <div className="ud:flex ud:flex-wrap ud:items-center ud:gap-1 ud:border-b ud:px-3 ud:py-2">
        {users.length ? (
          <>
            <span className="ud:mr-1 ud:text-caption ud:text-subtle">{t('用在')}</span>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => onJump(u)}
                title={u.target ? t('在子控件 {name} 里', { name: u.target }) : undefined}
                className="ud:cursor-pointer ud:rounded-sm ud:bg-sel/70 ud:px-1.5 ud:py-px ud:font-mono ud:text-caption ud:text-muted ud:hover:bg-sel ud:hover:text-fg"
              >
                {u.target ? `${u.target} › ` : ''}
                {u.name}
              </button>
            ))}
          </>
        ) : (
          <>
            <span className="ud:flex-1 ud:text-caption ud:text-warning">{t('设计里还没用到这张图')}</span>
            {candidates.length > 0 && (
              <Select
                aria-label={t('用到控件上')}
                value=""
                onChange={(e) => {
                  const c = candidates.find((x) => x.id === e.target.value)
                  if (c) onAssign(c)
                }}
                options={[
                  { value: '', label: t('用到控件上…') },
                  ...candidates.map((c) => ({
                    value: c.id,
                    label: `${c.name} · ${c.type}`,
                    group: c.target || t('主界面'),
                  })),
                ]}
                className="ud:h-6 ud:w-auto ud:max-w-[180px] ud:rounded-md ud:px-2 ud:text-caption"
              />
            )}
          </>
        )}
      </div>
      {image.status === 'failed' && image.error && (
        <div className="ud:mx-3 ud:mt-2 ud:flex ud:flex-col ud:items-start ud:gap-1.5 ud:rounded-md ud:bg-danger/10 ud:px-2 ud:py-1.5">
          <p className="ud:text-caption ud:leading-relaxed ud:whitespace-pre-wrap ud:text-danger">{image.error}</p>
          <AiFixButton
            variant="ghost"
            className="ud:h-6 ud:px-1.5 ud:text-caption"
            issue={{
              title: t('生成图片失败：{name}', { name: image.name }),
              error: image.error,
              context:
                '这是 Agent 面板 UI 设计里的生成图片（按设置里「生成图片的方式」调用 Agent、API 或本机 ComfyUI）。',
            }}
          />
        </div>
      )}
      <div className="ud:py-1">
        <FieldRow label={t('名称')}>
          <TextInput label={t('名称')} value={image.name} onChange={(name) => set({ name }, 'name')} />
        </FieldRow>
        <FieldRow label={t('尺寸')}>
          <NumInput prefix="W" min={1} value={image.width} onChange={(width) => set({ width }, 'w')} />
          <NumInput prefix="H" min={1} value={image.height} onChange={(height) => set({ height }, 'h')} />
        </FieldRow>
        <FieldRow label={t('透明背景')}>
          <Switch
            aria-label={t('透明背景')}
            checked={image.transparent}
            onCheckedChange={(v) => set({ transparent: v }, 'tr')}
          />
        </FieldRow>
        <FieldRow label={t('九宫格')} title={t('需要拉伸的框和底图打开，边距是图片尺寸的比例')}>
          <Switch
            aria-label={t('九宫格')}
            checked={!!image.nineSlice}
            onCheckedChange={(v) =>
              set({ nineSlice: v ? { Left: 0.25, Top: 0.25, Right: 0.25, Bottom: 0.25 } : undefined }, 'ns')
            }
          />
        </FieldRow>
        {image.nineSlice && (
          <FieldRow label="Margin">
            <MarginInput step={0.05} value={image.nineSlice} onChange={(nineSlice) => set({ nineSlice }, 'nsm')} />
          </FieldRow>
        )}
        <div className="ud:px-3 ud:pt-1.5">
          <p className="ud:mb-1 ud:text-footnote ud:text-subtle">{t('描述（生成用）')}</p>
          <TextInput
            label={t('描述')}
            multiline
            value={image.prompt}
            onChange={(prompt) => set({ prompt }, 'prompt')}
          />
        </div>
        {image.variants.length > 0 && (
          <p className="ud:px-3 ud:pt-2 ud:text-caption ud:leading-relaxed ud:text-subtle">
            {marks.length ? t('图上有 {n} 处标记，', { n: marks.length }) : ''}
            <Button variant="link" onClick={onPreview} className="ud:inline">
              {t('在大图上标记要改的地方')}
            </Button>
            {t('，修改意见写在右边的对话框里发送')}
          </p>
        )}
        {onRefine && (
          <p className="ud:px-3 ud:pt-2 ud:text-caption ud:leading-relaxed ud:text-subtle">
            {t(
              '这张从确认的原画里按位置抠出来，和原画一模一样。精修会照着它重画得更干净，和原画不够像（低于设置里的门槛）时不选用。',
            )}
          </p>
        )}
        <div className="ud:flex ud:flex-wrap ud:gap-1.5 ud:px-3 ud:pt-2 ud:pb-3">
          {onRefine && image.variants.length > 0 ? (
            <Button size="sm" onClick={onRefine} disabled={!canGenerate || busy} title={sourceLabel}>
              {busy ? (
                <Loader2 className="ud:h-3.5 ud:w-3.5 ud:animate-spin" />
              ) : (
                <Sparkles className="ud:h-3.5 ud:w-3.5" />
              )}
              {t('精修')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onGenerate}
              disabled={!canGenerate || busy || (!onRefine && !image.prompt.trim())}
              title={sourceLabel}
            >
              {busy ? (
                <Loader2 className="ud:h-3.5 ud:w-3.5 ud:animate-spin" />
              ) : (
                <RefreshCw className="ud:h-3.5 ud:w-3.5" />
              )}
              {onRefine
                ? t('从原画抠')
                : marks.length
                  ? t('按标记重新生成')
                  : image.variants.length
                    ? t('再生成')
                    : t('生成')}
            </Button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onUpload(f)
              e.target.value = ''
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
            <Upload className="ud:h-3.5 ud:w-3.5" />
            {t('上传替换')}
          </Button>
        </div>
        {canGenerate && <p className="ud:px-3 ud:pb-3 ud:text-caption ud:text-subtle">{sourceLabel}</p>}
      </div>
    </div>
  )
}

/** 每一版缩略图角上的小标：从原画抠的、精修的相似度（低于门槛的标黄由服务端选回抠的那版） */
function VariantBadge({ source, score }: { source: string; score?: number }) {
  if (source === 'crop')
    return (
      <span className="ud:absolute ud:right-0.5 ud:bottom-0.5 ud:rounded-sm ud:bg-black/60 ud:px-1 ud:text-micro ud:leading-4 ud:text-white">
        {t('原画')}
      </span>
    )
  if (score === undefined) return null
  return (
    <span className="ud:absolute ud:right-0.5 ud:bottom-0.5 ud:rounded-sm ud:bg-black/60 ud:px-1 ud:text-micro ud:leading-4 ud:text-white ud:tabular-nums">
      {Math.round(score * 100)}%
    </span>
  )
}

/** 透明的地方用灰白方格表示（和 Photoshop、UE 的贴图预览一样） */
export const CHECKER =
  'ud:bg-[#fff] ud:bg-[length:16px_16px] ud:[background-image:conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)]'

/** 盖在画布区域上的大图预览：可以在图上画修改标记（列在右边对话框上面，写好意见发送就按它重新生成）；点空白处、关闭按钮或按 Esc 关掉 */
export function ImagePreview({
  image,
  src,
  marks,
  onMarks,
  onClose,
}: {
  image: DesignImage
  src: string
  /** 图上的修改标记，坐标是这一版图片的像素 */
  marks: Annotation[]
  onMarks: (list: Annotation[]) => void
  onClose: () => void
}) {
  const [tool, setTool] = useState<Tool>('select')
  const [kind, setKind] = useState<AnnotationKind>('change')
  const [active, setActive] = useState('')
  const [shown, setShown] = useState(true)
  const img = useRef<HTMLImageElement>(null)
  const [scale, setScale] = useState(0)
  const v = image.variants[image.selected] ?? image.variants.at(-1)
  const size = { X: v?.width || image.width, Y: v?.height || image.height }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key !== 'Escape') return
      // 先退出标注工具、关掉正在写的说明，再按一次才关掉预览
      if (active) setActive('')
      else if (tool !== 'select') setTool('select')
      else onClose()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose, tool, active])
  useLayoutEffect(() => {
    const el = img.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / size.X)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size.X, src])
  return (
    <div
      role="dialog"
      aria-label={image.name}
      onClick={(e) => e.target === e.currentTarget && tool === 'select' && !active && onClose()}
      className="ud:absolute ud:inset-0 ud:z-30 ud:flex ud:flex-col ud:bg-canvas/95 ud:animate-[fade-in_120ms_ease-out]"
    >
      <div className="ud:flex ud:h-11 ud:shrink-0 ud:items-center ud:gap-2 ud:pr-3 ud:pl-[max(0.75rem,var(--board-switch-w,0px))] ud:text-footnote ud:text-canvas-fg">
        <span className="ud:font-mono ud:font-medium ud:text-canvas-strong">{image.name}</span>
        <span className="ud:font-mono ud:text-canvas-subtle">
          {size.X}×{size.Y}
          {image.variants.length > 1 && ` · ${image.selected + 1}/${image.variants.length}`}
        </span>
        <span className="ud:flex-1" />
        <Button variant="on-canvas" size="icon-sm" onClick={onClose} aria-label={t('关闭预览')} title={t('关闭预览')}>
          <X className="ud:h-4 ud:w-4" />
        </Button>
      </div>
      <div className="ud:flex ud:shrink-0 ud:justify-center ud:px-3 ud:pb-2">
        <AnnotationToolbar
          tools={['select', 'rect', 'arrow', 'pen', 'pin']}
          tool={tool}
          onTool={(x) => {
            setTool(x)
            if (isMarkTool(x)) setShown(true)
          }}
          kind={kind}
          onKind={(k) => {
            setKind(k)
            if (!isMarkTool(tool)) setTool('rect')
          }}
          count={marks.length}
          visible={shown}
          onToggleVisible={() => setShown((x) => !x)}
          onClear={() => {
            onMarks([])
            setActive('')
          }}
        />
      </div>
      <div
        className="ud:grid ud:min-h-0 ud:flex-1 ud:place-items-center ud:overflow-hidden ud:p-6"
        onClick={(e) => e.target === e.currentTarget && tool === 'select' && !active && onClose()}
      >
        <div className="ud:relative ud:max-h-full ud:max-w-full">
          <img
            ref={img}
            src={src}
            alt={image.name}
            draggable={false}
            className={cn(
              'ud:block ud:max-h-[calc(100dvh-220px)] ud:max-w-full ud:object-contain ud:shadow-canvas',
              CHECKER,
            )}
          />
          {scale > 0 && (
            <AnnotationLayer
              size={size}
              scale={scale}
              tool={tool}
              kind={kind}
              list={marks}
              visible={shown}
              active={active}
              onActive={setActive}
              onCreate={(a) => {
                const mark: Annotation = { ...a, id: crypto.randomUUID(), note: '', target: '', widgets: [] }
                onMarks([...marks, mark])
                // 画完马上写说明
                setActive(mark.id)
              }}
              onChange={(a) => onMarks(marks.map((x) => (x.id === a.id ? a : x)))}
              onRemove={(id) => {
                onMarks(marks.filter((x) => x.id !== id))
                setActive('')
              }}
            />
          )}
        </div>
      </div>
      {!marks.length && (
        <p className="ud:pointer-events-none ud:shrink-0 ud:pb-3 ud:text-center ud:text-caption ud:text-canvas-subtle">
          {t('选上面的框选、箭头、画笔或打点，在图上标出要改的地方，再在右边的对话框里写修改意见发送')}
        </p>
      )}
    </div>
  )
}
