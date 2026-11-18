import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { useEditCtx } from '../../gt-edit/ctx.ts'
import { CompareEdit, compareText } from '../compare.tsx'
import type { CheckKind } from './registry.ts'

/** 常用名：展开成场景根 _vars.json 里的定义，团队共用一套名字 */
function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const { aliases } = useEditCtx()
  const cur = String(value.alias ?? '')
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <ui.Select
        size="sm"
        value={cur}
        onChange={(e: { target: { value: string } }) => onChange({ ...value, alias: e.target.value })}
        options={[
          ...(cur && !aliases.includes(cur) ? [{ value: cur, label: t('{n}（_vars.json 里没有）', { n: cur }) }] : []),
          ...(!cur ? [{ value: '', label: t('挑一个常用名') }] : []),
          ...aliases.map((a) => ({ value: a, label: a })),
        ]}
      />
      <CompareEdit value={value} onChange={onChange} />
    </div>
  )
}

export const aliasCheck: CheckKind = {
  id: 'alias',
  label: () => t('常用名'),
  hint: () => t('场景根 _vars.json 里存好的条件'),
  badge: () => t('常用'),
  match: (c) => typeof c.alias === 'string',
  make: () => ({ alias: '' }),
  summary: (c) => `${String(c.alias)} ${compareText(c)}`.trim(),
  Editor,
}
