import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { ApiPick, ArgsEdit } from '../../gt-api/ApiPick.tsx'
import { useEditCtx } from '../../gt-edit/ctx.ts'
import { CompareEdit, compareText } from '../compare.tsx'
import type { CheckKind } from './registry.ts'

/** 接口：只读接口的返回值 + 比较（Widget.IsShown、Object.Count、项目接口里标只读的） */
function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { apis } = useEditCtx()
  const api = apis.find((a) => a.name === value.api)
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <ApiPick readOnly value={String(value.api ?? '')} onChange={(v) => onChange({ ...value, api: v })} />
      <ArgsEdit
        api={api}
        value={(value.args as Record<string, unknown>) ?? {}}
        onChange={(a) => onChange({ ...value, args: a })}
      />
      <CompareEdit value={value} onChange={onChange} />
    </div>
  )
}

export const apiCheck: CheckKind = {
  id: 'api',
  label: () => t('接口'),
  hint: () => t('只读接口的返回值，例如 Widget.IsShown'),
  badge: () => t('接口'),
  match: (c) => typeof c.api === 'string',
  make: () => ({ api: '', args: {}, equals: true }),
  summary: (c) => {
    const args = c.args && typeof c.args === 'object' ? Object.values(c.args).map((v) => JSON.stringify(v)) : []
    return `${String(c.api)}(${args.join(', ')}) ${compareText(c)}`.trim()
  },
  Editor,
}
