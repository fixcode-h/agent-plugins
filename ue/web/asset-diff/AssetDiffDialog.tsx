import { useEffect, useState, type ReactNode } from 'react'
import { VersionDiffShell, type VersionPick } from '@panel/web/src/components/ui/version-diff'
import type { PropRef } from '../../shared/asset-diff/prop-history.ts'
import type { AssetDiff, PropDiff } from '../../shared/asset-diff/types.ts'
import { op, pget } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { DiffBody, SummaryTags, type Tab } from './DiffBody.tsx'
import { FailPane } from './FailPane.tsx'
import { DiffLoading, ReaderChip } from './Progress.tsx'
import { useDiffRun } from './use-diff-run.ts'
import { closeAssetDiff, takeInitialRev, useAssetDiffTarget } from './store.ts'
import { ChangeSetStrip } from './ChangeSetStrip.tsx'
import { PropHistoryPane } from './PropHistoryPane.tsx'
import { RevActions } from './RevActions.tsx'

interface History {
  vcs: 'git' | 'p4' | 'svn' | 'none'
  base: string
  /** change：提交号 / 变更列表号（面板 vcs-history 给，查「同一提交里一起改的资源」用） */
  revs: { id: string; label: string; author: string; time: string; message: string; change?: string }[]
  error?: string
  file: string
}

/** 资源页里挂一个：工具栏按钮、右键菜单经 store.ts 打开 */
export function AssetDiffHost() {
  const pkg = useAssetDiffTarget()
  return pkg ? <AssetDiffDialog key={pkg} pkg={pkg} onClose={closeAssetDiff} /> : null
}

/**
 * 资源的版本差异（设计稿 UE资源版本差异）：左边版本记录，点开一条记录才取那两版的快照比（用户 2026-11-19：
 * 不预先算，点开才实时拉取），算过的这次打开里记着，左栏显示小标签。
 * 「本地改动」= 最近一次提交 ↔ 编辑器里现在的内容（编辑器开着时，含没保存的）或磁盘上的文件；看编辑器里的那份时能把类默认值改回旧值
 */
