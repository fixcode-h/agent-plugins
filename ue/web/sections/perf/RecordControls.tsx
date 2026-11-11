import { Bookmark, Circle, Square } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import type { Active } from './types.ts'

export type RecordKind = 'trace' | 'csv'

/** 录制预设（设计 3.4，默认「标准」）：键和服务端 perf.ts 的 TRACE_PRESETS 一致 */
export const PRESETS = [
  { value: 'standard', label: () => t('标准') },
  { value: 'named', label: () => t('标准 + 命名事件') },
  { value: 'loading', label: () => t('加载') },
  { value: 'memtag', label: () => t('内存标签') },
]

/**
 * 页头右侧的录制控件（设计 4.1 工具栏）。
 * 没在录：录什么（trace / 帧数据）+ trace 的预设 + 时长上限 + 录制、抓内存报告；
 * 在录：红点计时和进度条、书签输入（回车打书签）、停止。两种状态之间淡入切换。
 */
export function RecordControls({
  active,
  running,
  busy,
  onStart,
  onStop,
  onMark,
  onMemreport,
}: {
  active?: Active
  running: boolean
  busy: string
  onStart: (o: { kind: RecordKind; preset: string; seconds: number }) => void
  onStop: () => void
  onMark: (name: string) => Promise<unknown> | void
  onMemreport: () => void
}) {
  const { ui } = h()
  const [kind, setKind] = useState<RecordKind>('trace')
  const [preset, setPreset] = useState('standard')
  const [seconds, setSeconds] = useState('30')
  const [mark, setMark] = useState('')
  if (active)
    return (
      <div key="rec" className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:motion-safe:animate-fade">
        <RecordingPill active={active} />
        <form
          className="ue:flex ue:items-center ue:gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (mark.trim()) void Promise.resolve(onMark(mark)).then(() => setMark(''))
          }}
        >
          <ui.Input
            size="sm"
            className="ue:w-44"
            value={mark}
            placeholder={t('书签名，回车打书签')}
            onChange={(e: { target: { value: string } }) => setMark(e.target.value)}
          />
          <ui.IconButton
            icon={Bookmark}
            label={t('打书签')}
            size="sm"
            disabled={!mark.trim() || !!busy}
            onClick={() => void Promise.resolve(onMark(mark)).then(() => setMark(''))}
          />
        </form>
        <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={onStop}>
          <Square className="ue:h-3.5 ue:w-3.5" /> {t('停止')}
        </ui.Button>
      </div>
    )
  return (
    <div key="idle" className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:motion-safe:animate-fade">
      <ui.Select
        size="sm"
        className="ue:w-28"
        value={kind}
        onChange={(e: { target: { value: string } }) => setKind(e.target.value as RecordKind)}
        options={[
          { value: 'trace', label: t('trace') },
          { value: 'csv', label: t('帧数据（CSV）') },
        ]}
      />
      {kind === 'trace' && (
        <ui.Select
          size="sm"
          className="ue:w-40"
          value={preset}
          onChange={(e: { target: { value: string } }) => setPreset(e.target.value)}
          options={PRESETS.map((p) => ({ value: p.value, label: p.label() }))}
        />
      )}
      <ui.Select
        size="sm"
        className="ue:w-32"
        value={seconds}
        onChange={(e: { target: { value: string } }) => setSeconds(e.target.value)}
        options={['10', '30', '60', '120', '300'].map((v) => ({ value: v, label: t('最长 {n} 秒', { n: v }) }))}
      />
      <ui.Button
        size="sm"
        disabled={!running || !!busy}
        onClick={() => onStart({ kind, preset, seconds: Number(seconds) })}
      >
        <Circle className="ue:h-3.5 ue:w-3.5" /> {t('录制')}
      </ui.Button>
      <ui.Button size="sm" variant="secondary" disabled={!running || !!busy} onClick={onMemreport}>
        {busy === 'memreport' ? t('正在抓…') : t('抓内存报告')}
      </ui.Button>
    </div>
  )
}

/** 录制中的红点：脉动的点、秒数、进度条（进度条宽度平滑走） */
export function RecordingPill({ active }: { active: Active }) {
  const pct = Math.min(100, (active.elapsed / active.seconds) * 100)
  return (
    <span className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-lg ue:bg-danger/10 ue:px-3 ue:text-footnote ue:font-medium ue:text-danger">
      <span className="ue:relative ue:flex ue:h-2 ue:w-2">
        <span className="ue:absolute ue:inset-0 ue:rounded-full ue:bg-danger ue:opacity-60 ue:motion-safe:animate-ping" />
        <span className="ue:relative ue:h-2 ue:w-2 ue:rounded-full ue:bg-danger" />
      </span>
      <span>{active.kind === 'trace' ? 'trace' : 'CSV'}</span>
      <span className="ue:font-mono ue:tabular-nums">
        {Math.round(active.elapsed)} / {active.seconds} s
      </span>
      <span className="ue:h-1 ue:w-20 ue:overflow-hidden ue:rounded-full ue:bg-danger/15">
        <span
          className="ue:block ue:h-full ue:bg-danger ue:transition-[width] ue:duration-1000 ue:ease-linear"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  )
}
