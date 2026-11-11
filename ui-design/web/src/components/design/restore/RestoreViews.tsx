import { Eye, Layers, Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { DesignImage } from '@shared/design'
import type { RestoreState } from '@shared/restore/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/**
 * 切图这一步：干净背景、拆件图放最前面，其余按元素顺序；每张标出被几个元素共用，
 * 从原画抠的标和原画的相似度，从拆件图切的标「拆」和对上的分数
 */
export function AssetsView({
  restore,
  images,
  url,
  partsUrl,
  min,
}: {
  restore: RestoreState
  images: DesignImage[]
  url: (img: DesignImage) => string | undefined
  partsUrl?: string
  min: number
}) {
  const list = images.filter((i) => i.id.startsWith('rs_'))
  if (!list.length) return <Empty text={t('还没有切图：确认上一步后自动从原画里抠')} />
  const uses = new Map<string, number>()
  for (const e of restore.elements) if (e.image && !e.hidden) uses.set(e.image, (uses.get(e.image) ?? 0) + 1)
  const elementOf = (id: string) => restore.elements.find((e) => `rs_${e.id}` === id)
  const ordered = [...list.filter((i) => i.id === restore.plate), ...list.filter((i) => i.id !== restore.plate)]
  return (
    <div
      data-restore-assets
      className="ud:grid ud:min-h-0 ud:flex-1 ud:auto-rows-max ud:grid-cols-[repeat(auto-fill,minmax(132px,1fr))] ud:gap-2 ud:overflow-y-auto ud:bg-canvas ud:p-3"
    >
      {partsUrl && (
        <figure
          data-restore-parts
          className="ud:col-span-2 ud:row-span-2 ud:flex ud:flex-col ud:gap-1 ud:rounded-lg ud:bg-canvas-bar ud:p-1.5"
        >
          <div className="ud:grid ud:aspect-square ud:place-items-center ud:overflow-hidden ud:rounded-md ud:bg-canvas-checker">
            <img src={partsUrl} alt={t('拆件图')} className="ud:max-h-full ud:max-w-full ud:object-contain" />
          </div>
          <figcaption
            className="ud:truncate ud:text-caption ud:text-canvas-fg"
            title={t('图片模型照原画把每个元素单独画在透明底上，切图从这里切')}
          >
            {t('拆件图')}
          </figcaption>
        </figure>
      )}
      {ordered.map((img) => {
        const e = elementOf(img.id)
        const sim = e?.sim
        const n = uses.get(img.id) ?? 0
        const plate = img.id === restore.plate
        return (
          <figure
            key={img.id}
            className={cn(
              'ud:flex ud:flex-col ud:gap-1 ud:rounded-lg ud:bg-canvas-bar ud:p-1.5',
              plate && 'ud:col-span-2 ud:row-span-2',
            )}
          >
            <div className="ud:grid ud:aspect-square ud:place-items-center ud:overflow-hidden ud:rounded-md ud:bg-canvas-checker">
              {url(img) && (
                <img src={url(img)} alt={img.name} className="ud:max-h-full ud:max-w-full ud:object-contain" />
              )}
            </div>
            <figcaption className="ud:flex ud:items-center ud:gap-1 ud:text-caption ud:text-canvas-fg">
              <span className="ud:min-w-0 ud:flex-1 ud:truncate">{plate ? t('干净背景') : img.name}</span>
              {img.nineSlice && <span title={t('九宫格：拉伸时边框不变形')}>9</span>}
              {n > 1 && <span title={t('{n} 个元素共用这张', { n })}>×{n}</span>}
              {e?.assetFrom === 'parts' && (
                <span
                  data-from="parts"
                  className="ud:tabular-nums ud:text-canvas-subtle"
                  title={t('从拆件图切的，和原画对上的分数 {s}', { s: (e.partScore ?? 0).toFixed(2) })}
                >
                  {t('拆')} {(e.partScore ?? 0).toFixed(2)}
                </span>
              )}
              {sim !== undefined && (
                <span className={cn('ud:tabular-nums', sim < min ? 'ud:text-warning' : 'ud:text-canvas-subtle')}>
                  {sim.toFixed(2)}
                </span>
              )}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

/** 校验这一步：每个元素和搭出来的控件差多少；没过的排前面，可以「接受差异」 */
export function VerifyView({
  restore,
  onAccept,
  onCompare,
  busy,
}: {
  restore: RestoreState
  onAccept: (element: string, on: boolean) => void
  onCompare: () => void
  busy: boolean
}) {
  const s = restore.score
  if (!s) return <Empty text={t('还没有校验：搭建确认后自动逐个核对')} />
  const byId = new Map(restore.elements.map((e) => [e.id, e]))
  const items = [...s.items].sort((a, b) => Number(a.ok) - Number(b.ok))
  const why = (w: string) =>
    w
      .split(',')
      .filter(Boolean)
      .map(
        (x) =>
          ({ missing: t('控件不见了'), position: t('位置不对'), asset: t('切图不像'), text: t('文字没内容') })[x] ?? x,
      )
      .join('、')
  const n = (v: number) => (Math.abs(v) < 0.05 ? '0' : v > 0 ? `+${v}` : String(v))
  return (
    <div data-restore-verify className="ud:flex ud:min-h-0 ud:flex-1 ud:flex-col ud:overflow-hidden">
      <div className="ud:flex ud:items-center ud:gap-2 ud:border-b ud:px-3 ud:py-2">
        <span className="ud:text-body ud:font-medium">
          {t('{ok}/{all} 个元素对上', { ok: s.posOk, all: s.posTotal })}
        </span>
        <span className="ud:flex-1" />
        <Button size="sm" variant="secondary" onClick={onCompare}>
          <Eye className="ud:h-3.5 ud:w-3.5" />
          {t('在画布上对照原画')}
        </Button>
      </div>
      <div className="ud:min-h-0 ud:flex-1 ud:overflow-y-auto">
        <table className="ud:w-full ud:text-footnote ud:tabular-nums">
          <thead className="ud:sticky ud:top-0 ud:bg-card ud:text-left ud:text-caption ud:text-subtle">
            <tr>
              <th className="ud:px-3 ud:py-1.5 ud:font-normal">{t('元素')}</th>
              <th className="ud:px-1 ud:py-1.5 ud:font-normal">Δx</th>
              <th className="ud:px-1 ud:py-1.5 ud:font-normal">Δy</th>
              <th className="ud:px-1 ud:py-1.5 ud:font-normal">Δw</th>
              <th className="ud:px-1 ud:py-1.5 ud:font-normal">Δh</th>
              <th className="ud:px-1 ud:py-1.5 ud:font-normal">{t('相似度')}</th>
              <th className="ud:px-3 ud:py-1.5 ud:font-normal">{t('结果')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.element} data-check={i.ok ? 'ok' : 'bad'} className="ud:border-t ud:border-line/60">
                <td className="ud:max-w-[200px] ud:truncate ud:px-3 ud:py-1.5">
                  {byId.get(i.element)?.name || i.widget || i.element}
                </td>
                <td className="ud:px-1">{n(i.dx)}</td>
                <td className="ud:px-1">{n(i.dy)}</td>
                <td className="ud:px-1">{n(i.dw)}</td>
                <td className="ud:px-1">{n(i.dh)}</td>
                <td className="ud:px-1">{i.sim?.toFixed(2) ?? '–'}</td>
                <td className="ud:px-3">
                  {i.why ? (
                    <label className="ud:flex ud:items-center ud:gap-1.5">
                      <span className={cn(i.accepted ? 'ud:text-subtle ud:line-through' : 'ud:text-warning')}>
                        {why(i.why)}
                      </span>
                      <Switch
                        checked={!!i.accepted}
                        disabled={busy}
                        onCheckedChange={(on) => onAccept(i.element, on)}
                        aria-label={t('接受差异')}
                      />
                    </label>
                  ) : (
                    <span className="ud:text-success">{t('对上')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** 搭建、交付这两步：结论在右边卡上，这里给去画布的入口 */
export function CanvasHint({ text, onOpen }: { text: string; onOpen: () => void }) {
  return (
    <div className="ud:flex ud:min-h-0 ud:flex-1 ud:flex-col ud:items-center ud:justify-center ud:gap-3 ud:bg-canvas ud:p-6 ud:text-center">
      <Layers className="ud:h-6 ud:w-6 ud:text-canvas-subtle" />
      <p className="ud:max-w-[420px] ud:text-body ud:text-canvas-fg">{text}</p>
      <Button size="sm" onClick={onOpen} data-restore-open-canvas>
        {t('在画布里看')}
      </Button>
    </div>
  )
}

export function Empty({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <div className="ud:flex ud:min-h-0 ud:flex-1 ud:items-center ud:justify-center ud:gap-2 ud:bg-canvas ud:p-6 ud:text-body ud:text-canvas-subtle">
      {busy && <Loader2 className="ud:h-4 ud:w-4 ud:animate-spin" />}
      {text}
    </div>
  )
}
