import { useEffect, useRef, useState, type ReactNode } from 'react'
import { VersionDiffShell, type VersionPick } from '@panel/web/src/components/ui/version-diff'
import type { AssetDiff, PropDiff } from '../../shared/asset-diff/types.ts'
import { op, pget, ppost } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { DiffBody, Loading, SummaryTags, type Tab } from './DiffBody.tsx'
import { closeAssetDiff, useAssetDiffTarget } from './store.ts'

interface History {
  vcs: 'git' | 'p4' | 'svn' | 'none'
  base: string
  revs: { id: string; label: string; author: string; time: string; message: string }[]
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
  const [tab, setTab] = useState<Tab>('props')
  // 算过的差异：键是「旧|新」，这次打开里一直留着（左栏的小标签从这里来）
  const done = useRef(new Map<string, AssetDiff>())
  const [, bump] = useState(0)
  const [since, setSince] = useState(0)
  // 出错的是哪一对：换到别的版本再回来时不残留
  const [failed, setFailed] = useState<{ key: string; msg: string } | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    pget<History>(project.id, `asset-history?path=${encodeURIComponent(pkg)}`).then(setHist, (e: Error) =>
      setHistError(e.message),
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
  const diff = done.current.get(key)

  useEffect(() => {
    if (!hist || hist.vcs === 'none' || !to || done.current.has(key)) return
    setSince(Date.now())
    setFailed(null)
    // 换了版本也让这一次算完：结果记下，点回来直接显示
    ppost<AssetDiff>(project.id, 'asset-diff', { path: pkg, from, to }).then(
      (d) => {
        done.current.set(key, d)
        bump((n) => n + 1)
      },
      (e: Error) => setFailed({ key, msg: e.message }),
    )
    // 按要比的两边和「重新读」变化重取
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hist, nonce])

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

  const restore =
    pick === 'local' && to === 'live'
      ? (p: PropDiff) => {
          const objPath = diff?.blueprint ? `${pkg}.Default__${name}_C` : `${pkg}.${name}`
          op(project.id, 'set', { path: objPath, prop: p.name, value: p.a }).then(
            () => {
              toast.success(t('已改回旧值：在资源页点「保存」才写回文件'))
              done.current.delete(key)
              setNonce((n) => n + 1)
            },
            (e: Error) => toast.error(e.message),
          )
        }
      : undefined

  // 左栏小标签：这次打开里算过的（和上一版比的那一次）
  const tags: Record<string, ReactNode> = {}
  for (const [i, r] of revs.entries()) {
    const d = done.current.get(`${prevOf(i) ?? '∅'}|${r.id}`)
    if (d) tags[r.id] = <SummaryTags diff={d} />
  }
  if (hist) {
    const d = done.current.get(`${hist.base}|${editorOn ? side : 'disk'}`)
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
          <span className="ue:flex-1" />
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
      {failed?.key === key ? (
        <p className="ue:p-4 ue:text-body ue:whitespace-pre-wrap ue:text-danger">{failed.msg}</p>
      ) : !diff ? (
        !hist || hist.vcs === 'none' ? null : (
          <Loading since={since} />
        )
      ) : (
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
        />
      )}
    </VersionDiffShell>
  )
}
