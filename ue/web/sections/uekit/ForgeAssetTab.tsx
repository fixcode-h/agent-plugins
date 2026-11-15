import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { Props } from '../../Props.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { assetObjectPath } from './ForgeLink.tsx'
import { Hint } from './forge-parts.tsx'

/**
 * 「资源」页签（默认页签）：设计稿 §2.2 第 3 条要求原样复用资源页右侧那一块（组件 / 控件树 + 属性面板），
 * 用户原话「这个 json 也可以认为是一个蓝图资源」。
 * 那个共用组件 ue/web/inspect/AssetView.tsx 还在「合并 Actor 与 Object 页」那条线开发，这里先用现有的 Props
 * 属性面板过渡（只看不改：配置是真源）。
 * TODO：AssetView 推 dev 后换成它，并加 marks 差异标注（数据来自 forge.diff，按节点分组）；资源没生成时按配置节点树预览。
 */
export function ForgeAssetTab({ entry }: { entry: ForgeEntry }) {
  const { go } = useUe()
  const absent = entry.state === 'never-imported' || entry.state === 'asset-missing'
  const path = assetObjectPath(entry.asset)
  if (!path) return <Hint>{t('配置里没写目标资产，修好配置后才知道会生成哪个资源')}</Hint>
  if (absent) return <Hint>{t('资源还没生成，导入后在这里看')}</Hint>
  if (['parse-error', 'foreign'].includes(entry.state))
    return <Hint>{t('配置读不出来，先看「配置原文」把它修好')}</Hint>
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <Props
        key={path}
        path={path}
        viewOnly
        readOnlyHint={t('这里只读：配置是真源，要改请用编辑器打开配置，或在资源页改完再「导出到配置」')}
        onOpen={(p) => go('assets', p)}
      />
    </div>
  )
}
