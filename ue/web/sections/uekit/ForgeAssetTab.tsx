import { GitCompare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { AssetView } from '../../inspect/AssetView.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { ForgeConfigPreview } from './ForgeConfigPreview.tsx'
import type { ForgeDiffData } from './ForgeDiff.tsx'
import { assetObjectPath } from './ForgeLink.tsx'
import { Hint } from './forge-parts.tsx'

/**
 * 「资源」页签（默认页签，设计稿 §2.2 第 3、4 条，用户原话「这个 json 也可以认为是一个蓝图资源」）：
 * - 资源已经生成：原样复用资源页的检视 AssetView（组件树 + 类默认值 / 属性 / 表格、蓝图、摘要与引用），
 *   并把 forge.diff 里导入会改的顶层属性标在属性面板上（marks）；
 * - 资源还没生成：按配置本身的节点树画一份只读预览（ForgeConfigPreview），导入后换成真实资源。
 * 这里只读：配置是真源，要改就用编辑器打开配置，或在资源页改完「导出到配置」。
 */
export function ForgeAssetTab({
  entry,
  diff,
  configText,
  configTruncated,
  configLoading,
  configError,
  onShowDiff,
}: {
  entry: ForgeEntry
  /** 「和资产比」的属性差异；和上次提交的配置比的那份不用来标注（那是配置之间的差别，不是导入会改资源的） */
  diff?: ForgeDiffData
  configText?: string
  configTruncated?: boolean
  configLoading?: boolean
  configError?: string
  onShowDiff: () => void
}) {
  const { go } = useUe()
  const { cn } = h()
  const [comp, setComp] = useState('')
  const [showMarks, setShowMarks] = useState(true)
  const path = assetObjectPath(entry.asset)
  const marks = useMemo(() => {
    if (!diff?.supported || !diff.changes.length) return undefined
    // forge.diff 的属性名是顶层 UE 属性名（个别版本带 props. 前缀，去掉）
    return new Map(diff.changes.map((c) => [c.property.replace(/^props\./, ''), c.after] as const))
  }, [diff])
  const absent = entry.state === 'never-imported' || entry.state === 'asset-missing'

  if (['parse-error', 'foreign'].includes(entry.state))
    return <Hint>{t('配置读不出来，先看「配置原文」把它修好')}</Hint>
  if (!path || absent)
    return (
      <ForgeConfigPreview
        text={configText}
        truncated={configTruncated}
        loading={configLoading}
        error={configError}
        note={
          path
            ? t('资源还没生成，下面是按配置画出来的结构和属性（只读），导入后换成 UE 里的真实资源')
            : t('配置里没写目标资产，下面是按配置画出来的结构和属性（只读）')
        }
      />
    )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {marks && (
        <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-warning/6 ue:px-5 ue:py-1.5 ue:text-footnote">
          <GitCompare className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" />
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-fg">
            {t('导入会改 {n} 个属性：{names}', {
              n: diff?.total ?? marks.size,
              names: [...marks.keys()].slice(0, 6).join('、') + (marks.size > 6 ? '…' : ''),
            })}
          </span>
          <button
            type="button"
            className={cn('ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline')}
            onClick={() => setShowMarks((v) => !v)}
          >
            {showMarks ? t('不标出') : t('标出')}
          </button>
          <button
            type="button"
            className="ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline"
            onClick={onShowDiff}
          >
            {t('看属性差异')}
          </button>
        </div>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:p-2">
        <AssetView
          key={path}
          path={path}
          comp={comp}
          onComp={setComp}
          onOpen={(p) => go('assets', p)}
          hint={t('这里改的是资源本身：配置是真源，改完记得「导出到配置」，否则下次导入会被配置盖回去')}
          marks={showMarks ? marks : undefined}
        />
      </div>
    </div>
  )
}
