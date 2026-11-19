import { GitCompareArrows } from 'lucide-react'
import { h, t } from '../host.ts'
import { openAssetDiff } from './store.ts'

/** 资源页头的「版本差异」：点开才读历史，选了哪一版才去算差异 */
export function DiffButton({ asset }: { asset: string }) {
  const { ui } = h()
  return (
    <ui.Button size="sm" variant="ghost" onClick={() => openAssetDiff(asset)} title={t('看这个资源每一版改了什么')}>
      <GitCompareArrows className="ue:h-3.5 ue:w-3.5" />
      {t('版本差异')}
    </ui.Button>
  )
}
