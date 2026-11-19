import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { PropMarksCtx } from '../../../details/marks.ts'
import { h, t } from '../../../host.ts'
import { Props } from '../../../Props.tsx'
import { Card } from '../../../ui.tsx'
import type { LayoutProps } from '../types.ts'
import { shortName } from './model.ts'

/**
 * 预览类布局的右栏细节（效果图 B2–B10 右边）：真实细节面板（Props，能改，和资源页一样）。
 * sub 是左栏选中的子对象（材质节点、发射器）：看它的细节，标题旁边「← 资源本身」回去；
 * AssetForge 的导入标注只标在资源本身上。top 放在细节上面（贴图的尺寸格式、统计）
 */
export function DetailsCard({
  path,
  sub,
  subLabel,
  onBack,
  onOpen,
  hint,
  marks,
  top,
  title,
}: Pick<LayoutProps, 'path' | 'onOpen' | 'hint' | 'marks'> & {
  sub?: string
  subLabel?: string
  onBack?: () => void
  top?: ReactNode
  title?: string
}) {
  const { ui } = h()
  const target = sub || path
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <SlidersHorizontal className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {title ?? t('细节')}
        </>
      }
      aside={
        sub && (
          <>
            <span className="ue:truncate">{subLabel ?? shortName(sub)}</span>
            {onBack && (
              <ui.Button size="sm" variant="ghost" onClick={onBack}>
                <ArrowLeft className="ue:h-3.5 ue:w-3.5" /> {t('资源本身')}
              </ui.Button>
            )}
          </>
        )
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      {top}
      <PropMarksCtx.Provider value={sub ? null : (marks ?? null)}>
        <Props key={target} path={target} bar onOpen={onOpen} readOnlyHint={hint} />
      </PropMarksCtx.Provider>
    </Card>
  )
}
