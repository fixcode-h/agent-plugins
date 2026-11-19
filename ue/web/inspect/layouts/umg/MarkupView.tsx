import { useMemo } from 'react'
import { t } from '../../../host.ts'
import { ForgeMarkupView } from '../../../sections/uekit/forge-markup/ForgeMarkupView.tsx'
import { addUmgView, type UmgViewProps } from './views.ts'

/**
 * UMG 查看页的「标记视图」（设计稿 4.2）：把 AssetForge 配置画成类似 XAML 的标签树，只读。
 * 这里拿到的是配置原文，include 不展开，片段节点按 `{include}` 原样显示；要看展开后的去 AssetForge 页。
 */
function MarkupView({ data }: UmgViewProps) {
  const doc = useMemo(() => {
    try {
      return data.configText ? (JSON.parse(data.configText) as unknown) : undefined
    } catch {
      return undefined
    }
  }, [data.configText])
  if (!doc) return <div className="ue:p-4 ue:text-sm ue:text-muted-foreground">{t('配置读不懂，画不出标记视图：先在「配置原文」把它修好')}</div>
  return (
    <div className="ue:h-full ue:overflow-auto">
      <ForgeMarkupView doc={doc} />
    </div>
  )
}

addUmgView({ id: 'markup', label: () => t('标记视图'), when: ({ data }) => !!data.configText, View: MarkupView }, 'config')
