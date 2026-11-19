import type { AnimKey } from '../../../timeline/keys.ts'

/**
 * 骨骼网格 / 动画序列布局（设计稿第 3 节、效果图 B6）的纯数据部分：从 props 读出动画通知和曲线（给共用时间轴），
 * 从子对象里挑出插槽。UELink 没有骨骼层级、动画姿势的接口：骨骼树和按播放头渲染的视口做不了，只列能拿到的。
 * 不带 React，单测（skeletal.test.ts）直接 import。
 */

export interface Notify {
  name: string
  time: number
  /** 通知状态（NotifyState）有持续时间 */
  duration: number
  track: number
}

export interface Curve {
  name: string
  keys: AnimKey[]
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN)
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
/** 对象引用 /Script/Engine.AnimNotify_PlaySound 或 Class'/Game/AN_Step.AN_Step_C' → AnimNotify_PlaySound / AN_Step */
const clsName = (v: unknown) =>
  typeof v === 'string' && v && v !== 'None'
    ? (v
        .replace(/'$/, '')
        .split(/[./:']/)
        .pop()
        ?.replace(/_C$/, '') ?? '')
    : ''

/**
 * 动画通知（UAnimSequenceBase::Notifies，FAnimNotifyEvent）：时间取 LinkValue（UE 5 的链接时间），
 * 旧数据退到 DisplayTime_DEPRECATED / Time；名字取 NotifyName，没有（None）时用通知类名
 */
export function animNotifies(map: Record<string, unknown> | undefined): Notify[] {
  const out: Notify[] = []
  for (const n of list(map?.Notifies)) {
    const time = [n.LinkValue, n.Time, n.DisplayTime_DEPRECATED, n.SegmentBeginTime].map(num).find(Number.isFinite)
    if (time === undefined) continue
    const nm = typeof n.NotifyName === 'string' && n.NotifyName !== 'None' ? n.NotifyName : ''
    const name = nm || clsName(n.NotifyStateClass) || clsName(n.Notify) || 'Notify'
    const duration = num(n.Duration)
    out.push({
      name,
      time,
      duration: Number.isFinite(duration) ? duration : 0,
      track: Number.isFinite(num(n.TrackIndex)) ? num(n.TrackIndex) : 0,
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** 曲线名：FSmartName {DisplayName}、FName 字符串、或 CurveName 字段 */
function curveName(c: Record<string, unknown>): string {
  const n = c.CurveName ?? c.Name
  if (typeof n === 'string') return n
  if (n && typeof n === 'object') return String((n as Record<string, unknown>).DisplayName ?? '')
  return ''
}

/**
 * 浮点曲线（RawCurveData.FloatCurves，FFloatCurve 的 FloatCurve.Keys）。UE 5.2 起曲线在动画数据模型里，
 * props 多半读不到，读不到就是空数组（界面写明）
 */
export function animCurves(map: Record<string, unknown> | undefined): Curve[] {
  const raw = map?.RawCurveData as Record<string, unknown> | undefined
  const out: Curve[] = []
  for (const c of list(raw?.FloatCurves)) {
    const rc = (c.FloatCurve ?? c.Curve) as Record<string, unknown> | undefined
    const keys: AnimKey[] = []
    for (const k of list(rc?.Keys)) {
      const time = num(k.Time)
      if (!Number.isFinite(time)) continue
      const mode = String(k.InterpMode ?? '')
      keys.push({
        time,
        value: num(k.Value),
        interp: /Constant/i.test(mode) ? 'constant' : /Linear/i.test(mode) ? 'linear' : 'cubic',
      })
    }
    const name = curveName(c)
    if (name) out.push({ name, keys })
  }
  return out
}

/** 动画长度（秒）：SequenceLength（属性或注册表标签），都没有按最后一个通知 / 关键帧 */
export function animLength(
  map: Record<string, unknown> | undefined,
  tags: Record<string, string> | undefined,
  notifies: Notify[],
  curves: Curve[],
): number {
  for (const v of [map?.SequenceLength, map?.PlayLength, tags?.SequenceLength, tags?.PlayLength]) {
    const n = num(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  const ends = [...notifies.map((n) => n.time + n.duration), ...curves.flatMap((c) => c.keys.map((k) => k.time))]
  return ends.length ? Math.max(...ends) : 0
}

/** 时间轴的分组（形状和共用 Timeline 的 TlGroup 一样）：通知按轨道一行，曲线一条一行 */
export interface AnimGroup {
  id: string
  label: string
  channels: { id: string; label: string; keys: AnimKey[] }[]
}

export function animGroups(
  notifies: Notify[],
  curves: Curve[],
  labels: { notify: string; track: (n: number) => string; curve: string },
): AnimGroup[] {
  const out: AnimGroup[] = []
  if (notifies.length) {
    const tracks = [...new Set(notifies.map((n) => n.track))].sort((a, b) => a - b)
    out.push({
      id: 'notifies',
      label: labels.notify,
      channels: tracks.map((tr) => ({
        id: `track${tr}`,
        label: labels.track(tr + 1),
        // 通知是一个时刻，值写名字（悬停和选中时看得到）；通知状态把结束也标一个点
        keys: notifies
          .filter((n) => n.track === tr)
          .flatMap((n): AnimKey[] => [
            { time: n.time, value: n.name, interp: 'constant' },
            ...(n.duration > 0
              ? [{ time: n.time + n.duration, value: `${n.name} ⟩`, interp: 'constant' as const }]
              : []),
          ]),
      })),
    })
  }
  if (curves.length)
    out.push({
      id: 'curves',
      label: labels.curve,
      channels: curves.map((c) => ({ id: c.name, label: c.name, keys: c.keys })),
    })
  return out
}

/** 骨骼网格的插槽（子对象里的 SkeletalMeshSocket）：名字是子对象名的最后一段 */
export function sockets(subs: { path: string; name: string; class: string }[] | undefined) {
  return (subs ?? [])
    .filter((s) => /Socket$/.test(s.class))
    .map((s) => ({ path: s.path, name: s.name.split(/[.:]/).pop() ?? s.name }))
}
