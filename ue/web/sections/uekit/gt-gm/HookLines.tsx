import { HOOK_GROUPS, hookList } from '../../../../shared/gt-script/gm/hooks.ts'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { refText } from './gm-ref.ts'
import { HOOK_LABEL } from './HooksEditor.tsx'

/**
 * 流程图节点卡片底下的「附带 GM」几行（效果图 6）：一组一行「执行前 · GM 名, GM 名」，
 * 节点不变长太多，所以一组只占一行、超出省略；点节点在检查器里看全的
 */
export function HookLines({ step }: { step: GtStep }) {
  const rows = HOOK_GROUPS.map((g) => ({ g, list: hookList(step, g).filter((it) => !it.disabled) })).filter((r) => r.list.length)
  if (!rows.length) return null
  return (
    <div className="ue:mt-0.5 ue:flex ue:flex-col ue:gap-0.5 ue:border-t ue:border-dashed ue:border-line ue:pt-1">
      {rows.map(({ g, list }) => (
        <div key={g} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption">
          <span className="ue:shrink-0 ue:text-run">{HOOK_LABEL[g]()}</span>
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-subtle">{list.map((it) => refText(it.gm)).join(', ')}</span>
        </div>
      ))}
    </div>
  )
}
