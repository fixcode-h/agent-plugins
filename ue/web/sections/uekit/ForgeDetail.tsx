import { useEffect, useRef, useState } from 'react'
import { op, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import type { ForgeEntry } from './Forge.tsx'
import { canImport, useForgeActions } from './forge-actions.ts'
import { ForgeAssetTab } from './ForgeAssetTab.tsx'
import { ForgeConfig, lineFromMessage } from './ForgeConfig.tsx'
import { AgainstSelect, ForgeDiff, type Against, type ForgeDiffData } from './ForgeDiff.tsx'
import { ForgeHeader } from './ForgeHeader.tsx'
import { ForgeLink } from './ForgeLink.tsx'
import { ForgePlan, planCount, type PlanReport } from './ForgePlan.tsx'

/**
 * AssetForge 选中一份配置时的右栏（设计稿 §2.2）：一份配置 = 一个资源。
 * 头部（主按钮跟状态走）、配置 → 资源关系条，下面四个页签：资源（默认，复用资源页的显示）、属性差异、导入计划、配置原文。
 * 页签由左栏记在地址 / 状态里（tab），没给时按状态挑默认的那个：被改过的先看差异，读不出来的先看原文。
 */
export type ForgeTab = 'asset' | 'diff' | 'plan' | 'config'

interface Describe {
  managed?: boolean
  stateDescription?: string
  configText?: string
  configTextTruncated?: boolean
  /** UEKit 以后可能在 entry 里带上次导入时间（清单里有 importedAtUtc），带了就显示 */
  entry?: { importedAtUtc?: string }
}

export function defaultTab(state: string): ForgeTab {
  if (state === 'asset-changed') return 'diff'
  if (['parse-error', 'no-asset', 'foreign'].includes(state)) return 'config'
  return 'asset'
}

export function ForgeDetail({
  entry,
  busy,
  configRoot,
  tab: tabProp,
  onTab,
  fileRev = 0,
}: {
  entry: ForgeEntry
  busy: boolean
  configRoot: string
  tab?: ForgeTab
  onTab: (t: ForgeTab) => void
  /** 这份配置存盘的次数（Forge.tsx 收 forge.file 推送时加 1）：变了就重拉原文、差异，重新演练 */
  fileRev?: number
}) {
  const { project } = useUe()
  const { ui } = h()
  const tab = tabProp ?? defaultTab(entry.state)
  const [against, setAgainst] = useState<Against>('asset')
  // 计划是演练导入，慢：打开过「导入计划」页签才取，之后切走也留着条数
  const [planWanted, setPlanWanted] = useState(tab === 'plan')
  // 打开右栏之后又存过盘的时间：页签行上说一句「已按保存的配置刷新」，让人知道计划和差异是新的
  const [savedAt, setSavedAt] = useState<Date>()
  const firstRev = useRef(fileRev)
  useEffect(() => {
    if (fileRev === firstRev.current) return
    // 存盘后自动演练（设计稿：配置保存后右栏直接刷新计划和差异），不用再点「演练」
    setPlanWanted(true)
    setSavedAt(new Date())
  }, [fileRev])
  const actions = useForgeActions(entry, configRoot)
  const importable = canImport(entry)
  const desc = useLoad(
    () => op<Describe>(project.id, 'forge.describe', entry.config ? { config: entry.config } : { asset: entry.asset }),
    [entry.key, entry.state, fileRev],
  )
  const plan = useLoad(
    () =>
      (planWanted || tab === 'plan') && importable
        ? op<{ report: PlanReport }>(project.id, 'forge.plan', { config: entry.config }, undefined, 120000).then(
            (r) => r.report,
          )
        : Promise.resolve(undefined),
    [entry.key, entry.state, planWanted || tab === 'plan', fileRev],
  )
  // 差异条数要标在页签上，进来就取；还没导入、资产不存在时没有可比的资产，不取
  const diffable = importable && !['never-imported', 'asset-missing'].includes(entry.state)
  const diff = useLoad(async () => {
    if (!diffable) return undefined
    let baselineText: string | undefined
    if (against === 'commit') {
      const b = await ppost<{ text: string }>(project.id, 'ext/baseline', { file: entry.configPath })
      baselineText = b.text
    }
    const r = await op<{ diff: ForgeDiffData }>(
      project.id,
      'forge.diff',
      { config: entry.config, ...(baselineText !== undefined && { baselineText }) },
      undefined,
      120000,
    )
    return r.diff
  }, [entry.key, entry.state, against, fileRev])

  const pick = (next: ForgeTab) => {
    if (next === 'plan') setPlanWanted(true)
    onTab(next)
  }
  const nDiff = diff.data?.supported ? diff.data.total : undefined
  const nPlan = planCount(plan.data)
  const withCount = (label: string, n?: number) => (n ? `${label} ${n}` : label)

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <ForgeHeader entry={entry} busy={busy} actions={actions} onDryRun={() => pick('plan')} />
      <div className="ue:border-b ue:border-line ue:px-5 ue:pb-2.5">
        <ForgeLink
          config={(entry.config ?? '').replace(/\\/g, '/')}
          asset={entry.asset}
          kind={entry.kind}
          state={entry.state}
          importedAt={desc.data?.entry?.importedAtUtc || undefined}
          onOpenAsset={actions.openAsset}
        />
        {(entry.message || (entry.state !== 'synced' && desc.data?.stateDescription)) && (
          <p className="ue:mt-1.5 ue:text-footnote ue:text-muted">{entry.message || desc.data?.stateDescription}</p>
        )}
      </div>
      <div className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-5 ue:py-2">
        <ui.Segmented
          size="sm"
          label={t('资源 / 属性差异 / 导入计划 / 配置原文')}
          value={tab}
          onChange={pick}
          options={[
            { id: 'asset' as const, label: t('资源') },
            { id: 'diff' as const, label: withCount(t('属性差异'), nDiff) },
            { id: 'plan' as const, label: withCount(t('导入计划'), nPlan) },
            { id: 'config' as const, label: t('配置原文') },
          ]}
        />
        {savedAt && (
          <span className="ue:truncate ue:text-caption ue:text-subtle" title={savedAt.toLocaleString()}>
            {plan.loading || diff.loading
              ? t('配置已保存，正在重新演练…')
              : t('已按 {time} 保存的配置刷新', { time: savedAt.toLocaleTimeString() })}
          </span>
        )}
        {tab === 'diff' && (
          <div className="ue:ml-auto">
            <AgainstSelect value={against} onChange={setAgainst} />
          </div>
        )}
      </div>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto">
        {tab === 'asset' && (
          <ForgeAssetTab
            entry={entry}
            diff={against === 'asset' ? diff.data : undefined}
            configText={desc.data?.configText}
            configTruncated={desc.data?.configTextTruncated}
            onShowDiff={() => pick('diff')}
          />
        )}
        {tab === 'diff' &&
          (diffable ? (
            <ForgeDiff loading={diff.loading} error={diff.error} diff={diff.data} against={against} />
          ) : (
            <NoCompare entry={entry} />
          ))}
        {tab === 'plan' &&
          (importable ? (
            <ForgePlan loading={plan.loading} error={plan.error} report={plan.data} />
          ) : (
            <NoCompare entry={entry} />
          ))}
        {tab === 'config' && (
          <ForgeConfig
            loading={desc.loading}
            error={desc.error}
            text={desc.data?.configText}
            truncated={desc.data?.configTextTruncated}
            badLine={entry.state === 'parse-error' ? lineFromMessage(entry.message) : undefined}
            onOpen={() => void actions.openFile()}
          />
        )}
      </div>
    </div>
  )
}

/** 差异 / 计划页签在没法比的状态下的说明 */
function NoCompare({ entry }: { entry: ForgeEntry }) {
  return (
    <p className="ue:px-5 ue:py-3 ue:text-footnote ue:text-subtle">
      {canImport(entry) ? t('资源还没生成，没有可比的属性：导入后再看') : t('配置读不出来或没写目标资产，先修好配置')}
    </p>
  )
}
