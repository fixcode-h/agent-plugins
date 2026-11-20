import { useEffect, useState } from 'react'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { Card } from '../../../ui.tsx'
import { assetName, InfoView } from '../common.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { BpDetails } from './BpDetails.tsx'
import { BpHead } from './BpHead.tsx'
import { CompPanel } from './CompPanel.tsx'
import { GraphPane } from './GraphPane.tsx'
import { closeTab, defaultGraph, openTab, resolveView, type BpView } from './model.ts'
import { MyBlueprint } from './MyBlueprint.tsx'
import { useBpData } from './use-bp.ts'

/** 图表页签：按资源记（切资源就换一套） */
interface Tabs {
  path: string
  list: string[]
  active: string
}

/**
 * 蓝图的查看页（设计稿第 3 节 Actor 行、效果图 A1–A4）：
 * 左上组件树、左下「我的蓝图」、中间切图表 / 类默认值 / 摘要与引用、右边细节。
 * - 组件树选组件 → 右栏组件细节；点「自身」或页头「类默认值」→ 右栏类默认值（两处联动），中间的图表不动；
 * - 「我的蓝图」点图 / 函数 / 宏 → 中间图表页签里打开；图表里点节点 → 右栏看节点引脚；
 * - 动画蓝图、函数库没有组件：不显示组件树，直接看图表；UE 没连上时各块说明原因（A4）。
 * 不放视口（用户 2026-11-20：「Actor不显示视口，直接显示图表就行」），默认进图表
 */
export function BlueprintLayout(p: LayoutProps) {
  const { path, comp, onComp, onOpen, onChanged, hint, marks, layout } = p
  const { project } = useUe()
  const data = useBpData(path)
  const [want, setView] = useKept<string>(`${project.id}/bp/view`, 'graph')
  const [tabs, setTabs] = useState<Tabs>({ path, list: [], active: '' })
  const [node, setNode] = useState('')
  const cur: Tabs = tabs.path === path ? tabs : { path, list: [], active: '' }
  // 没打开过图：大纲读回来后默认开事件图
  const first = defaultGraph(data.outline)
  const list = cur.list.length ? cur.list : first ? [first] : []
  const active = cur.active || list[0] || ''

  const actor = data.comps === null ? (data.online ? false : undefined) : data.comps === undefined ? undefined : true
  const view = resolveView(want, actor)
  const picked = data.comps?.find((c) => c.path === comp)

  // 刷新、切回来后选中的组件没了：回到资源本身
  useEffect(() => {
    if (comp && data.comps !== undefined && !data.comps?.some((c) => c.path === comp)) onComp('')
    // 只在组件读回来时判断
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [data.comps])

  const pickView = (v: BpView) => {
    setView(v)
    if (v === 'defaults') onComp('')
    if (v !== 'graph') setNode('')
  }
  const pickComp = (c: string) => {
    onComp(c)
    setNode('')
    // 选组件只换右栏（组件属性 / 「自身」= 类默认值），中间的图表不动（视口已去掉，用户 2026-11-20）
  }
  const openGraph = (name: string) => {
    setTabs({ path, list: openTab(list, name), active: name })
    setNode('')
    setView('graph')
  }
  const close = (name: string) => {
    const r = closeTab(list, name, active)
    setTabs({ path, list: r.tabs, active: r.active })
    setNode('')
  }

  const center =
    view === 'graph' ? (
      <GraphPane
        path={path}
        outline={data.outline}
        tabs={list}
        active={active}
        onActive={(name) => {
          setTabs({ path, list, active: name })
          setNode('')
        }}
        onClose={close}
        picked={node}
        onPick={setNode}
        onCompiled={() => {
          data.reload()
          onChanged?.()
        }}
      />
    ) : view === 'info' ? (
      <Card
        className="ue:min-h-0 ue:flex-1"
        title={t('摘要与引用')}
        bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto"
      >
        <InfoView path={path} onOpen={onOpen} />
      </Card>
    ) : (
      <Card className="ue:min-h-0 ue:flex-1" title={t('类默认值')} bodyClass="ue:p-4 ue:text-caption ue:text-subtle">
        {t('类默认值显示在右侧细节面板里；在左边组件树选组件看组件属性')}
      </Card>
    )

  return (
    <LayoutShell
      layout={layout}
      head={
        <BpHead
          path={path}
          outline={data.outline}
          online={data.online}
          actor={actor !== false}
          view={view}
          onView={pickView}
        />
      }
      regions={{
        comps: actor !== false && (
          <CompPanel
            name={assetName(path)}
            items={data.comps}
            online={data.online}
            selected={comp}
            onSelect={pickComp}
          />
        ),
        mybp: (
          <MyBlueprint
            outline={data.outline}
            error={data.outlineError}
            online={data.online}
            active={view === 'graph' ? active : undefined}
            onGraph={openGraph}
          />
        ),
        details: (
          <BpDetails
            path={path}
            comp={view === 'defaults' ? undefined : picked}
            node={view === 'graph' ? node : ''}
            onNode={setNode}
            onOpen={onOpen}
            hint={hint}
            marks={marks}
          />
        ),
      }}
      center={center}
    />
  )
}
