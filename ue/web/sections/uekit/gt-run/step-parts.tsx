import { CircleCheck, CircleDashed, CircleX, Crosshair, Loader2, SkipForward, TriangleAlert } from 'lucide-react'
import { show } from '../../../api.ts'
import { t } from '../../../host.ts'
import { ambiguousOf, humanStep } from '../gt-steps.ts'
import type { RowPlace } from '../gt-rows/rows.ts'

// 运行结果里一步的类型和几个小部件（状态图标、耗时、核对标记、一行摘要）。
// 原来放在列表时代的步骤详情 GtStepDetail.tsx 里，那块界面删了（分析文档 B9），用到的类型和小工具挪到这里

/**
 * GameTest 一步的两份数据：场景文件里写的（def：动作和参数），这次运行的结果（res：状态、消息、payload、耗时）。
 * 没跑过的场景只有 def，`gt.run` 直接给步骤的临时运行只有 res，两份按行号对齐后一起显示
 */
export interface GtStep {
  index: number
  action: string
  /** already：已达成跳过（GameTest 1.7.0，算通过） */
  status: 'succeeded' | 'failed' | 'skipped' | 'already' | 'pending' | string
  message?: string
  target?: string
  note?: string
  payload?: Record<string, unknown>
  durationMs?: number
  /** 运行配置里的前置步骤（GameTest 1.2.5）：index 是它在前置步骤里的序号，不对应场景的步骤 */
  setup?: boolean
  /** GameTest 1.9.0 起：步骤路径（steps.1.do.0），块里的步骤 index 只是所在槽里的序号，按它对行 */
  path?: string
  /** 块结束时记的一条（块本身的结果） */
  block?: boolean
}

export interface StepDef {
  action: string
  [k: string]: unknown
}

/** 一行：在场景里的位置（gt-rows/rows.ts，按路径认，块里的步骤也各占一行）+ 场景里写的 + 这次的结果 */
export interface StepRow extends RowPlace {
  def?: StepDef
  res?: GtStep
  /** 「核对选择器」（gt.resolve）里这一步的结果：target、拖动的 toTarget 各一条 */
  check?: GtResolveItem[]
}

/** gt.resolve 的一条：选择器此刻找不找得到；找不到时 error 里是候选 */
export interface GtResolveItem {
  target: string
  step?: number
  field?: string
  found: boolean
  path?: string
  class?: string
  text?: string
  visible?: boolean
  enabled?: boolean
  error?: string
}

/** 行里的核对标记：都找得到是准星，有找不到的是黄三角（悬停看是哪个） */
export function CheckMark({ check }: { check?: GtResolveItem[] }) {
  if (!check?.length) return null
  const missing = check.filter((c) => !c.found)
  return missing.length ? (
    <span title={t('此刻找不到：{s}', { s: missing.map((c) => c.target).join('、') })} className="ue:shrink-0">
      <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
    </span>
  ) : (
    <span title={t('选择器此刻找得到')} className="ue:shrink-0">
      <Crosshair className="ue:h-3.5 ue:w-3.5 ue:text-success" />
    </span>
  )
}

export const ms = (n?: number) =>
  n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`

export function StepIcon({ s, live }: { s?: string; live?: boolean }) {
  if (live) return <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin ue:text-warning" />
  if (s === 'succeeded') return <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
  if (s === 'already') return <SkipForward className="ue:h-3.5 ue:w-3.5 ue:text-success" />
  if (s === 'failed') return <CircleX className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
  return <CircleDashed className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
}

/**
 * 一行里显示的说明：目标 + 说明 / 结果消息；没有目标时把关键参数拼一行（key、map、seconds……）。
 * 录制附了 hint 的 UI 步骤多一句人话（human），选择器退成次要信息；ambiguous 是录制时选择器没核对通过的原因
 */
export function rowSummary(r: Pick<StepRow, 'def' | 'res'>) {
  const target = r.res?.target ?? (typeof r.def?.target === 'string' ? r.def.target : undefined)
  const note = r.res?.note ?? (typeof r.def?.note === 'string' ? r.def.note : undefined)
  const params = r.def ? paramsOf(r.def) : []
  const brief = params
    .filter(([k]) => k !== 'target' && k !== 'note' && k !== 'hint' && !(r.def?.action === 'move' && MOVE_DRAWN.has(k)))
    .map(([k, v]) => `${k}=${show(v)}`)
    .join(' ')
  return {
    target,
    text: r.res?.message || note || brief,
    /** 场景里写的这一步的说明（AI 整理会给每步写一句中文） */
    note: typeof r.def?.note === 'string' && r.def.note.trim() ? r.def.note : undefined,
    human: humanStep(r.def),
    ambiguous: ambiguousOf(r.def),
  }
}

/** 步骤定义里除了 action 之外的字段，按场景文件里的顺序 */
const MOVE_DRAWN = new Set(['path', 'jumps', 'fly'])
const paramsOf = (def: StepDef) => Object.entries(def).filter(([k]) => k !== 'action')