export function AssetDiffDialog({ pkg, onClose }: { pkg: string; onClose: () => void }) {
  const { project, state } = useUe()
  const { ui, toast } = h()
  const name = pkg.split('/').pop() ?? pkg
  const editorOn = (state?.instances ?? []).some((i) => i.kind === 'editor')
  const [hist, setHist] = useState<History | null>(null)
  const [histError, setHistError] = useState('')
  const [pick, setPickRaw] = useState<VersionPick>('local')
  const [against, setAgainst] = useState('')
  const [side, setSide] = useState<'live' | 'disk'>(editorOn ? 'live' : 'disk')
  const [only, setOnly] = useState(true)
  // 默认第一个页签（控件蓝图是控件树，别的回落到属性页，见 DiffBody）
  const [tab, setTab] = useState<Tab>('widgets')
  const [propHist, setPropHist] = useState<{ ref: PropRef; label: string } | null>(null)

  useEffect(() => {
    // 从「同一提交里一起改的资源」点过来时停在同一版
    const want = takeInitialRev()
    pget<History>(project.id, `asset-history?path=${encodeURIComponent(pkg)}`).then(
      (r) => {
        setHist(r)
        const i = want ? r.revs.findIndex((x) => x.id === want) : -1
        if (i >= 0) setPickRaw(i)
      },
      (e: Error) => setHistError(e.message),
    )
  }, [project.id, pkg])

  // 换一个版本就回到「和上一版比」（同表格的版本差异：留着的话点到那一版本身会变成自己和自己比）
  const setPick = (p: VersionPick) => {
    setPickRaw(p)
    setAgainst('')
  }
  const revs = hist?.revs ?? []
  const prevOf = (i: number): string | null => revs[i + 1]?.id ?? null
  const from: string | null = !hist ? null : against || (pick === 'local' ? hist.base : prevOf(pick))
  const to: string = pick === 'local' ? (editorOn ? side : 'disk') : (revs[pick]?.id ?? '')
  const key = `${from ?? '∅'}|${to}`
  const run = useDiffRun(project.id, pkg, hist && hist.vcs !== 'none' && to ? { key, from, to } : null)
  const done = run.done
  const diff = done.get(key)

  const labelOf = (id: string | null) =>
    id === null
      ? t('（新建）')
      : id === 'live'
        ? t('编辑器里')
        : id === 'disk'
          ? t('本地')
          : id === hist?.base
            ? hist.vcs === 'p4'
              ? '#have'
              : (revs[0]?.label ?? t('最近一次提交'))
            : (revs.find((r) => r.id === id)?.label ?? id)
  const a = labelOf(from)
  const b = labelOf(to)

  // 改编辑器里那份的类默认值（行尾「改回旧值」、来历栏「改回这个值」）
  const setProp =
    pick === 'local' && to === 'live'
      ? (prop: string, value: unknown) => {
          const objPath = diff?.blueprint ? `${pkg}.Default__${name}_C` : `${pkg}.${name}`
          op(project.id, 'set', { path: objPath, prop, value }).then(
            () => {
              toast.success(t('已改回旧值：在资源页点「保存」才写回文件'))
              run.retry()
            },
            (e: Error) => toast.error(e.message),
          )
        }
      : undefined
  const restore = setProp && ((p: PropDiff) => setProp(p.name, p.a))
  const jumpTo = (rev: string) => {
    if (rev === 'live' || rev === 'disk') return setPick('local')
    const i = revs.findIndex((r) => r.id === rev)
    if (i >= 0) setPick(i)
  }
  const cur = typeof pick === 'number' ? revs[pick] : undefined
  // 还原到哪一版：选中的那一版；本地改动页是最近一次提交（git HEAD / p4 #have）
  const restoreRev = cur?.id ?? hist?.base ?? ''

  // 左栏小标签：这次打开里算过的（和上一版比的那一次）
  const tags: Record<string, ReactNode> = {}
  for (const [i, r] of revs.entries()) {
    const d = done.get(`${prevOf(i) ?? '∅'}|${r.id}`)
    if (d) tags[r.id] = <SummaryTags diff={d} />
  }
  if (hist) {
    const d = done.get(`${hist.base}|${editorOn ? side : 'disk'}`)
    if (d) tags.local = <SummaryTags diff={d} />
  }

  return (
    <VersionDiffShell
      open
      onClose={onClose}
      meta={`${hist?.file ?? pkg}${diff ? ` · ${diff.class}` : ''}`}
      paneKey="ue-asset"
      list={hist}
      failed={hist ? undefined : histError}
      pick={pick}
      onPick={setPick}
      local={{
        meta: editorOn ? t('编辑器里没保存的也算') : t('磁盘上的文件'),
        message: editorOn ? t('最近一次提交 ↔ 编辑器里现在的内容') : t('最近一次提交 ↔ 磁盘上的文件'),
      }}
      tags={tags}
      header={
        <>
          <span className="ue:font-mono ue:text-body ue:font-medium">{`${a} → ${b}`}</span>
          {diff && <SummaryTags diff={diff} onTab={setTab} />}
          {!diff && <ReaderChip reader={run.progress?.reader} />}
          <span className="ue:flex-1" />
          {hist && hist.vcs !== 'none' && restoreRev && (
            <RevActions
              pkg={pkg}
              rev={restoreRev}
              revLabel={cur?.label ?? labelOf(hist.base)}
              local={pick === 'local'}
              diff={diff}
              a={a}
              b={b}
              onRestored={() => {
                setPropHist(null)
                run.retry()
              }}
            />
          )}
          {hist && hist.vcs !== 'none' && (
            <ui.Select
              size="sm"
              aria-label={t('和哪一版比')}
              value={against}
              onChange={(e: { target: { value: string } }) => setAgainst(e.target.value)}
              options={[
                { value: '', label: pick === 'local' ? t('和最近一次提交比') : t('和上一版比') },
                ...revs
                  .filter((_, i) => pick === 'local' || i !== pick)
                  .map((r) => ({ value: r.id, label: t('和 {rev} 比', { rev: r.label }) })),
              ]}
            />
          )}
          {pick === 'local' && editorOn && (
            <ui.Segmented
              label={t('本地的哪一份')}
              size="sm"
              value={side}
              onChange={(v: string) => setSide(v === 'disk' ? 'disk' : 'live')}
              options={[
                { id: 'live', label: t('编辑器里的') },
                { id: 'disk', label: t('磁盘上的') },
              ]}
            />
          )}
          <ui.Segmented
            label={t('显示')}
            size="sm"
            value={only ? 'only' : 'all'}
            onChange={(v: string) => setOnly(v === 'only')}
            options={[
              { id: 'only', label: t('只看变化') },
              { id: 'all', label: t('全部') },
            ]}
          />
        </>
      }
    >
      {cur?.change && (
        <ChangeSetStrip
          key={cur.id}
          pkg={pkg}
          change={cur.change}
          label={cur.label}
          rev={cur.id}
          message={cur.message}
        />
      )}
      {diff ? null : run.failed ? (
        <FailPane failed={run.failed} onRetry={run.retry} onClose={onClose} />
      ) : !hist || hist.vcs === 'none' ? null : (
        <DiffLoading progress={run.progress} since={run.since} onCancel={run.cancel} />
      )}
      {diff && (
        <div className="ue:flex ue:min-h-0 ue:flex-1">
          <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
            <DiffBody
              pkg={pkg}
              diff={diff}
              only={only}
              tab={tab}
              onTab={setTab}
              a={a}
              b={b}
              editorOn={editorOn}
              onRestore={restore}
              onHistory={(ref, label) => setPropHist({ ref, label })}
            />
          </div>
          {propHist && (
            <PropHistoryPane
              pkg={pkg}
              propRef={propHist.ref}
              label={propHist.label}
              start={to}
              onClose={() => setPropHist(null)}
              onJump={jumpTo}
              onSet={setProp && propHist.ref.kind === 'defaults' ? (v) => setProp(propHist.ref.prop, v) : undefined}
            />
          )}
        </div>
      )}
    </VersionDiffShell>
  )
}
