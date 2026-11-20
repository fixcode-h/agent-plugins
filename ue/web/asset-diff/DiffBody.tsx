import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { diffEmpty } from '../../shared/asset-diff/diff.ts'
import type { AssetDiff, PropDiff } from '../../shared/asset-diff/types.ts'
import { op } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { GraphPane } from './GraphPane.tsx'
import { ObjPane } from './ObjPane.tsx'
import { Mark } from './PropGrid.tsx'
import { VarsPane } from './VarsPane.tsx'

export type Tab = 'props' | 'vars' | 'graph' | 'rows'

/**
 * 一份资源差异的正文（说明条、页签、属性 / 变量 / 图表 / 行）：「版本差异」弹窗和资源页的「改动」页共用，
 * 两边只是比的东西不同（弹窗选版本，改动页固定比磁盘上 → 编辑器里）
 */
export function DiffBody({
  pkg,
  diff,
  only,
  tab,
  onTab,
  a,
  b,
  editorOn,
  onRestore,
}: {
  pkg: string
  diff: AssetDiff
  only: boolean
  tab: Tab
  onTab: (t: Tab) => void
  /** 两边的名字（表头用） */
  a: string
  b: string
  editorOn: boolean
  /** 行尾「改回旧值」：只有新的一边是编辑器里那份时才给 */
  onRestore?: (p: PropDiff) => void
}) {
  const { project } = useUe()
  const { toast } = h()
  const name = pkg.split('/').pop() ?? pkg
  const setTab = onTab
  const restore = onRestore
  // 有 Tab 没内容时（例如不是蓝图没有图表）回到第一个
  const tabs = tabsOf(diff)
  const curTab = tabs.some((x) => x.id === tab) ? tab : (tabs[0]?.id ?? 'props')
  return (
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
  )
}

export function tabsOf(d: AssetDiff): { id: Tab; label: string; n: number }[] {
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
export function SummaryTags({ diff, onTab }: { diff: AssetDiff; onTab?: (t: Tab) => void }) {
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
export function Loading({ since }: { since?: number }) {
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
