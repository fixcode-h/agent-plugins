import { Bookmark, Circle, SlidersHorizontal, Square } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { h, t } from '../../host.ts'
import type { Active } from './types.ts'

export type RecordKind = 'trace' | 'csv'
export interface StartOpts {
  kind: RecordKind
  preset: string
  /** 0 = 不限时长（网页上一律不限，用户 2026-11-11），点停止才停 */
  seconds: number
  channels?: string
  named?: boolean
}

/** 录制预设（设计 3.4，默认「标准」）：键和服务端 perf.ts 的 TRACE_PRESETS 一致；custom 是自己勾通道 */
export const PRESETS = [
  { value: 'standard', label: () => t('标准') },
  { value: 'named', label: () => t('标准 + 命名事件') },
  { value: 'loading', label: () => t('加载') },
  { value: 'memtag', label: () => t('内存标签') },
  { value: 'custom', label: () => t('自定义…') },
]

/**
 * 自定义录制能勾的通道（服务端 perf.ts 的 TRACE_CHANNELS）。名字是引擎 Trace 通道名，说明写给人看：
 * 哪些要特定启动参数、哪些开销大，勾之前心里有数。
 */
const CHANNELS: { key: string; label: () => string; note?: () => string; group: () => string }[] = [
  { key: 'cpu', label: () => t('CPU 作用域'), note: () => t('时间轴和计时器的来源'), group: () => t('计时') },
  { key: 'gpu', label: () => t('GPU'), group: () => t('计时') },
  { key: 'frame', label: () => t('帧'), note: () => t('帧条'), group: () => t('计时') },
  { key: 'task', label: () => t('任务图'), note: () => t('Task Graph 任务的依赖和等待'), group: () => t('计时') },
  { key: 'region', label: () => t('区间'), note: () => t('Timing Regions'), group: () => t('计时') },
  { key: 'contextswitch', label: () => t('线程切换'), note: () => t('要管理员权限'), group: () => t('计时') },
  { key: 'bookmark', label: () => t('书签'), group: () => t('事件') },
  { key: 'log', label: () => t('日志'), group: () => t('事件') },
  { key: 'counters', label: () => t('计数器'), group: () => t('事件') },
  { key: 'stats', label: () => t('stat 统计'), note: () => t('stat 命令里的数值'), group: () => t('事件') },
  { key: 'screenshot', label: () => t('截图'), note: () => t('Trace.Screenshot 截的图'), group: () => t('事件') },
  { key: 'loadtime', label: () => t('加载'), note: () => t('包加载、异步加载'), group: () => t('加载与 IO') },
  { key: 'assetloadtime', label: () => t('资源加载'), note: () => t('每个资源的加载耗时'), group: () => t('加载与 IO') },
  { key: 'file', label: () => t('文件读写'), group: () => t('加载与 IO') },
  { key: 'net', label: () => t('网络'), note: () => t('Networking Insights'), group: () => t('加载与 IO') },
  { key: 'object', label: () => t('对象'), group: () => t('其他') },
  { key: 'animation', label: () => t('动画'), note: () => t('Animation Insights'), group: () => t('其他') },
  { key: 'rhicommands', label: () => t('RHI 命令'), note: () => t('开销大'), group: () => t('其他') },
  { key: 'rendercommands', label: () => t('渲染命令'), note: () => t('开销大'), group: () => t('其他') },
  { key: 'memtag', label: () => t('内存标签'), note: () => t('UE 要用 -llm 启动'), group: () => t('内存') },
  {
    key: 'memory',
    label: () => t('内存分配'),
    note: () => t('UE 要用 -trace=memory 启动才完整'),
    group: () => t('内存'),
  },
]
const DEFAULT_CUSTOM = ['cpu', 'gpu', 'frame', 'bookmark', 'log', 'counters']
const STORE = 'ue-perf-custom-channels'

