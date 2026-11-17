import { MessageSquare } from 'lucide-react'
import { t } from '../../host.ts'
import { LinkBtn } from '../../ui.tsx'
import { FlameGraph } from './FlameGraph.tsx'
import { Empty, Tabs, fmtAt, fmtMs } from './parts.tsx'
import { CallTree, InstancesView, StackView, type PanelActions } from './TracePanels.tsx'
import type { PickedBlock, Range } from './trace.ts'

export type Lower = 'stack' | 'tree' | 'inst' | 'flame'

/**
 * trace 视图右栏下半（从 TraceView 拆出来）：选中计时器的调用者 / 被调用者、点中块的调用堆栈、每次调用，
 * 以及火焰图（Lua 性能 Insights 化设计 5.5）。没选计时器时：trace 含 Lua 就只给火焰图页签（看全部 Lua），
 * 不含 Lua 就和以前一样只有一句提示 —— 没有 Lua 的 trace 界面不变。
 */
export function LowerPane({
  id,
  range,
  whole,
  timer,
  picked,
  setPicked,
  lower,
  setLower,
  hasLua,
  laneName,
  actions,
  onAgent,
}: {
  id: string
  range?: Range
  /** 整段（没选范围时给 Agent 的范围） */
  whole: Range
  timer?: { id: number; name: string }
  picked?: PickedBlock
  setPicked: (b: PickedBlock) => void
  lower: Lower
  setLower: (k: Lower) => void
  hasLua: boolean
  laneName: (lane: number) => string
  actions: PanelActions
  onAgent?: (extra: string) => void
}) {
  // 要计时器的页签在没选计时器时退到火焰图（有 Lua）或提示
  const cur: Lower | 'none' = timer
    ? lower === 'stack' && !picked
      ? 'tree'
      : lower
    : lower === 'flame' || hasLua
      ? 'flame'
      : 'none'
  const r = range ?? whole
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:border-t ue:border-line">
      {(timer || hasLua) && (
        <Tabs<Lower>
          value={cur === 'none' ? 'tree' : cur}
          onChange={setLower}
          items={[
            ...(timer ? [{ key: 'tree' as const, label: t('调用者 / 被调用者') }] : []),
            ...(timer && picked ? [{ key: 'stack' as const, label: t('调用堆栈') }] : []),
            ...(timer ? [{ key: 'inst' as const, label: t('每次调用') }] : []),
            { key: 'flame', label: t('火焰图') },
          ]}
        />
      )}
      <div
        key={cur === 'flame' ? 'flame' : `${cur}-${timer?.id}`}
        className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-fade"
      >
        {cur === 'flame' ? (
          <FlameGraph id={id} range={range} timer={timer} actions={actions} />
        ) : cur === 'stack' && picked ? (
          <StackView
            key={`${picked.lane}-${picked.time}`}
            id={id}
            block={picked}
            laneName={laneName(picked.lane)}
            onDepth={(d) => setPicked({ ...picked, depth: d })}
            actions={actions}
          />
        ) : cur === 'inst' && timer ? (
          <InstancesView
            id={id}
            range={range}
            timer={timer.id}
            name={timer.name}
            laneName={laneName}
            actions={actions}
          />
        ) : timer ? (
          <CallTree id={id} range={range} timer={timer.id} name={timer.name} actions={actions} />
        ) : (
          <Empty>
            {t(
              '选一段时间（帧条或时间轴刻度条上拖），再在计时器表里点一行看调用者 / 被调用者；在时间轴上点一块看它的调用堆栈',
            )}
          </Empty>
        )}
      </div>
      {onAgent && (
        <AgentLink onAgent={onAgent} r={r} timer={timer} picked={picked} laneName={laneName} />
      )}
    </div>
  )
}

function AgentLink({
  onAgent,
  r,
  timer,
  picked,
  laneName,
}: {
  onAgent: (extra: string) => void
  r: Range
  timer?: { id: number; name: string }
  picked?: PickedBlock
  laneName: (lane: number) => string
}) {
  return (
    <div className="ue:border-t ue:border-line ue:px-3 ue:py-2">
      <LinkBtn
        onClick={() =>
          onAgent(
            [
              `分析范围：${fmtAt(r.t0)} – ${fmtAt(r.t1)}（ue_capture 的 from=${r.t0.toFixed(4)} to=${r.t1.toFixed(4)}）`,
              timer ? `我在看的计时器：${timer.name}（id ${timer.id}）` : '',
              picked
                ? `点中的块：${laneName(picked.lane)} 线程 ${fmtAt(picked.time)}，${picked.name} ${fmtMs(picked.ms)}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
        }
      >
        <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 分析这段')}
      </LinkBtn>
    </div>
  )
}
