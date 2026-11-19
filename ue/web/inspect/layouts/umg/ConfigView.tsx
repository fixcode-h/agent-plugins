import { h, t } from '../../../host.ts'
import type { UmgViewProps } from './views.ts'

/**
 * 「配置原文」（效果图 U3）：有 AssetForge 配置就显示配置原文（动画在 animations 段里），没有就显示 UE 回的设计时控件树（JSON），只读。
 * 要改走 AssetForge 页的「配置原文」或用编辑器打开；资源文件夹、分段显示由 AssetForge 那边做，这里只看
 */
export function ConfigView({ data }: UmgViewProps) {
  const { ui } = h()
  const text =
    data.configText ?? (data.tree ? JSON.stringify(data.tree, (k, v) => (k === 'key' ? undefined : v), 2) : '')
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-1 ue:bg-card ue:p-3">
      <span className="ue:text-caption ue:text-subtle">
        {data.configText
          ? t('AssetForge 配置原文（只读）：要改去 AssetForge 页编辑，或改完资源后「导出到配置」')
          : t('这个资源没有 AssetForge 配置：下面是 UE 回的控件树（只读）')}
      </span>
      {text ? (
        <ui.Textarea
          readOnly
          spellCheck={false}
          aria-label={t('配置原文')}
          className="ue:min-h-0 ue:flex-1 ue:resize-none ue:font-mono ue:text-footnote"
          value={text}
        />
      ) : (
        <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('没有配置原文')}</p>
      )}
    </div>
  )
}