/** 自定义通道记在浏览器里（只是个人习惯，丢了就回到默认） */
function loadCustom(): { channels: string[]; named: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null') as { channels?: string[]; named?: boolean } | null
    if (v?.channels?.length) return { channels: v.channels, named: !!v.named }
  } catch {
    /* 读不到就用默认 */
  }
  return { channels: DEFAULT_CUSTOM, named: false }
}
function saveCustom(v: { channels: string[]; named: boolean }) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v))
  } catch {
    /* 存不了也不影响这次录制 */
  }
}

/**
 * 页头右侧的录制控件（设计 4.1 工具栏）。
 * 没在录：录什么（trace / 帧数据）+ trace 的预设（自定义时旁边多一个「通道」按钮弹出勾选面板）+ 录制、抓内存报告；
 * 在录：红点计时、书签输入（回车打书签）、停止。录制不限时长，点停止才停。两种状态之间淡入切换。
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
  onStart: (o: StartOpts) => void
  onStop: () => void
  onMark: (name: string) => Promise<unknown> | void
  onMemreport: () => void
}) {
  const { ui } = h()
  const [kind, setKind] = useState<RecordKind>('trace')
  const [preset, setPreset] = useState('standard')
  const [custom, setCustom] = useState(loadCustom)
  const [panel, setPanel] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const [mark, setMark] = useState('')
  const updateCustom = (v: { channels: string[]; named: boolean }) => {
    setCustom(v)
    saveCustom(v)
  }
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
  const isCustom = kind === 'trace' && preset === 'custom'
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
          onChange={(e: { target: { value: string } }) => {
            setPreset(e.target.value)
            if (e.target.value === 'custom') setPanel(true)
          }}
          options={PRESETS.map((p) => ({ value: p.value, label: p.label() }))}
        />
      )}
      {isCustom && (
        <span ref={anchor} className="ue:relative">
          <ui.Button size="sm" variant="secondary" onClick={() => setPanel((p) => !p)}>
            <SlidersHorizontal className="ue:h-3.5 ue:w-3.5" />
            {t('{n} 个通道', { n: custom.channels.length })}
          </ui.Button>
          {panel && (
            <ChannelPanel anchor={anchor} value={custom} onChange={updateCustom} onClose={() => setPanel(false)} />
          )}
        </span>
      )}
      <ui.Button
        size="sm"
        disabled={!running || !!busy || (isCustom && !custom.channels.length)}
        title={t('不限时长，点停止才停')}
        onClick={() =>
          onStart({
            kind,
            preset,
            seconds: 0,
            ...(isCustom ? { channels: custom.channels.join(','), named: custom.named } : {}),
          })
        }
      >
        <Circle className="ue:h-3.5 ue:w-3.5" /> {t('录制')}
      </ui.Button>
      <ui.Button size="sm" variant="secondary" disabled={!running || !!busy} onClick={onMemreport}>
        {busy === 'memreport' ? t('正在抓…') : t('抓内存报告')}
      </ui.Button>
    </div>
  )
}

/**
 * 自定义通道的勾选面板：按用途分组，每个通道一句说明；底部是命名事件开关和「恢复默认」。
 * 画到 body 上、贴着「N 个通道」按钮下沿右对齐：页头有 overflow 裁剪，放在里面会被切掉、也会被下面的内容盖住
 */
