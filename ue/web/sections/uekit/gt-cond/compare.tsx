import type { CondNode } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { ValueInput } from './ValueInput.tsx'

/** 比较（协议 4.1）：equals / ne / gt / gte / lt / lte / in / contains / matches；没写比较时按真值算 */
export const COMPARE_OPS = ['equals', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'matches'] as const
export type CompareOp = (typeof COMPARE_OPS)[number] | 'truthy'

export const compareLabel = (op: CompareOp) =>
  ({
    truthy: t('为真'),
    equals: '=',
    ne: '≠',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    in: t('在其中'),
    contains: t('包含'),
    matches: t('匹配正则'),
  })[op]

export function compareOf(c: CondNode): { op: CompareOp; value: unknown } {
  const op = COMPARE_OPS.find((k) => k in c)
  return op ? { op, value: c[op] } : { op: 'truthy', value: undefined }
}

export function withCompare(c: CondNode, op: CompareOp, value: unknown): CondNode {
  const out: CondNode = { ...c }
  for (const k of COMPARE_OPS) delete out[k]
  if (op !== 'truthy') out[op] = value
  return out
}

export const compareText = (c: CondNode) => {
  const { op, value } = compareOf(c)
  return op === 'truthy' ? '' : `${compareLabel(op)} ${typeof value === 'string' ? value : JSON.stringify(value)}`
}

/** 输入的文字 → 比较值：数字、true / false、in 的逗号列表；以 = 开头的是表达式，原样留着 */
export function parseCompareValue(op: CompareOp, s: string): unknown {
  if (s.startsWith('=')) return s
  if (op === 'in') return s.split(',').map((x) => parseScalar(x.trim()))
  if (op === 'matches' || op === 'contains') return s
  return parseScalar(s)
}

export function parseScalar(s: string): unknown {
  if (s === 'true' || s === 'false') return s === 'true'
  if (s === 'null') return null
  if (s.trim() !== '' && Number.isFinite(Number(s))) return Number(s)
  return s
}

export const scalarText = (v: unknown) =>
  v === undefined ? '' : Array.isArray(v) ? v.map((x) => String(x)).join(', ') : typeof v === 'string' ? v : JSON.stringify(v)

/** 比较方式 + 值：一行里的下拉和输入框（值可以写成 = 开头的表达式） */
export function CompareEdit({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const { op, value: v } = compareOf(value)
  return (
    <div className="ue:flex ue:items-start ue:gap-1.5">
      <ui.Select
        size="sm"
        className="ue:w-28 ue:shrink-0"
        value={op}
        onChange={(e: { target: { value: string } }) =>
          onChange(withCompare(value, e.target.value as CompareOp, e.target.value === 'truthy' ? undefined : (v ?? '')))
        }
        options={(['truthy', ...COMPARE_OPS] as CompareOp[]).map((k) => ({ value: k, label: compareLabel(k) }))}
      />
      {op !== 'truthy' && (
        <ValueInput
          className="ue:min-w-0 ue:flex-1"
          value={scalarText(v)}
          onChange={(s) => onChange(withCompare(value, op, parseCompareValue(op, s)))}
          placeholder={op === 'in' ? t('用逗号隔开：1, 2, 3') : t('值，或 = 开头的表达式')}
        />
      )}
    </div>
  )
}
