import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BadgeCheck, Check, ImagePlus, Loader2, Send, Trash2, Undo2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import {
  hasMask,
  maskBox,
  sendsMaskOnly,
  type Annotation,
  type AnnotationKind,
  type ConceptImage,
  type ConceptJob,
  type ConceptState,
  type DesignLayout,
} from '@shared/design'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { t } from '@shared/i18n'
import { AnnotationLayer, AnnotationToolbar, isMarkTool, type Tool } from './Annotations'
import { RegionEditor } from './RegionEditor'
import { readFile } from './ImagesPanel'

/**
 * 原画面板：占满左边的画布区域。上面是标注工具和操作，中间是正在看的那张（可以在上面标出要改的地方），
 * 下面按轮次列出所有候选。确认一张作为模板后，AI 照着它搭界面、出切图
 */
export function ConceptBoard({
  concept,
  url,
  marks,
  onMarks,
  onSelect,
  onApprove,
  onRemove,
  onUpload,
  onSendMarks,
  /** 这次发送会走「只重绘蒙版区域」：只发蒙版这一块，其余标注会留在图上 */
  inpaint,
  /** 当前生成方式支持局部重绘（只有本机 ComfyUI）：不支持时勾了也只整张重画，按钮不能写成「按蒙版重绘」 */
  inpaintSupported,
  progress,
  busy,
  layout,
  designSize,
  onLayout,
  onConfirmLayout,
  onSkipLayout,
}: {
  concept: ConceptState
  /** 原画的图片地址 */
  url: (c: ConceptImage) => string
  /** 全部原画上的标注（target 是 concept:<id>） */
  marks: Annotation[]
  /** 换掉某张原画上的标注 */
  onMarks: (id: string, list: Annotation[]) => void
  onSelect: (id: string) => void
  /** 确认作为模板；空字符串是取消确认 */
  onApprove: (id: string) => void
  onRemove: (id: string) => void
  onUpload: (data: string) => void
  /** 把这张图上的标注直接发给 AI（不用再到对话框里手动点发送） */
  onSendMarks?: () => void
  /** 对话侧勾选了「只重绘蒙版区域」：这次只发蒙版那一块 */
  inpaint?: boolean
  /** 当前生图方式能不能真做局部重绘；不能时按钮文案不改成「按蒙版重绘」 */
  inpaintSupported?: boolean
  /** 正在出原画的进度 */
  progress?: ConceptJob
  /** AI 正在处理：不能确认模板 */
  busy?: boolean
  /** 版式拆解的区块（确认模板后 AI 先拆区块，用户在这里调整、确认） */
  layout?: DesignLayout
  designSize: { X: number; Y: number }
  onLayout?: (layout: DesignLayout, key: string) => void
  /** 确认区块，开始照区块搭界面 */
  onConfirmLayout?: () => void
  /** 不拆区块，直接搭界面 */
  onSkipLayout?: () => void
}) {
  const [tool, setTool] = useState<Tool>('select')
  const [kind, setKind] = useState<AnnotationKind>('change')
  const [active, setActive] = useState('')
  const [shown, setShown] = useState(true)
  const [brush, setBrush] = useState(48)
  const [erase, setErase] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [scale, setScale] = useState(0)
  const [activeRegion, setActiveRegion] = useState('')
  const cur = concept.images.find((i) => i.id === concept.selected) ?? concept.images.at(-1)
  const size = { X: cur?.width || 1, Y: cur?.height || 1 }
  const target = cur ? `concept:${cur.id}` : ''
  // 正在看的就是确认的模板：显示它的区块（只认这张模板拆出来的）
  const isTemplate = !!cur && concept.approved === cur.id
  const regions = isTemplate && layout?.concept === cur.id ? layout : undefined
  // 拆出区块、等用户调整时切回「选择」：标注工具开着时区块拖不动，用户会以为坏了
  const editingRegions = !!regions && !regions.confirmed
  useEffect(() => {
    if (editingRegions) setTool('select')
  }, [editingRegions])
  const mine = marks.filter((m) => m.target === target)
  // 一张原画只有一个蒙版：后续的涂抹和橡皮擦都并到这一条里，撤销就是去掉最后一笔
  const maskMark = mine.find((m) => m.shape === 'mask')
  const canUndoMask = !!maskMark && hasMask(maskMark)
  const undoMask = () => {
    if (!cur || !maskMark) return
    const strokes = maskMark.strokes.slice(0, -1)
    if (!strokes.some((s) => !s.erase)) {
      onMarks(
        cur.id,
        mine.filter((m) => m.id !== maskMark.id),
      )
      setActive('')
      return
    }
    const b = maskBox(strokes)
    onMarks(
      cur.id,
      mine.map((m) => (m.id === maskMark.id ? { ...m, strokes, points: [b.x, b.y, b.w, b.h] } : m)),
    )
  }
  useLayoutEffect(() => {
    const el = img.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / size.X)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size.X, cur?.id])
  // 还在出的几张：在列表最后放占位
  const pending = progress ? Math.max(0, progress.want - progress.got) : 0
  const rounds = [...new Set(concept.images.map((i) => i.round))]
  const approved = !!cur && concept.approved === cur.id
  // 三个条件用 shared 的同一个函数判：勾了、生图方式真能局部重绘、真有蒙版（测试里也是这份口径）
  const maskOnly = sendsMaskOnly({ inpaint: !!inpaint, inpaintSupported: !!inpaintSupported, marks: mine })

  return (
    <div
      data-concept-board
      className="ud:absolute ud:inset-0 ud:z-20 ud:flex ud:flex-col ud:bg-canvas ud:text-canvas-fg"
    >
      {/* 左边让出浮在上面的「画板 / 数据」切换（--board-switch-w 由 DesignPage 量好） */}
      <div className="ud:flex ud:h-11 ud:shrink-0 ud:items-center ud:gap-2 ud:pr-3 ud:pl-[max(0.75rem,var(--board-switch-w,0px))] ud:text-footnote">
        <span className="ud:shrink-0 ud:font-medium ud:whitespace-nowrap ud:text-canvas-strong">{t('原画')}</span>
        {cur && (
          <span className="ud:min-w-0 ud:truncate ud:font-mono ud:text-canvas-subtle">
            {cur.id} · {cur.width}×{cur.height}
          </span>
        )}
        {concept.approved && (
          <span className="ud:inline-flex ud:items-center ud:gap-1 ud:rounded-md ud:bg-success/20 ud:px-1.5 ud:py-0.5 ud:text-caption ud:text-success">
            <BadgeCheck className="ud:h-3.5 ud:w-3.5" />
            {t('已确认模板：{id}', { id: concept.approved })}
          </span>
        )}
        <span className="ud:flex-1" />
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="ud:hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onUpload(await readFile(f))
          }}
        />
        <Button variant="on-canvas" size="sm" onClick={() => file.current?.click()} title={t('上传自己画的效果图')}>
          <ImagePlus className="ud:h-3.5 ud:w-3.5" />
          {t('上传')}
        </Button>
        {cur && (
          <Button
            variant="on-canvas"
            size="icon-sm"
            onClick={() => onRemove(cur.id)}
            aria-label={t('删除这张原画')}
            title={t('删除这张原画')}
          >
            <Trash2 className="ud:h-3.5 ud:w-3.5" />
          </Button>
        )}
        {cur &&
          (approved ? (
            <Button variant="on-canvas" size="sm" onClick={() => onApprove('')} disabled={busy}>
              <Undo2 className="ud:h-3.5 ud:w-3.5" />
              {t('取消模板')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                if (mine.length) toast(t('这张图上还有没发出去的标注，确认模板后标注会被清掉'))
                onApprove(cur.id)
              }}
              disabled={busy}
              title={t('确认用这张作为最终效果，AI 会照着它搭界面、出切图')}
            >
              <Check className="ud:h-3.5 ud:w-3.5" />
              {t('用这张做模板')}
            </Button>
          ))}
      </div>
      {cur && (
        <div className="ud:flex ud:shrink-0 ud:items-start ud:justify-center ud:px-3 ud:pb-2">
          <AnnotationToolbar
            tools={['select', 'rect', 'arrow', 'pen', 'pin', 'mask']}
            labels
            tool={tool}
            onTool={(x) => {
              setTool(x)
              if (isMarkTool(x)) setShown(true)
              if (x !== 'mask') setErase(false)
            }}
            kind={kind}
            onKind={(k) => {
              setKind(k)
              if (!isMarkTool(tool)) setTool('rect')
            }}
            count={mine.length}
            visible={shown}
            onToggleVisible={() => setShown((x) => !x)}
            onClear={() => {
              onMarks(cur.id, [])
              setActive('')
            }}
            mask={{
              size: brush,
              erase,
              canUndo: canUndoMask,
              onSize: setBrush,
              onErase: setErase,
              onUndo: undoMask,
            }}
          />
        </div>
      )}
      {/* 图片按这块区域的实际大小缩放（container 查询单位）：以前按整个窗口高度减固定值算，
          动画面板、区块提示行一多图片下半截就被裁掉 */}
      <div className="ud:grid ud:min-h-0 ud:flex-1 ud:place-items-center ud:overflow-hidden ud:p-4 ud:[container-type:size]">
        {cur ? (
          <div className="ud:relative ud:max-h-full ud:max-w-full">
            <img
              ref={img}
              src={url(cur)}
              alt={cur.id}
              draggable={false}
              className="ud:block ud:max-h-[calc(100cqh-2rem)] ud:max-w-[calc(100cqw-2rem)] ud:object-contain ud:shadow-canvas"
            />
            {scale > 0 && isTemplate && regions && (
              <RegionEditor
                regions={regions.regions}
                // 区块是设计稿像素：屏幕上的一个设计稿像素 = 原画像素的缩放 × 原画宽 / 设计稿宽
                k={(scale * size.X) / designSize.X}
                designSize={designSize}
                editable={!regions.confirmed && tool === 'select' && !busy}
                active={activeRegion}
                onActive={setActiveRegion}
                onChange={(list, key) => onLayout?.({ ...regions, regions: list }, key)}
              />
            )}
            {scale > 0 && (
              <AnnotationLayer
                size={size}
                scale={scale}
                tool={tool}
                kind={kind}
                list={mine}
                visible={shown}
                active={active}
                brush={brush}
                erase={erase}
                onActive={setActive}
                onCreate={(a) => {
                  // 蒙版：并进同一张图上已有的蒙版，外框按所有涂抹笔画重算
                  if (a.shape === 'mask') {
                    const strokes = [...(maskMark?.strokes ?? []), ...a.strokes]
                    const b = maskBox(strokes)
                    const mark: Annotation = maskMark
                      ? { ...maskMark, strokes, points: [b.x, b.y, b.w, b.h] }
                      : {
                          ...a,
                          id: crypto.randomUUID(),
                          note: '',
                          target,
                          widgets: [cur.id],
                          strokes,
                          points: [b.x, b.y, b.w, b.h],
                        }
                    onMarks(cur.id, maskMark ? mine.map((m) => (m.id === maskMark.id ? mark : m)) : [...mine, mark])
                    setActive(mark.id)
                    return
                  }
                  const mark: Annotation = {
                    ...a,
                    id: crypto.randomUUID(),
                    note: '',
                    target,
                    widgets: [cur.id],
                    strokes: [],
                  }
                  onMarks(cur.id, [...mine, mark])
                  setActive(mark.id)
                }}
                onChange={(a) =>
                  onMarks(
                    cur.id,
                    mine.map((x) => (x.id === a.id ? a : x)),
                  )
                }
                onRemove={(id) => {
                  onMarks(
                    cur.id,
                    mine.filter((x) => x.id !== id),
                  )
                  setActive('')
                }}
              />
            )}
          </div>
        ) : (
          <div className="ud:flex ud:flex-col ud:items-center ud:gap-2 ud:text-footnote ud:text-canvas-subtle">
            <Loader2 className="ud:h-5 ud:w-5 ud:animate-spin" />
            {progress?.text ?? t('正在出原画…')}
          </div>
        )}
      </div>
      {/* 确认了模板：先拆区块，用户在图上调整好再开始搭界面（位置照区块来，不靠 AI 目测） */}
      {isTemplate && (
        <div
          className="ud:flex ud:flex-wrap ud:items-center ud:justify-center ud:gap-x-2 ud:gap-y-1 ud:px-3 ud:pb-1"
          data-layout-bar
        >
          <p className="ud:text-center ud:text-caption ud:text-canvas-subtle">
            {regions?.confirmed
              ? t('区块已确认：搭界面时骨架照这些区块摆放')
              : regions
                ? t('调整区块：拖动移动，拖右下角改大小，点一下改名或删除；没问题就确认')
                : busy
                  ? t('AI 正在把模板拆成区块…')
                  : t('先把模板拆成区块再搭界面，位置更准；也可以跳过')}
          </p>
          {regions && !regions.confirmed && (
            <Button
              size="sm"
              variant="on-canvas"
              disabled={busy}
              onClick={() => {
                const id = crypto.randomUUID()
                const w = Math.round(designSize.X / 4)
                const h = Math.round(designSize.Y / 4)
                onLayout?.(
                  {
                    ...regions,
                    regions: [
                      ...regions.regions,
                      {
                        id,
                        name: `Region${regions.regions.length + 1}`,
                        x: Math.round((designSize.X - w) / 2),
                        y: Math.round((designSize.Y - h) / 2),
                        w,
                        h,
                        note: '',
                      },
                    ],
                  },
                  `layout:add:${id}`,
                )
                setActiveRegion(id)
              }}
            >
              {t('新增区块')}
            </Button>
          )}
          {regions && !regions.confirmed && (
            <Button size="sm" disabled={busy || !regions.regions.length} onClick={onConfirmLayout}>
              {t('确认区块，开始搭界面')}
            </Button>
          )}
          {regions?.confirmed && (
            <Button
              size="sm"
              variant="on-canvas"
              disabled={busy}
              onClick={() => onLayout?.({ ...regions, confirmed: false }, 'layout:reopen')}
            >
              {t('重新调整区块')}
            </Button>
          )}
          {!regions && !busy && onSkipLayout && (
            <Button size="sm" variant="on-canvas" onClick={onSkipLayout}>
              {t('跳过，直接搭界面')}
            </Button>
          )}
        </div>
      )}
      {/* 标注完直接在这里发（在底部提示行右侧）：用户不一定知道要去右边对话框点发送 */}
      <div className="ud:flex ud:flex-wrap ud:items-center ud:justify-center ud:gap-x-2 ud:gap-y-1 ud:px-3 ud:pb-1">
        <p className="ud:text-center ud:text-caption ud:text-canvas-subtle">
          {tool === 'mask'
            ? canUndoMask
              ? t('涂出要重绘的区域；在右边勾选「只重绘蒙版区域」再发送，就是局部重绘')
              : t('用笔刷涂出要重绘的区域，涂错了用橡皮擦或撤销')
            : t('标注 → 发送给 AI → 出一张改过的原画，可以接着标；满意了点「用这张做模板」')}
        </p>
        {mine.length > 0 && onSendMarks && (
          <Button
            size="sm"
            onClick={onSendMarks}
            disabled={busy}
            title={
              maskOnly
                ? t('对话侧勾了「只重绘蒙版区域」：只把蒙版这一块发给 AI，其余标注会留在图上')
                : t('把这张图上的 {n} 处标注发给 AI，让它按标注改这张原画', { n: mine.length })
            }
          >
            <Send className="ud:h-3.5 ud:w-3.5" />
            {maskOnly ? t('按蒙版重绘（1）') : t('发送标注给 AI（{n}）', { n: mine.length })}
          </Button>
        )}
      </div>
      <div className="ud:flex ud:shrink-0 ud:gap-3 ud:overflow-x-auto ud:bg-canvas-bar/60 ud:px-3 ud:py-2.5">
        {rounds.map((r) => (
          <div key={r} className="ud:flex ud:shrink-0 ud:flex-col ud:gap-1">
            <span className="ud:text-caption ud:text-canvas-subtle">{t('第 {n} 轮', { n: r })}</span>
            <div className="ud:flex ud:gap-1.5">
              {concept.images
                .filter((i) => i.round === r)
                .map((i) => (
                  <button
                    key={i.id}
                    onClick={() => onSelect(i.id)}
                    title={i.prompt || i.id}
                    aria-label={i.id}
                    aria-pressed={i.id === cur?.id}
                    className={cn(
                      'ud:relative ud:h-16 ud:shrink-0 ud:cursor-pointer ud:overflow-hidden ud:rounded-md ud:ring-canvas-subtle ud:hover:ring-1',
                      i.id === cur?.id && 'ud:ring-2 ud:ring-accent ud:hover:ring-accent',
                    )}
                    style={{ aspectRatio: `${i.width || 16} / ${i.height || 9}` }}
                  >
                    <img src={url(i)} alt="" className="ud:h-full ud:w-full ud:object-cover" draggable={false} />
                    {concept.approved === i.id && (
                      <BadgeCheck className="ud:absolute ud:top-1 ud:right-1 ud:h-4 ud:w-4 ud:rounded-full ud:bg-canvas/70 ud:text-success" />
                    )}
                    {marks.some((m) => m.target === `concept:${i.id}`) && (
                      <span className="ud:absolute ud:bottom-1 ud:left-1 ud:h-2 ud:w-2 ud:rounded-full ud:bg-warning" />
                    )}
                  </button>
                ))}
            </div>
          </div>
        ))}
        {pending > 0 && (
          <div className="ud:flex ud:shrink-0 ud:flex-col ud:gap-1">
            <span className="ud:text-caption ud:text-canvas-subtle">{t('正在出')}</span>
            <div className="ud:flex ud:gap-1.5">
              {Array.from({ length: pending }, (_, k) => (
                <span
                  key={k}
                  className="ud:grid ud:h-16 ud:w-28 ud:place-items-center ud:rounded-md ud:bg-canvas-hover"
                  title={progress?.text}
                >
                  <Loader2 className="ud:h-4 ud:w-4 ud:animate-spin ud:text-canvas-subtle" />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
