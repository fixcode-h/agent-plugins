import { Download, Info, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { op, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, ErrorText, Term } from '../../ui.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { kindMeta, stateMeta } from './kinds.ts'

/**
 * AssetForge 选中项的详情：头部（类型图标、名字、所在目录、状态、导出 / 导入），路径和说明，
 * 三个页签：计划（演练导入会做的动作和诊断）、属性差异（和资产比，或和版本管理里上次提交的配置比）、配置原文。
 */
interface Describe {
  managed?: boolean
  stateDescription?: string
  configText?: string
  configTextTruncated?: boolean
  exportable?: boolean
}

interface Report {
  succeeded?: boolean
  created?: number
  updated?: number
  deleted?: number
  actions?: { action: string; nodePath?: string; nodeName?: string; detail?: string }[]
  diagnostics?: { severity: string; fieldPath?: string; message: string }[]
}

interface Diff {
  supported: boolean
  reason?: string
  baseline?: 'asset' | 'config'
  changes: { property: string; before: unknown; after: unknown }[]
  total: number
  truncated?: boolean
}

const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'string' ? v : JSON.stringify(v))

export function ForgeDetail({ entry, busy }: { entry: ForgeEntry; busy: boolean }) {
  const { project } = useUe()
  const { ui, cn } = h()
  const { busy: acting, run } = useAction()
  const [tab, setTab] = useState<'plan' | 'diff' | 'config'>(entry.config ? 'diff' : 'config')
  const [against, setAgainst] = useState<'asset' | 'commit'>('asset')
  const k = kindMeta(entry.kind)
  const s = stateMeta(entry.state)
  const where = entry.asset ? entry.asset.split('/').slice(0, -1).join('/') : (entry.config ?? '')
  const desc = useLoad(
    () => op<Describe>(project.id, 'forge.describe', entry.config ? { config: entry.config } : { asset: entry.asset }),
    [entry.key, entry.state],
  )
  const plan = useLoad(
    () =>
      tab === 'plan' && entry.config
        ? op<{ report: Report }>(project.id, 'forge.plan', { config: entry.config }, undefined, 120000).then(
            (r) => r.report,
          )
        : Promise.resolve(undefined),
    [entry.key, entry.state, tab],
  )
  const diff = useLoad(async () => {
    if (tab !== 'diff' || !entry.config) return undefined
    let baselineText: string | undefined
    if (against === 'commit') {
      const b = await ppost<{ text: string }>(project.id, 'ext/baseline', { file: entry.configPath })
      baselineText = b.text
    }
    const r = await op<{ diff: Diff }>(
      project.id,
      'forge.diff',
      { config: entry.config, ...(baselineText !== undefined && { baselineText }) },
      undefined,
      120000,
    )
    return r.diff
  }, [entry.key, entry.state, tab, against])

  const doImport = () =>
    run('import', () => op(project.id, 'forge.import', { configs: [entry.config] }).then(() => undefined))
  const doExport = () =>
    run('export', () => op(project.id, 'forge.export', { assets: [entry.asset] }).then(() => undefined))
  const canImport = !!entry.config && !['parse-error', 'no-asset', 'foreign'].includes(entry.state)
  const canExport = !!entry.asset && entry.state !== 'asset-missing'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:min-h-14 ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-5 ue:py-2.5">
        <span className="ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg ue:bg-hover">
          <k.icon className={cn('ue:h-4 ue:w-4', k.tone)} strokeWidth={1.75} />
        </span>
        <span className="ue:flex ue:min-w-0 ue:flex-col">
          <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{entry.name}</span>
          <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
            {where} · {k.label()}
          </span>
        </span>
        <Badge
          tone={
            s.tone.includes('danger')
              ? 'danger'
              : s.tone.includes('warning')
                ? 'warn'
                : s.tone.includes('success')
                  ? 'ok'
                  : s.tone.includes('accent')
                    ? 'accent'
                    : 'muted'
          }
        >
          {s.label()}
        </Badge>
        <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-2">
          <ui.Button
            size="sm"
            variant="secondary"
            disabled={!canExport || busy || !!acting}
            title={t('把资产现在的样子写回配置')}
            onClick={doExport}
          >
            <Upload className="ue:h-3.5 ue:w-3.5" /> {entry.config ? t('导出') : t('导出成配置')}
          </ui.Button>
          {entry.config && (
            <ui.Button
              size="sm"
              disabled={!canImport || busy || !!acting}
              title={t('按配置写资产并保存')}
              onClick={doImport}
            >
              <Download className="ue:h-3.5 ue:w-3.5" /> {t('导入')}
            </ui.Button>
          )}
        </div>
      </header>
      <dl className="ue:grid ue:grid-cols-[88px_1fr] ue:gap-x-3 ue:gap-y-1.5 ue:border-b ue:border-line ue:px-5 ue:py-3 ue:text-footnote">
        {entry.configPath && (
          <>
            <dt className="ue:text-subtle">{t('配置')}</dt>
            <dd className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg" title={entry.configPath}>
              {entry.configPath}
            </dd>
          </>
        )}
        {entry.asset && (
          <>
            <dt className="ue:text-subtle">{t('资产')}</dt>
            <dd className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{entry.asset}</dd>
          </>
        )}
        <dt className="ue:text-subtle">{t('说明')}</dt>
        <dd className="ue:text-fg">{entry.message || desc.data?.stateDescription || s.label()}</dd>
      </dl>
      <div className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-5 ue:py-2">
        <ui.Segmented
          size="sm"
          label={t('计划 / 属性差异 / 配置')}
          value={tab}
          onChange={setTab}
          options={[
            ...(entry.config
              ? [
                  { id: 'plan' as const, label: t('计划') },
                  {
                    id: 'diff' as const,
                    label: diff.data?.total ? `${t('属性差异')} · ${diff.data.total}` : t('属性差异'),
                  },
                ]
              : []),
            { id: 'config' as const, label: t('配置') },
          ]}
        />
        {tab === 'diff' && (
          <ui.Select
            size="sm"
            className="ue:ml-auto ue:w-44"
            aria-label={t('和什么比')}
            value={against}
            onChange={(e: { target: { value: string } }) => setAgainst(e.target.value as 'asset' | 'commit')}
            options={[
              { value: 'asset', label: t('对比：资产') },
              { value: 'commit', label: t('对比：上次提交的配置') },
            ]}
          />
        )}
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {tab === 'plan' && <PlanView loading={plan.loading} error={plan.error} report={plan.data} />}
        {tab === 'diff' && <DiffView loading={diff.loading} error={diff.error} diff={diff.data} against={against} />}
        {tab === 'config' &&
          (desc.error ? (
            <div className="ue:p-4">
              <ErrorText>{desc.error}</ErrorText>
            </div>
          ) : desc.data?.configText !== undefined ? (
            <div className="ue:p-4">
              <Term>
                <pre className="ue:whitespace-pre-wrap">{desc.data.configText}</pre>
              </Term>
              {desc.data.configTextTruncated && (
                <p className="ue:mt-2 ue:text-caption ue:text-subtle">{t('配置太长，只显示了前一部分')}</p>
              )}
            </div>
          ) : (
            <Hint>
              {desc.loading
                ? t('读取中…')
                : desc.data?.exportable
                  ? t('这个资产还没有配置：点「导出成配置」生成一份，之后就按配置管理')
                  : t('没有配置原文')}
            </Hint>
          ))}
      </div>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="ue:flex ue:items-start ue:gap-1.5 ue:px-5 ue:py-3 ue:text-footnote ue:leading-relaxed ue:text-subtle">
      <Info className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function Loading() {
  return (
    <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
      <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
    </div>
  )
}

function PlanView({ loading, error, report }: { loading: boolean; error: string; report?: Report }) {
  const { cn } = h()
  if (error)
    return (
      <div className="ue:p-4">
        <ErrorText>{error}</ErrorText>
      </div>
    )
  if (loading && !report) return <Loading />
  if (!report) return null
  const acts = report.actions ?? []
  const diags = report.diagnostics ?? []
  return (
    <div className="ue:flex ue:flex-col">
      <p className="ue:px-5 ue:py-2.5 ue:text-footnote ue:text-muted">
        {t('导入会新建 {c}、修改 {u}、删除 {d} 个节点', {
          c: report.created ?? 0,
          u: report.updated ?? 0,
          d: report.deleted ?? 0,
        })}
      </p>
      {diags.map((d, i) => (
        <div
          key={`d${i}`}
          className={cn(
            'ue:border-t ue:border-line/60 ue:px-5 ue:py-1.5 ue:text-footnote',
            d.severity === 'error' ? 'ue:text-danger' : 'ue:text-warning',
          )}
        >
          <span className="ue:font-mono">{d.fieldPath || t('文件')}</span> · {d.message}
        </div>
      ))}
      {acts.map((a, i) => (
        <div
          key={i}
          className="ue:grid ue:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] ue:gap-3 ue:border-t ue:border-line/60 ue:px-5 ue:py-1.5 ue:text-footnote"
        >
          <span className="ue:font-mono ue:text-muted">{a.action}</span>
          <span className="ue:truncate ue:font-mono ue:text-fg" title={a.nodePath}>
            {a.nodePath || a.nodeName}
          </span>
          <span className="ue:truncate ue:text-subtle" title={a.detail}>
            {a.detail}
          </span>
        </div>
      ))}
      {!acts.length && !diags.length && <Hint>{t('导入不会改资产')}</Hint>}
    </div>
  )
}

function DiffView({
  loading,
  error,
  diff,
  against,
}: {
  loading: boolean
  error: string
  diff?: Diff
  against: 'asset' | 'commit'
}) {
  if (error)
    return (
      <div className="ue:p-4">
        <ErrorText>{error}</ErrorText>
      </div>
    )
  if (loading && !diff) return <Loading />
  if (!diff) return null
  if (!diff.supported) return <Hint>{diff.reason || t('这种资产不支持属性差异，看「计划」页')}</Hint>
  const cell = 'ue:truncate ue:border-t ue:border-line/60 ue:px-3 ue:py-1.5'
  return (
    <div>
      <div className="ue:grid ue:grid-cols-[minmax(200px,1.2fr)_1fr_1fr] ue:font-mono ue:text-footnote">
        <div className="ue:bg-sel/35 ue:px-3 ue:py-1.5 ue:font-sans ue:text-caption ue:text-subtle">{t('属性')}</div>
        <div className="ue:bg-sel/35 ue:px-3 ue:py-1.5 ue:font-sans ue:text-caption ue:text-subtle">
          {against === 'commit' ? t('上次提交的配置') : t('现在（资产）')}
        </div>
        <div className="ue:bg-sel/35 ue:px-3 ue:py-1.5 ue:font-sans ue:text-caption ue:text-subtle">
          {against === 'commit' ? t('现在的配置') : t('导入后')}
        </div>
        {diff.changes.map((c, i) => (
          <div key={i} className="ue:contents">
            <div className={`${cell} ue:text-fg`} title={c.property}>
              {c.property}
            </div>
            <div
              className={`${cell} ${c.before === undefined || c.before === null ? 'ue:text-subtle' : 'ue:bg-danger/8 ue:text-danger'}`}
              title={show(c.before)}
            >
              {show(c.before)}
            </div>
            <div className={`${cell} ue:bg-success/9 ue:text-success`} title={show(c.after)}>
              {show(c.after)}
            </div>
          </div>
        ))}
      </div>
      {!diff.changes.length && <Hint>{t('没有属性差异')}</Hint>}
      {diff.truncated && (
        <Hint>{t('差异太多，只列出了前 {n} 条（共 {total} 条）', { n: diff.changes.length, total: diff.total })}</Hint>
      )}
      {against === 'asset' && diff.changes.length > 0 && (
        <Hint>{t('对比可以换成「上次提交的配置」：从版本管理取旧版本，看这次改了哪些属性')}</Hint>
      )}
    </div>
  )
}
