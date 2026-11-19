import { Box } from 'lucide-react'
import type { Comp } from '../../../CompTree.tsx'
import { t } from '../../../host.ts'
import { assetName } from '../common.tsx'
import { PreviewPane } from '../preview/PreviewPane.tsx'

/**
 * 视口（效果图 A1 / A4 中间）：UE 用缩略图渲染画的 Actor 蓝图（UELink 2.18 asset.preview），拖动转视角、滚轮推拉。
 * 选中的组件写在左上角（和 UE 视口里的选中提示对应），也作为 select 交给 UE（缩略图模式下 UE 只在 note 里说明不画高亮）；
 * UE 没开给「启动编辑器」，UELink 旧没有 asset.preview 时说明要更新（PreviewPane 里），不画假的 3D 画面
 */
export function Viewport({ path, picked }: { path: string; online: boolean; picked?: Comp }) {
  return (
    <PreviewPane
      path={path}
      icon={Box}
      title={
        <>
          {t('视口')}
          <span className="ue:truncate ue:text-footnote ue:font-normal ue:text-subtle">{assetName(path)}</span>
        </>
      }
      select={picked?.name}
      overlay={
        picked && (
          <span className="ue:absolute ue:top-3 ue:left-3 ue:flex ue:max-w-[70%] ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1 ue:text-caption ue:text-subtle">
            {t('已选')}
            <span className="ue:truncate ue:font-medium ue:text-fg">{picked.name}</span>
            <span className="ue:truncate">{picked.class}</span>
          </span>
        )
      }
    />
  )
}
