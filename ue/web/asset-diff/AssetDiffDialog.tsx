import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { VersionDiffShell, type VersionPick } from '@panel/web/src/components/ui/version-diff'
import { diffEmpty } from '../../shared/asset-diff/diff.ts'
import type { AssetDiff, PropDiff } from '../../shared/asset-diff/types.ts'
import { op, pget, ppost } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { GraphPane } from './GraphPane.tsx'
import { ObjPane } from './ObjPane.tsx'
import { Mark } from './PropGrid.tsx'
import { closeAssetDiff, useAssetDiffTarget } from './store.ts'
import { VarsPane } from './VarsPane.tsx'

interface History {
  vcs: 'git' | 'p4' | 'svn' | 'none'
  base: string
  revs: { id: string; label: string; author: string; time: string; message: string }[]
  error?: string
  file: string
}

type Tab = 'props' | 'vars' | 'graph' | 'rows'

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

  // 有 Tab 没内容时（例如不是蓝图没有图表）回到第一个
  const tabs = diff ? tabsOf(diff) : []
  const curTab = tabs.some((x) => x.id === tab) ? tab : (tabs[0]?.id ?? 'props')

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
        <>
          <Notes diff={diff} />
          <nav className="ue:flex ue:h-9 ue:shrink-0 ue:items-center ue:gap-0.5 ue:border-b ue:border-line ue:px-2">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setTab(x.id)}
                className={h().cn(
                  'ue:inline-flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-md ue:px-2.5 ue:text-footnote ue:text-muted ue:hover:bg-hover',
                  curTab === x.id && 'ue:bg-sel ue:font-medium ue:text-fg ue:hover:bg-sel',
                )}
              >
                {x.label}
                {x.n > 0 && <span className="ue:text-caption ue:text-subtle">{x.n}</span>}
              </button>
            ))}
          </nav>
          {curTab === 'graph' ? (
            <GraphPane
              graphs={diff.graphs}
              only={only}
              onOpenGraph={
                editorOn
                  ? () =>
                      op(project.id, 'asset.open', { path: pkg }, { instance: 'editor' }).catch((e: Error) =>
                        toast.error(e.message),
                      )
                  : undefined
              }
            />
          ) : curTab === 'vars' ? (
            <VarsPane diff={diff} only={only} a={a} b={b} />
          ) : curTab === 'rows' ? (
            <ObjPane mode="rows" objs={diff.rows} assetName={name} only={only} a={a} b={b} />
          ) : (
            <ObjPane
              mode={diff.blueprint ? 'blueprint' : 'asset'}
              self={diff.defaults}
              objs={diff.blueprint ? diff.components : diff.subobjects}
              assetName={name}
              only={only}
              a={a}
              b={b}
              onRestore={restore}
            />
          )}
        </>
      )}
    </VersionDiffShell>
  )
}

function tabsOf(d: AssetDiff): { id: Tab; label: string; n: number }[] {
  const s = d.stats
  const objs = d.blueprint ? d.components : d.subobjects
  const props = d.defaults.count + objs.filter((o) => o.change !== 'same').length
  return [
    { id: 'props', label: d.blueprint ? t('类默认值与组件') : t('属性'), n: props },
    ...(d.rows.length ? [{ id: 'rows' as const, label: t('行'), n: s.rows }] : []),
    ...(d.blueprint || d.settings.length
      ? [{ id: 'vars' as const, label: d.blueprint ? t('变量与设置') : t('设置'), n: s.vars + s.settings }]
      : []),
    ...(d.blueprint ? [{ id: 'graph' as const, label: t('蓝图图表'), n: s.graphs }] : []),
  ]
}

/** 摘要小标签：头部的能点（跳到对应页签），左栏的只看 */
function SummaryTags({ diff, onTab }: { diff: AssetDiff; onTab?: (t: Tab) => void }) {
  const s = diff.stats
  const tag = (kind: 'add' | 'del' | 'mod', text: string, tab: Tab) =>
    onTab ? (
      <button key={text} type="button" className="ue:cursor-pointer" onClick={() => onTab(tab)}>
        <Mark kind={kind}>{text}</Mark>
      </button>
    ) : (
      <Mark key={text} kind={kind}>
        {text}
      </Mark>
    )
  if (diff.created) return <Mark kind="add">{t('新建')}</Mark>
  if (diff.deleted) return <Mark kind="del">{t('删掉了')}</Mark>
  if (diffEmpty(diff))
    return (
      <span className="ue:rounded-(--c-badge-radius) ue:bg-sel ue:px-1.5 ue:text-caption ue:text-subtle">
        {t('结构没变')}
      </span>
    )
  return (
    <span className="ue:flex ue:flex-wrap ue:items-center ue:gap-1">
      {s.props > 0 && tag('mod', t('属性 {n}', { n: s.props }), 'props')}
      {s.compAdd > 0 && tag('add', t('组件 +{n}', { n: s.compAdd }), 'props')}
      {s.compDel > 0 && tag('del', t('组件 −{n}', { n: s.compDel }), 'props')}
      {s.rows > 0 && tag('mod', t('行 {n}', { n: s.rows }), 'rows')}
      {s.vars + s.settings > 0 && tag('mod', t('变量与设置 {n}', { n: s.vars + s.settings }), 'vars')}
      {s.graphs > 0 && tag('mod', t('图 {n}', { n: s.graphs }), 'graph')}
    </span>
  )
}

function Notes({ diff }: { diff: AssetDiff }) {
  const lines = [
    diff.created && t('这一版新建了这个资源：下面都算新加'),
    diff.deleted && t('这一版里没有这个资源了（删掉或改名）：下面是旧版的内容'),
    !diff.created &&
      !diff.deleted &&
      diffEmpty(diff) &&
      t(
        '两版的结构一模一样：这一版可能只是重新保存（引擎升级、批量重存），或者改的是快照不包含的东西（节点位置、缩略图）',
      ),
    ...diff.notes,
  ].filter(Boolean)
  if (!lines.length) return null
  return (
    <div className="ue:shrink-0 ue:border-b ue:border-line ue:bg-sel ue:px-3 ue:py-1.5 ue:text-footnote ue:text-muted">
      {lines.map((l) => (
        <p key={String(l)}>{l}</p>
      ))}
    </div>
  )
}

/** 读取中：第一次要起后台编辑器，等得比较久，显示已经等了多久 */
function Loading({ since }: { since?: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const sec = since ? Math.round((Date.now() - since) / 1000) : 0
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:p-6 ue:text-body">
      <span className="ue:flex ue:items-center ue:gap-2">
        <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
        {t('取出两版文件，在编辑器里读出组件、类默认值、变量和图表…')}
        {sec > 2 && <span className="ue:text-caption ue:text-subtle">{t('已等 {n} 秒', { n: sec })}</span>}
      </span>
      <span className="ue:text-footnote ue:text-subtle">
        {t('编辑器没开时第一次要起后台编辑器（约 20–60 秒）；读过的版本按文件内容记在数据目录，再看不用重读')}
      </span>
    </div>
  )
}
