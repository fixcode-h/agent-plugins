import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { TargetInput } from '../TargetInput.tsx'
import { CompareEdit, compareText } from '../compare.tsx'
import type { CheckKind } from './registry.ts'

/** 控件 / 界面的字段：@self.X（反射，C++ / 蓝图）、@lua.X（绑的 Lua 实例）、@item.X、@itemLua.X */
function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <TargetInput value={String(value.target ?? '')} onChange={(v) => onChange({ ...value, target: v })} />
      <ui.Input
        size="sm"
        className="ue:font-mono"
        placeholder={t('@self.字段、@lua.字段、@item.字段')}
        value={String(value.field ?? '')}
        onChange={(e: { target: { value: string } }) => onChange({ ...value, field: e.target.value })}
      />
      <CompareEdit value={value} onChange={onChange} />
    </div>
  )
}

export const fieldCheck: CheckKind = {
  id: 'field',
  label: () => t('控件的字段'),
  hint: () => t('界面上 C++ / 蓝图变量或绑的 Lua 字段'),
  badge: (c) => (/^@(lua|itemLua)\b/.test(String(c.field ?? '')) ? 'Lua' : t('字段')),
  match: (c) => typeof c.field === 'string',
  make: () => ({ target: '', field: '@self.', equals: true }),
  summary: (c) => `${String(c.target ?? '')} · ${String(c.field)} ${compareText(c)}`.trim(),
  Editor,
}
