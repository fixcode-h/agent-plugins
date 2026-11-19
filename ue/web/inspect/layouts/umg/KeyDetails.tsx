import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { Details } from '../../../details/Details.tsx'
import type { Prop } from '../../../details/model.ts'
import { h, t } from '../../../host.ts'
import { fmtSec, fmtValue, valueAt, type Anim } from '../../../timeline/keys.ts'
import type { KeyRef, TlGroup } from '../../../timeline/Timeline.tsx'
import { Card } from '../../../ui.tsx'
import { readOnlyApi } from './preview-api.ts'

/**
 * 选中关键帧时的右栏（设计稿第 4 节）：这个关键帧的时间（秒和帧）、值、插值，以及播放头这一刻各轨道的值。
 * 用同一个细节面板画（分类、搜索、名字列宽都一样），全部只读：第一期动画只读，改走配置
 */
export function KeyDetails({
  anim,
  groups,
  sel,
  time,
  fps = 60,
  onBack,
}: {
  anim: Anim
  groups: TlGroup[]
  sel: KeyRef
  time: number
  fps?: number
  onBack: () => void
}) {
  const { ui } = h()
  const g = groups.find((x) => x.id === sel.group)
  const ch = g?.channels.find((c) => c.id === sel.channel)
  const k = ch?.keys[sel.index]
  const why = t('动画只读：要改就改配置的 animations 段，或在 UE 里改完「导出到配置」')
  const props = useMemo(() => {
    const ro = { readOnly: true, readOnlyWhy: why, edit: true }
    const keyCat = t('关键帧')
    const nowCat = t('当前时刻 {t}', { t: fmtSec(time) })
    const out: Prop[] = k
      ? [
          { name: 'Target', displayName: t('控件'), type: 'FString', category: keyCat, value: g?.label ?? '', ...ro },
          { name: 'Channel', displayName: t('通道'), type: 'FString', category: keyCat, value: ch?.label ?? '', ...ro },
          {
            name: 'Time',
            displayName: t('时间'),
            type: 'FString',
            category: keyCat,
            value: `${fmtSec(k.time, 3)} · ${t('第 {n} 帧 @ {fps}fps', { n: Math.round(k.time * fps), fps })}`,
            ...ro,
          },
          { name: 'Value', displayName: t('值'), type: 'FString', category: keyCat, value: fmtValue(k.value), ...ro },
          { name: 'Interp', displayName: t('插值'), type: 'FString', category: keyCat, value: k.interp, ...ro },
        ]
      : []
    for (const gr of groups)
      for (const c of gr.channels)
        out.push({
          name: `${gr.id}#${c.id}`,
          displayName: `${gr.label} · ${c.label}`,
          type: 'FString',
          category: nowCat,
          value: fmtValue(valueAt(c.keys, time)),
          ...ro,
        })
    return out
  }, [k, g, ch, groups, time, fps, why])
  const api = useMemo(() => readOnlyApi(), [])
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={t('关键帧')}
      aside={
        <ui.Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="ue:h-3.5 ue:w-3.5" /> {t('回到控件细节')}
        </ui.Button>
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      <p className="ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">
        {anim.name} · {fmtSec(anim.length)}
      </p>
      <Details props={props} api={api} />
    </Card>
  )
}
