import { useEffect, useMemo, useRef, useState } from 'react'
import { op, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import type { ForgeEntry } from './Forge.tsx'
import type { ForgeFileOps } from './forge-file-ops.ts'
import { canImport, useForgeActions } from './forge-actions.ts'
import { ForgeAssetTab } from './ForgeAssetTab.tsx'
import { ForgeConfig, lineFromMessage, type ConfigFocus } from './ForgeConfig.tsx'
import { ForgeMarkupTab } from './forge-markup/ForgeMarkupTab.tsx'
import { useForgeExpanded } from './forge-config/use-expanded.ts'
import { AgainstSelect, ForgeDiff, type Against, type ForgeDiffData } from './ForgeDiff.tsx'
import { ForgeHeader } from './ForgeHeader.tsx'
import { ForgeLink } from './ForgeLink.tsx'
import { ForgePlan, planCount, type PlanReport } from './ForgePlan.tsx'

/**
 * AssetForge 选中一份配置时的右栏（设计稿 §2.2）：一份配置 = 一个资源。
 * 头部（主按钮跟状态走）、配置 → 资源关系条，下面五个页签：资源（默认，复用资源页的显示）、属性差异、导入计划、配置原文、
 * 标记视图（设计稿 4.2：按段画成类似 XAML 的标签，点标签跳回配置原文对应的行）。
 * 配置 include 了片段文件（4.3.4）时这里先展开：预览、标记视图按展开后的文档画，片段文件也一起盯着存盘。
 * 页签由左栏记在地址 / 状态里（tab），没给时按状态挑默认的那个：被改过的先看差异，读不出来的先看原文。
 */
export type ForgeTab = 'asset' | 'diff' | 'plan' | 'config' | 'markup'

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
  fileOps,
  onFragments,
}: {
  entry: ForgeEntry
  busy: boolean
  configRoot: string
  tab?: ForgeTab
  onTab: (t: ForgeTab) => void
  /** 这份配置存盘的次数（Forge.tsx 收 forge.file 推送时加 1）：变了就重拉原文、差异，重新演练 */
  fileRev?: number
  /** 复制一份、让 AI 改、存为模板（弹窗由页面挂） */
  fileOps?: ForgeFileOps
  /** 这份配置 include 的片段文件（相对配置根）：页面一起盯着存盘 */
  onFragments?: (files: string[]) => void
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
    0,
    // 切回看过的配置时先用上次的（状态说明那行不晚到一下把下面整块往下推），读到新的再换
    `${project.id}/forge/describe/${entry.key}`,
  )
  // 配置原文直接读本机文件（用户 2026-11-16「看个 json 原文为什么要等编辑器」）：编辑器没开、卡住或崩了也能看；
  // 读不到（配置根还不知道、文件太大）才退回 forge.describe 回的那份
  const cfgPath = entry.config?.replace(/\\/g, '/')
  const local = useLoad(
    () =>
      cfgPath && configRoot
        ? ppost<{ text: string }>(project.id, 'ext/forge/read', { root: configRoot, path: cfgPath }).then((r) => r.text)
        : Promise.resolve(undefined),
    [entry.key, configRoot, fileRev],
    0,
    // 切回看过的配置时第一帧就有原文：中间的预览直接画出来，不先空一下（用户 2026-11-20「切换预览一闪一闪」）
    `${project.id}/forge/text/${entry.key}`,
  )
  const configText = local.data ?? desc.data?.configText
  // include 展开（片段文件逐个从磁盘读）；片段列表交给页面一起盯（一个页面连接只登记一份，登记在 Forge.tsx）
  // 细节面板改了配置（可能是 include 的片段文件）：主文件原文没变时也要重新展开，不等文件监视的推送
  const [editRev, setEditRev] = useState(0)
  const expanded = useForgeExpanded(project.id, configRoot, cfgPath, local.data, fileRev + editRev)
  const fragKey = expanded?.fragments.join('\n') ?? ''
  useEffect(() => {
    onFragments?.(fragKey ? fragKey.split('\n') : [])
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [fragKey])
  // 标记视图点了标签：切到配置原文，定位到那份文件的那一行
  const [focus, setFocus] = useState<ConfigFocus>()
  const configTruncated = local.data === undefined && desc.data?.configTextTruncated
  // 本机读失败时才等编辑器；两边都失败报本机那条（更直接）
  const configLoading = configText === undefined && (local.loading || (!!local.error && desc.loading))
  const configError = configText === undefined && !configLoading ? local.error || desc.error : ''
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
  // 「资源」页签里的 UMG 细节面板直接改配置文件（用户 2026-11-20）：存完马上重读本机原文，预览、控件树跟着刷新，
  // 文件监视的推送随后再让差异、计划重算
  const reloadLocal = local.reload
  const assetEdit = useMemo(
    () =>
      cfgPath && configRoot
        ? {
            project: project.id,
            configRoot,
            main: cfgPath,
            onSaved: () => {
              void reloadLocal()
              setEditRev((n) => n + 1)
            },
            openConfig: () => onTab('config'),
          }
        : undefined,
    // onTab 由页面给、每次渲染都是新的；切页签的意思不变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [project.id, configRoot, cfgPath, reloadLocal],
  )
  const nDiff = diff.data?.supported ? diff.data.total : undefined
  const nPlan = planCount(plan.data)
  const withCount = (label: string, n?: number) => (n ? `${label} ${n}` : label)

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <ForgeHeader entry={entry} busy={busy} actions={actions} onDryRun={() => pick('plan')} fileOps={fileOps} />
      <div className="ue:border-b ue:border-line ue:px-5 ue:pb-2.5">
        <ForgeLink
          config={(entry.config ?? '').replace(/\\/g, '/')}
          asset={entry.asset}
          kind={entry.kind}
          state={entry.state}
          importedAt={desc.data?.entry?.importedAtUtc || undefined}
          onOpenAsset={actions.openAsset}
        />
        {/* 没同步的状态先把这一行占住：说明是 forge.describe 晚到的，不占位的话它一到下面整块被往下推一下 */}
        {(entry.message || entry.state !== 'synced') && (
          <p
            className="ue:mt-1.5 ue:min-h-[1lh] ue:truncate ue:text-footnote ue:text-muted"
            title={entry.message || desc.data?.stateDescription}
          >
            {entry.message || desc.data?.stateDescription}
          </p>
        )}
      </div>
      <div className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-5 ue:py-2">
        <ui.Segmented
          size="sm"
          label={t('资源 / 属性差异 / 导入计划 / 配置原文 / 标记视图')}
          value={tab}
          onChange={pick}
          options={[
            { id: 'asset' as const, label: t('资源') },
            { id: 'diff' as const, label: withCount(t('属性差异'), nDiff) },
            { id: 'plan' as const, label: withCount(t('导入计划'), nPlan) },
            { id: 'config' as const, label: t('配置原文') },
            { id: 'markup' as const, label: t('标记视图') },
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
            configText={configText}
            expanded={expanded}
            configTruncated={configTruncated}
            configLoading={configLoading}
            configError={configError}
            onShowDiff={() => pick('diff')}
            edit={assetEdit}
          />
        )}
        {tab === 'diff' &&
          (diffable ? (
            <ForgeDiff loading={diff.loading} error={diff.error} diff={diff.data} against={against} kind={entry.kind} />
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
            loading={configLoading}
            error={configError}
            text={configText}
            truncated={configTruncated}
            badLine={entry.state === 'parse-error' ? lineFromMessage(entry.message) : undefined}
            onOpen={() => void actions.openFile()}
            expanded={expanded}
            kind={entry.kind}
            focus={focus}
            edit={
              entry.config && configRoot
                ? { project: project.id, configRoot, path: entry.config.replace(/\\/g, '/') }
                : undefined
            }
          />
        )}
        {tab === 'markup' && (
          <ForgeMarkupTab
            loading={configLoading}
            error={configError}
            text={configText}
            expanded={expanded}
            main={cfgPath}
            onFocus={(file, line) => {
              setFocus((f) => ({ file, line, nonce: (f?.nonce ?? 0) + 1 }))
              pick('config')
            }}
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