function ChannelPanel({
  anchor,
  value,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLSpanElement | null>
  value: { channels: string[]; named: boolean }
  onChange: (v: { channels: string[]; named: boolean }) => void
  onClose: () => void
}) {
  const { cn, ui } = h()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>()
  // 用 useEffect 不用 useLayoutEffect：面板是按钮外层 span 的子节点，子节点的 layout effect 跑的时候父节点的 ref 还没挂上
  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) })
    }
    place()
    addEventListener('resize', place)
    return () => removeEventListener('resize', place)
  }, [anchor])
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      if (ref.current?.contains(e.target) || anchor.current?.contains(e.target)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('pointerdown', away)
    addEventListener('keydown', key)
    return () => {
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', key)
    }
  }, [onClose, anchor])
  const groups: { name: string; list: typeof CHANNELS }[] = []
  for (const c of CHANNELS) {
    const g = groups.find((x) => x.name === c.group())
    if (g) g.list.push(c)
    else groups.push({ name: c.group(), list: [c] })
  }
  const toggle = (k: string) =>
    onChange({
      ...value,
      channels: value.channels.includes(k) ? value.channels.filter((x) => x !== k) : [...value.channels, k],
    })
  if (!pos) return null
  return createPortal(
    <div
      ref={ref}
      className="ue:fixed ue:z-[1000] ue:max-h-[calc(100vh-120px)] ue:w-[min(560px,90vw)] ue:origin-top-right ue:overflow-auto ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-3 ue:shadow-lg ue:motion-safe:animate-pop"
      style={{ top: pos.top, right: pos.right }}
    >
      <div className="ue:mb-2 ue:flex ue:items-center ue:gap-2">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('录哪些通道')}</span>
        <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
          {value.channels.join(',') || t('（一个都没勾）')}
        </span>
      </div>
      <div className="ue:grid ue:grid-cols-1 ue:gap-x-4 ue:gap-y-2 ue:sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.name} className="ue:flex ue:flex-col">
            <div className="ue:mb-0.5 ue:text-caption ue:text-subtle">{g.name}</div>
            {g.list.map((c) => (
              <label
                key={c.key}
                className={cn(
                  'ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:px-1.5 ue:py-0.5 ue:text-footnote ue:transition-colors ue:hover:bg-hover',
                  value.channels.includes(c.key) ? 'ue:text-fg' : 'ue:text-muted',
                )}
              >
                <input
                  type="checkbox"
                  className="ue:accent-(--accent)"
                  checked={value.channels.includes(c.key)}
                  onChange={() => toggle(c.key)}
                />
                <span className="ue:shrink-0">{c.label()}</span>
                <span className="ue:font-mono ue:text-[10.5px] ue:text-subtle">{c.key}</span>
                {c.note && <span className="ue:ml-auto ue:truncate ue:text-caption ue:text-subtle">{c.note()}</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="ue:mt-3 ue:flex ue:items-center ue:gap-3 ue:border-t ue:border-line ue:pt-2">
        <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
          <input
            type="checkbox"
            className="ue:accent-(--accent)"
            checked={value.named}
            onChange={() => onChange({ ...value, named: !value.named })}
          />
          {t('命名事件')}
          <span className="ue:text-caption ue:text-subtle">{t('stat namedevents：蓝图函数、Tick 带具体名字，开销大些')}</span>
        </label>
        <span className="ue:ml-auto">
          <ui.Button size="sm" variant="secondary" onClick={() => onChange({ channels: DEFAULT_CUSTOM, named: false })}>
            {t('恢复默认')}
          </ui.Button>
        </span>
      </div>
    </div>,
    document.body,
  )
}

/** 录制中的红点：脉动的点和已录的时长（不限时长；有上限的 Agent 录制再带一条进度） */
export function RecordingPill({ active }: { active: Active }) {
  const pct = active.seconds ? Math.min(100, (active.elapsed / active.seconds) * 100) : 0
  const mm = Math.floor(active.elapsed / 60)
  const ss = String(Math.floor(active.elapsed % 60)).padStart(2, '0')
  return (
    <span className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-lg ue:bg-danger/10 ue:px-3 ue:text-footnote ue:font-medium ue:text-danger">
      <span className="ue:relative ue:flex ue:h-2 ue:w-2">
        <span className="ue:absolute ue:inset-0 ue:rounded-full ue:bg-danger ue:opacity-60 ue:motion-safe:animate-ping" />
        <span className="ue:relative ue:h-2 ue:w-2 ue:rounded-full ue:bg-danger" />
      </span>
      <span>{active.kind === 'trace' ? 'trace' : 'CSV'}</span>
      <span className="ue:font-mono ue:tabular-nums">
        {mm}:{ss}
        {active.seconds ? ` / ${active.seconds} s` : ''}
      </span>
      {!!active.seconds && (
        <span className="ue:h-1 ue:w-20 ue:overflow-hidden ue:rounded-full ue:bg-danger/15">
          <span
            className="ue:block ue:h-full ue:bg-danger ue:transition-[width] ue:duration-1000 ue:ease-linear"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </span>
  )
}
