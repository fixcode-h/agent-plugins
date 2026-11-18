import { t } from '../../../../host.ts'
import { ExprInput } from '../ExprInput.tsx'
import type { CheckKind } from './registry.ts'

/** 表达式：{"expr": "@ps.Gold >= $gold0 + 500"}，只许只读函数 */
export const exprCheck: CheckKind = {
  id: 'expr',
  label: () => t('表达式'),
  hint: () => t('算出来是真就成立，例如 @ps.Gold >= $gold0 + 500'),
  badge: () => t('表达式'),
  match: (c) => typeof c.expr === 'string',
  make: () => ({ expr: '' }),
  summary: (c) => String(c.expr),
  Editor: ({ value, onChange }) => (
    <ExprInput autoFocus value={String(value.expr ?? '')} onChange={(v) => onChange({ ...value, expr: v })} />
  ),
}
