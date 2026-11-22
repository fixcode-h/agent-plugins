import { invokesOf } from '../../../../shared/gm/custom.ts'
import { t } from '../../../host.ts'
import { ValueTree } from '../value/ValueTree.tsx'
import { stepVars } from './VarsTable.tsx'

/**
 * 报告一行下面的值（分析文档 G4）：调函数的返回值（GameTest 2.2.1 起带类型的 value，旧版只有 returned）
 * 和这一步用到的变量，一项一棵收起的值树，和 GM 调函数的输出同一套画法。都没有时不占地方
 */
export function ReportValues({ project, payload }: { project: string; payload?: Record<string, unknown> }) {
  const inv = invokesOf({ payload }).filter((x) => x.value !== undefined || x.returned !== undefined)
  const sv = stepVars(payload)
  if (!inv.length && !sv) return null
  return (
    <div className="ue:flex ue:flex-col ue:pr-4 ue:pb-1 ue:pl-8">
      {inv.map((x, i) => (
        <ValueTree
          key={`r${i}`}
          project={project}
          name={inv.length > 1 ? t('返回 · {o}', { o: x.object ?? String(i + 1) }) : t('返回')}
          value={x.value ?? x.returned}
          collapsed
        />
      ))}
      {sv &&
        Object.entries(sv.vars).map(([k, v]) => (
          <ValueTree key={k} project={project} name={'$' + k} value={v} collapsed />
        ))}
      {sv?.truncated && <span className="ue:pl-6 ue:text-caption ue:text-subtle">{t('变量太多，只列了一部分')}</span>}
    </div>
  )
}
