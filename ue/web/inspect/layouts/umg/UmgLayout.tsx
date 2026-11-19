import { useMemo, useRef, useState } from 'react'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { Timeline, type KeyRef } from '../../../timeline/Timeline.tsx'
import { Badge, ErrorText } from '../../../ui.tsx'
import { CommonActions } from '../common.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { AnimList } from './AnimList.tsx'
import { animatedProps, animGroups } from './anim-tracks.ts'
import './builtin-views.tsx'
import { Designer } from './Designer.tsx'
import { KeyDetails } from './KeyDetails.tsx'
import { indexTree } from './model.ts'
import { NodeDetails } from './NodeDetails.tsx'
import { useUmgData, type Source } from './use-umg.ts'
import { DESIGNER, designerLabel, umgViews } from './views.ts'
import { UmgHead } from './UmgHead.tsx'
import { WidgetTree } from './WidgetTree.tsx'

/**
 * 控件蓝图的查看页（设计稿第 4 节、效果图 U1–U4）：
 * 左上控件树、左下动画列表、中间设计器、右边选中控件的细节（选中关键帧时换成关键帧）、底部动画时间轴；
 * 页头切视图（设计器 / 图表 / 配置原文 / 摘要与引用，视图表在 views.ts）。
 * 数据先问 UE（umg.design / umg.anims / umg.render），问不了按 AssetForge 配置画近似预览（use-umg.ts）。
 * 只读：控件属性能在右栏的真实细节面板里改（和资源页一样），动画第一期只看。
 */
export function UmgLayout(p: LayoutProps) {
  const { path, layout, config, offline, onOpen, hint, marks } = p
  const { project } = useUe()
  const data = useUmgData(path, config, offline)
  const [view, setView] = useKept<string>(`${project.id}/umg/view`, DESIGNER)
  const [selected, setSelected] = useState<string>()
  const [reveal, setReveal] = useState<{ key: string; seq: number }>()
  const seq = useRef(0)
  const [animName, setAnimName] = useState<string>()
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useKept(`${project.id}/umg/loop`, false)
  const [keySel, setKeySel] = useState<KeyRef>()

  const idx = useMemo(() => indexTree(data.tree), [data.tree])
  const anim = data.anims.find((a) => a.name === animName) ?? data.anims[0]
  const groups = useMemo(() => animGroups(anim, idx), [anim, idx])
  const animated = useMemo(() => animatedProps(anim, idx, selected), [anim, idx, selected])
  const node = selected ? idx.byKey.get(selected) : undefined
  const live = data.source === 'ue' && !offline

  const extra = umgViews().filter((v) => !v.when || v.when({ offline, data }))
  const cur = view === DESIGNER || extra.some((v) => v.id === view) ? view : DESIGNER
  const ExtraView = extra.find((v) => v.id === cur)?.View
  const srcLabel = (s: Source) => (s === 'ue' ? 'UE' : s === 'config' ? t('配置') : '')
  const select = (key: string, fromPreview = false) => {
    setSelected(key)
    setKeySel(undefined)
    if (fromPreview) setReveal({ key, seq: ++seq.current })
  }

  const head = (
    <>
      {/* 页头：名字、视图切换、通用按钮；数据来源和出错写在下面一行 */}
      <UmgHeadBar
        p={p}
        parent={data.parent}
        offline={offline}
        view={cur}
        views={[{ id: DESIGNER, label: designerLabel() }, ...extra.map((v) => ({ id: v.id, label: v.label() }))]}
        onView={setView}
      />
      {data.error && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-1.5">
          <ErrorText>{data.error}</ErrorText>
        </div>
      )}
    </>
  )

  if (cur !== DESIGNER && ExtraView)
    return (
      <LayoutShell
        layout={layout}
        head={head}
        regions={{}}
        center={
          <ExtraView
            path={path}
            onOpen={onOpen}
            onChanged={p.onChanged}
            offline={offline}
            data={data}
            selectWidget={(key) => {
              setView(DESIGNER)
              select(key, true)
            }}
          />
        }
      />
    )

  return (
    <LayoutShell
      layout={layout}
      head={head}
      regions={{
        tree: (
          <WidgetTree
            tree={data.tree}
            selected={selected}
            onSelect={(k) => select(k)}
            reveal={reveal}
            source={srcLabel(data.source)}
          />
        ),
        anims: (
          <AnimList
            anims={data.anims}
            current={anim?.name}
            onPick={(name) => {
              setAnimName(name)
              setTime(0)
              setPlaying(false)
              setKeySel(undefined)
            }}
            source={srcLabel(data.animSource)}
          />
        ),
        details:
          keySel && anim ? (
            <KeyDetails anim={anim} groups={groups} sel={keySel} time={time} onBack={() => setKeySel(undefined)} />
          ) : (
            <NodeDetails
              node={node}
              parent={selected ? idx.parent.get(selected) : undefined}
              live={live}
              path={path}
              onOpen={onOpen}
              hint={hint}
              marks={marks}
              animated={animated}
              animName={anim?.name}
            />
          ),
        timeline: (
          <Timeline
            title={
              <span className="ue:truncate">
                {t('动画')}
                {anim && (
                  <span className="ue:ml-2 ue:text-footnote ue:font-normal ue:text-subtle">
                    {anim.name} · {anim.length.toFixed(2)}s · 60 fps
                  </span>
                )}
              </span>
            }
            aside={
              <>
                {(anim?.skipped || data.animsTruncated) && (
                  <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-warning" title={anim?.skipped}>
                    {data.animsTruncated
                      ? t('关键帧太多，只读到了一部分')
                      : t('有轨道读不出来，没显示：{s}', { s: anim?.skipped ?? '' })}
                  </span>
                )}
                {data.animSource === 'config' && <Badge>{t('来自配置 animations')}</Badge>}
              </>
            }
            groups={groups}
            length={anim?.length ?? 0}
            time={time}
            onTime={setTime}
            playing={playing}
            onPlaying={setPlaying}
            loop={loop}
            onLoop={setLoop}
            selectedKey={keySel}
            onSelectKey={(k) => {
              setKeySel(k)
              if (k) setSelected(k.group)
            }}
            empty={t('这个控件蓝图没有动画；动画写在 AssetForge 配置的 animations 段里，导入后在这里看')}
          />
        ),
      }}
      center={
        <Designer
          path={path}
          tree={data.tree}
          live={data.canRender}
          selected={selected}
          onSelect={(k) => select(k, true)}
          anim={anim}
          time={time}
        />
      }
    />
  )
}

/** 页头一行（单拆出来让 UmgLayout 短一点）：资源还没生成时标「按配置预览」 */
function UmgHeadBar({
  p,
  parent,
  offline,
  view,
  views,
  onView,
}: {
  p: LayoutProps
  parent?: string
  offline?: boolean
  view: string
  views: { id: string; label: string }[]
  onView: (id: string) => void
}) {
  return (
    <UmgHead
      path={p.path}
      parent={parent}
      badge={offline ? <Badge tone="warn">{t('资源还没生成 · 按配置预览')}</Badge> : undefined}
      view={view}
      views={views}
      onView={onView}
      actions={offline ? undefined : <CommonActions path={p.path} />}
    />
  )
}
