import { Check, ChevronDown, Info } from 'lucide-react'
import { useRef, useState } from 'react'
import { h, t } from '../../host.ts'
import { Popover } from './Popover.tsx'

/**
 * 录制预设（设计 3.4，默认「标准」；用户 2026-11-17「完善一下这个分类」照 Unreal Insights 常用的通道组合补齐）。
 * 键和服务端 perf.ts 的 TRACE_PRESETS 一致，旧键（standard / named / loading / memtag / custom）不改名；custom 是自己勾通道。
 * 每项一行说明：含哪些通道、什么时候用、开销或启动参数要求。Lua 不进预设，是旁边独立的开关
 */
export interface Preset {
  value: string
  label: () => string
  group: () => string
  desc: () => string
}
export const PRESETS: Preset[] = [
  {
    value: 'standard',
    label: () => t('标准'),
    group: () => t('常用'),
    desc: () => t('cpu,gpu,frame,bookmark,log,counters：时间轴、计时器、帧条、书签和日志，不知道选哪个就用它'),
  },
  {
    value: 'named',
    label: () => t('标准 + 命名事件'),
    group: () => t('常用'),
    desc: () => t('再开 stat namedevents：蓝图函数、Actor / 组件的 Tick 带具体名字，开销大一些'),
  },
  {
    value: 'gpu',
    label: () => t('GPU 与渲染'),
    group: () => t('按问题排查'),
    desc: () => t('标准 + rhicommands,rendercommands：渲染线程、RHI 卡在哪；开销大，录短一点'),
  },
  {
    value: 'loading',
    label: () => t('加载卡顿'),
    group: () => t('按问题排查'),
    desc: () => t('标准 + loadtime,assetloadtime,file：切关、开界面时同步加载和读文件慢'),
  },
  {
    value: 'memtag',
    label: () => t('内存'),
    group: () => t('按问题排查'),
    desc: () =>
      t('标准 + memtag：按标签看内存走势，UE 要用 -llm 启动；要看每次分配用自定义勾 memory，并用 -trace=memory 启动'),
  },
  {
    value: 'net',
    label: () => t('网络'),
    group: () => t('按问题排查'),
    desc: () => t('标准 + net：属性同步、RPC、带宽（Networking Insights）'),
  },
  {
    value: 'animation',
    label: () => t('动画'),
    group: () => t('按问题排查'),
    desc: () => t('标准 + animation：动画蓝图更新、姿势和曲线（Animation Insights）'),
  },
  {
    value: 'task',
    label: () => t('任务与线程'),
    group: () => t('按问题排查'),
    desc: () => t('标准 + task,contextswitch：任务图的依赖和等待、线程被切走；线程切换要管理员权限'),
  },
  {
    value: 'object',
    label: () => t('对象'),
    group: () => t('按问题排查'),
    desc: () => t('标准 + object：UObject 的创建和销毁，查一帧里新建了太多对象'),
  },
  {
    value: 'custom',
    label: () => t('自定义…'),
    group: () => t('自定义'),
    desc: () => t('自己勾要录的通道，旁边的按钮打开勾选面板'),
  },
]

/**
 * 预设下拉：面板的 Select 只有分组、没有每项的说明，这里用和 Lua 说明卡同一种弹出卡，
 * 按组列出，每项名字 + 一行说明，选中的打勾；底部提示 Lua 走旁边的开关
 */
export function PresetPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const cur = PRESETS.find((p) => p.value === value) ?? PRESETS[0]
  const groups: { name: string; list: Preset[] }[] = []
  for (const p of PRESETS) {
    const g = groups.find((x) => x.name === p.group())
    if (g) g.list.push(p)
    else groups.push({ name: p.group(), list: [p] })
  }
  return (
    <span ref={anchor} className="ue:relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={cur.desc()}
        onClick={() => setOpen((x) => !x)}
        className={cn(
          'ue:inline-flex ue:h-8 ue:w-36 ue:items-center ue:justify-between ue:gap-2 ue:rounded-lg ue:border ue:bg-field ue:px-2.5 ue:text-body ue:text-fg ue:transition-colors',
          open ? 'ue:border-accent' : 'ue:border-line ue:hover:border-line-strong',
        )}
      >
        <span className="ue:min-w-0 ue:truncate">{cur.label()}</span>
        <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width="ue:w-[min(400px,90vw)]">
          <div role="listbox" aria-label={t('录制预设')} className="ue:flex ue:flex-col">
            {groups.map((g, i) => (
              <div key={g.name} className={cn(i > 0 && 'ue:mt-1 ue:border-t ue:border-line ue:pt-1')}>
                <div className="ue:px-2 ue:pt-1 ue:pb-0.5 ue:text-caption ue:text-subtle">{g.name}</div>
                {g.list.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="option"
                    aria-selected={p.value === cur.value}
                    onClick={() => {
                      onChange(p.value)
                      setOpen(false)
                    }}
                    className={cn(
                      'ue:flex ue:w-full ue:items-start ue:gap-2 ue:rounded-md ue:px-2 ue:py-1.5 ue:text-left ue:transition-colors ue:hover:bg-hover',
                      p.value === cur.value && 'ue:bg-sel',
                    )}
                  >
                    <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
                      <span className="ue:text-footnote ue:font-medium ue:text-fg">{p.label()}</span>
                      <span className="ue:text-caption ue:text-subtle">{p.desc()}</span>
                    </span>
                    <Check
                      className={cn(
                        'ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text',
                        p.value !== cur.value && 'ue:invisible',
                      )}
                    />
                  </button>
                ))}
              </div>
            ))}
            <div className="ue:mt-1 ue:flex ue:items-center ue:gap-1.5 ue:border-t ue:border-line ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:text-subtle">
              <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
              {t('Lua 用右边的开关，任何预设都能带上')}
            </div>
          </div>
        </Popover>
      )}
    </span>
  )
}
