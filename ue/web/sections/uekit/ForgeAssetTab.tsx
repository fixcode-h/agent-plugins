import { GitCompare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { AssetView, canOffline } from '../../inspect/AssetView.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { ForgeConfigPreview } from './ForgeConfigPreview.tsx'
import type { ForgeDiffData } from './ForgeDiff.tsx'
import { assetObjectPath } from './ForgeLink.tsx'
import { Hint } from './forge-parts.tsx'
import { useFragmentAt, type ForgeExpanded } from './forge-config/use-expanded.ts'
import { ConfigEditCtx, type ConfigEdit } from '../../inspect/layouts/umg/edit/ctx.ts'
import type { AssetConfig } from '../../inspect/layouts/types.ts'
import { LoadingMask } from '../../loading-mask/LoadingMask.tsx'

/** 上一份画完的离线预览：切到还没读完的配置时先接着显示它（模块级，整页刷新才清） */
let lastOffline: { path: string; config: AssetConfig } | undefined

/** 主文件 include 了片段：要等展开完再揭开遮罩，不然先画没展开的树、再长出片段里的节点 */
const hasInclude = (text: string) => /"include"\s*:/.test(text)

/**
 * 「资源」页签（默认页签，设计稿 §2.2 第 3、4 条，用户原话「这个 json 也可以认为是一个蓝图资源」）：
 * - 资源已经生成：原样复用资源页的检视 AssetView（组件树 + 类默认值 / 属性 / 表格、蓝图、摘要与引用），
 *   并把 forge.diff 里导入会改的顶层属性标在属性面板上（marks）；
 * - 资源还没生成：按配置本身的节点树画一份只读预览（ForgeConfigPreview），导入后换成真实资源。
 * 配置是真源：UMG 按配置画的控件在细节面板里直接改配置文件（ConfigEditCtx，用户 2026-11-20）；
 * 其它类型要改就用编辑器打开配置，或在资源页改完「导出到配置」。
 */
export function ForgeAssetTab({
  entry,
  diff,
  configText,
  expanded,
  configTruncated,
  configLoading,
  configError,
  onShowDiff,
  edit,
}: {
  entry: ForgeEntry
  /** 「和资产比」的属性差异；和上次提交的配置比的那份不用来标注（那是配置之间的差别，不是导入会改资源的） */
  diff?: ForgeDiffData
  configText?: string
  /** 展开 include 之后的配置（设计稿 4.3.4）：预览按它画 */
  expanded?: ForgeExpanded
  configTruncated?: boolean
  configLoading?: boolean
  configError?: string
  onShowDiff: () => void
  /** 能直接改配置文件时给（配置根、配置路径、存完刷新、跳配置原文）：UMG 细节面板改了写回配置 */
  edit?: Omit<ConfigEdit, 'expanded'>
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
  const fragmentAt = useFragmentAt(expanded)
  // 展开 include 之后的配置在手、又知道配置在哪：细节面板能直接改配置（节点在片段里就改片段文件）
  const editCtx = useMemo<ConfigEdit | null>(
    () => (edit && expanded?.doc ? { ...edit, expanded } : null),
    [edit, expanded],
  )

  if (['parse-error', 'foreign'].includes(entry.state))
    return <Hint>{t('配置读不出来，先看「配置原文」把它修好')}</Hint>
  const config: AssetConfig = {
    text: configText,
    doc: expanded?.doc,
    truncated: configTruncated,
    kind: entry.kind,
    loading: configLoading,
    error: configError,
    // 子界面（ref）按配置根读子配置；双击控件树里的子界面打开它自己的配置（和左栏点配置一样）
    root: edit?.configRoot,
    file: edit?.main,
    openConfig: (file: string) => go('assetforge', file),
  }
  // 有离线布局的类型（UMG）：资源还没生成也用和真实资源同一套布局，按配置画（资源查看页按 UE 编辑器布局，U4）。
  // 原文还在读时按左栏列表里的 kind 先认出布局，框架先摆好，不先闪一下「读取中」再换成整套布局
  if (path && absent && canOffline(configText, entry.kind)) {
    const ready = configText !== undefined && !(edit && !expanded && hasInclude(configText))
    if (ready) lastOffline = { path, config }
    // 第一次点开这份配置、原文还没到：先接着画上一份（盖着半透明遮罩），到了一次换掉，中间的布局不空一下
    const waiting = !ready && !configError
    const shown = waiting && lastOffline ? lastOffline : { path, config }
    return (
      <ConfigEditCtx.Provider value={ready ? editCtx : null}>
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:p-2">
          <LoadingMask show={waiting}>
            <AssetView
              key={shown.path}
              path={shown.path}
              comp={comp}
              onComp={setComp}
              onOpen={(p) => go('assets', p)}
              config={shown.config}
              offline
            />
          </LoadingMask>
        </div>
      </ConfigEditCtx.Provider>
    )
  }
  if (!path || absent)
    return (
      <ForgeConfigPreview
        text={configText}
        doc={expanded?.doc}
        fragmentAt={expanded?.origins.length ? fragmentAt : undefined}
        truncated={configTruncated}
        loading={configLoading}
        error={configError}
        onOpen={(p) => go('assets', p)}
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
        {/* 资源已经生成：编辑器开着时细节面板改 UE 里的真实资源（照旧）；编辑器没开、按配置画的控件改配置文件 */}
        <ConfigEditCtx.Provider value={editCtx}>
          <AssetView
            key={path}
            path={path}
            comp={comp}
            onComp={setComp}
            onOpen={(p) => go('assets', p)}
            hint={t('这里改的是资源本身：配置是真源，改完记得「导出到配置」，否则下次导入会被配置盖回去')}
            marks={showMarks ? marks : undefined}
            config={config}
          />
        </ConfigEditCtx.Provider>
      </div>
    </div>
  )
}
