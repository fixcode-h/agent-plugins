import { childrenOf, groupKind, toEditable, type CondNode } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { checkKindOf } from './checks/index.ts'

/** 条件的一句话（列表行、流程图节点上）：一条判断时就是它本身，多条时说「N 条都满足 / 任一满足」 */
export function condSummary(cond: unknown): string {
  const root = toEditable(cond)
  const k = groupKind(root) as 'all' | 'any'
  const kids = childrenOf(root)
  if (!kids.length) return t('（没写条件）')
  if (kids.length === 1) return nodeSummary(kids[0])
  const head = nodeSummary(kids[0])
  return k === 'all'
    ? t('{n} 条都满足：{s} …', { n: kids.length, s: head })
    : t('{n} 条任一满足：{s} …', { n: kids.length, s: head })
}

function nodeSummary(n: CondNode): string {
  const k = groupKind(n)
  if (k === 'not') return t('不（{s}）', { s: nodeSummary(n.not as CondNode) })
  if (k) return condSummary(n)
  return checkKindOf(n).summary(n)
}
