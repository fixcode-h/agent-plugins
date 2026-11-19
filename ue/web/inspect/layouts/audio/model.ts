/**
 * 音频布局（效果图 B7）的纯数据：从注册表标签和属性里挑出时长、采样率、声道这些（字段名在不同 UE 版本里不一样，按候选挨个找），
 * SoundCue 的声音节点从子对象里挑。单测在 audio.test.ts
 */

export interface AudioFact {
  key: string
  value: string
}

const pick = (srcs: (Record<string, unknown> | undefined)[], names: string[]) => {
  for (const s of srcs)
    for (const n of names) {
      const v = s?.[n]
      if (v !== undefined && v !== null && v !== '') return v
    }
  return undefined
}

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v))

/** 时长（秒）、采样率、声道、压缩质量、循环：拿得到的才列 */
export function audioFacts(tags?: Record<string, string>, props?: Record<string, unknown>): AudioFact[] {
  const src = [props, tags]
  const out: AudioFact[] = []
  const dur = n(pick(src, ['Duration']))
  if (Number.isFinite(dur) && dur > 0 && dur < 1e6) out.push({ key: 'duration', value: `${dur.toFixed(3)} s` })
  else if (Number.isFinite(dur) && dur >= 1e6) out.push({ key: 'duration', value: '∞' })
  const rate = n(pick(src, ['SampleRate', 'ImportedSampleRate']))
  if (Number.isFinite(rate) && rate > 0) out.push({ key: 'rate', value: `${rate} Hz` })
  const ch = n(pick(src, ['NumChannels', 'Channels']))
  if (Number.isFinite(ch) && ch > 0) out.push({ key: 'channels', value: String(ch) })
  const q = pick(src, ['CompressionQuality'])
  if (q !== undefined) out.push({ key: 'quality', value: String(q) })
  const loop = pick(src, ['bLooping', 'Looping'])
  if (loop !== undefined) out.push({ key: 'loop', value: String(loop) })
  return out
}

/** SoundCue 的声音节点（子对象 SoundNodeWavePlayer、SoundNodeMixer…）：类型去掉 SoundNode 前缀 */
export function soundNodes(subs: { path: string; name: string; class: string }[] | undefined) {
  return (subs ?? [])
    .filter((s) => s.class.startsWith('SoundNode'))
    .map((s) => ({
      path: s.path,
      type: s.class.slice('SoundNode'.length) || s.class,
      name: s.name.split(/[.:]/).pop() ?? s.name,
    }))
}
