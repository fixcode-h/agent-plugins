import { Maximize } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { zoomLabel, ZOOM_LEVELS } from './view.ts'

/**
 * 工具栏上的缩放：下拉选档位或「适应屏幕」，旁边「缩放到适合」（Home）和「1:1」两个按钮。
 * 适应屏幕算出来的缩放常不在档位上，这时下拉里多一项当前百分比，免得显示成别的档。
 */
export function ZoomControls({
  k,
  fitted,
  onFit,
  onOne,
  onZoom,
}: {
  k: number
  fitted: boolean
  onFit: () => void
  onOne: () => void
  onZoom: (k: number) => void
}) {
  const { ui } = h()
  const onLevel = ZOOM_LEVELS.some((z) => Math.abs(z.k - k) < 1e-6)
  const value = fitted ? 'fit' : onLevel ? String(k) : 'cur'
  return (
    <>
      <ui.Select
        size="sm"
        aria-label={t('缩放')}
        title={t('缩放（滚轮以光标为中心缩放，右键或中键拖动平移）')}
        className="ue:w-28"
        value={value}
        onChange={(e: { target: { value: string } }) => {
          const v = e.target.value
          if (v === 'fit') onFit()
          else if (v !== 'cur') onZoom(Number(v))
        }}
        options={[
          { value: 'fit', label: t('适应屏幕') },
          ...(value === 'cur' ? [{ value: 'cur', label: zoomLabel(k) }] : []),
          ...ZOOM_LEVELS.map((z) => ({ value: String(z.k), label: z.label })),
        ]}
      />
      <ui.IconButton icon={Maximize} label={t('缩放到适合（Home）')} size="sm" onClick={onFit} />
      <ui.Button size="sm" variant="ghost" title={t('原大（1:1）')} onClick={onOne}>
        1:1
      </ui.Button>
    </>
  )
}
