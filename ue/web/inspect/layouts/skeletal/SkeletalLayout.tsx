import { Bell, PersonStanding, Spline } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { Timeline, type KeyRef, type TlGroup } from '../../../timeline/Timeline.tsx'
import { Badge } from '../../../ui.tsx'
import { isA } from '../pick.ts'
import { DetailsCard } from '../preview/DetailsCard.tsx'
import { refPath, shortName } from '../preview/model.ts'
import { AssetHead, InfoCard } from '../preview/parts.tsx'
import { PreviewPane } from '../preview/PreviewPane.tsx'
import { useAssetDesc, usePreviewView, usePropMap } from '../preview/use-asset.ts'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { animCurves, animGroups, animLength, animNotifies } from './model.ts'
import { SkeletalInfo } from './SkeletalInfo.tsx'

/**
 * 骨骼网格和动画序列（设计稿第 3 节、效果图 B6，两种共用一套布局）：
 * 左资源信息（骨骼、插槽、统计）、中间 UE 渲染的视口（asset.preview；动画序列 UE 现在不支持，原样显示 UE 给的原因）、
 * 右细节（左栏选了插槽看插槽）；动画序列底部是共用时间轴，显示通知和（读得到的）曲线，只读。
 * 拖播放头时 UE 按帧渲染姿势要新接口，现在视口不跟着播放头变
 */
export function SkeletalLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks, info } = p
  const { project } = useUe()
  const [view, setView] = usePreviewView()
  const d = useAssetDesc(path)
  const props = usePropMap(path)
  const anim = isA(info, 'AnimSequenceBase') || /^Anim/.test(d.desc?.class ?? info.cls ?? '')
  const [picked, setPicked] = useState({ path, sub: '' })
  const sub = picked.path === path ? picked.sub : ''
  const skeleton = refPath(props.map?.Skeleton ?? d.desc?.tags?.Skeleton)

  return (
    <LayoutShell
      layout={layout}
      head={
        <AssetHead
          path={path}
          icon={PersonStanding}
          cls={d.desc?.class ?? info.cls}
          badges={
            skeleton && skeleton !== 'None' ? (
              <Badge title={skeleton}>{t('骨骼 {s}', { s: shortName(skeleton) })}</Badge>
            ) : undefined
          }
          view={view}
          onView={setView}
        />
      }
      regions={{
        info: (
          <SkeletalInfo
            desc={d.desc}
            props={props.map}
            error={d.error}
            online={d.online}
            picked={sub}
            onPick={(s) => setPicked({ path, sub: s })}
            onOpen={(x) => onOpen(x, t('资源信息'))}
          />
        ),
        details: (
          <DetailsCard
            path={path}
            sub={sub}
            onBack={() => setPicked({ path, sub: '' })}
            onOpen={onOpen}
            hint={hint}
            marks={marks}
          />
        ),
        timeline: anim ? (
          <AnimTimeline key={path} project={project.id} map={props.map} tags={d.desc?.tags} error={props.error} />
        ) : null,
      }}
      center={
        view === 'info' ? (
          <InfoCard path={path} onOpen={onOpen} />
        ) : (
          <PreviewPane path={path} icon={PersonStanding} title={t('视口')} />
        )
      }
    />
  )
}

/** 动画序列底部的时间轴（共用 Timeline）：通知按轨道、曲线一条一行；播放只走播放头（视口不跟着变，见上） */
function AnimTimeline({
  project,
  map,
  tags,
  error,
}: {
  project: string
  map?: Record<string, unknown>
  tags?: Record<string, string>
  error: string
}) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useKept(`${project}/anim/loop`, true)
  const [sel, setSel] = useState<KeyRef>()
  const notifies = useMemo(() => animNotifies(map), [map])
  const curves = useMemo(() => animCurves(map), [map])
  const length = animLength(map, tags, notifies, curves)
  const groups: TlGroup[] = useMemo(
    () =>
      animGroups(notifies, curves, {
        notify: t('通知'),
        track: (n) => t('轨道 {n}', { n }),
        curve: t('曲线'),
      }).map((g) => ({ ...g, icon: g.id === 'notifies' ? Bell : Spline })),
    [notifies, curves],
  )
  return (
    <Timeline
      title={
        <span className="ue:truncate">
          {t('时间轴')}
          <span className="ue:ml-2 ue:text-footnote ue:font-normal ue:text-subtle">
            {t('通知 {n} · 曲线 {m}', { n: notifies.length, m: curves.length })} · {length.toFixed(2)} s
          </span>
        </span>
      }
      aside={
        error ? (
          <span className="ue:truncate ue:text-footnote ue:text-danger">{error}</span>
        ) : (
          <span className="ue:truncate ue:text-footnote ue:text-subtle">
            {t('视口不跟播放头：按帧渲染姿势要 UELink 新接口')}
          </span>
        )
      }
      groups={groups}
      length={length}
      fps={30}
      time={time}
      onTime={setTime}
      playing={playing}
      onPlaying={setPlaying}
      loop={loop}
      onLoop={setLoop}
      selectedKey={sel}
      onSelectKey={setSel}
      empty={t('这段动画没有通知；曲线在 UE 5 的动画数据模型里，props 读不到（要 UELink 导出动画曲线的接口）')}
    />
  )
}
