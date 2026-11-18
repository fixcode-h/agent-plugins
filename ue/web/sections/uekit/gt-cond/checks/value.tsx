import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { CompareEdit, compareText } from '../compare.tsx'
import type { CheckKind } from './registry.ts'

/**
 * 代码变量（@sub.X.Y、@ps.Gold、@luaMod.路径、@cvar.名字）或脚本变量（$skipped）+ 比较。
 * 「从代码选」弹窗挑完也落成这一种
 */
function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <ui.Input
        size="sm"
        className="ue:font-mono"
        placeholder={t('@sub.UQuestSubsystem.DailyLeft、@ps.Gold、$skipped')}
        value={String(value.value ?? '')}
        onChange={(e: { target: { value: string } }) => onChange({ ...value, value: e.target.value })}
      />
      <CompareEdit value={value} onChange={onChange} />
    </div>
  )
}

/** 行首标签：Lua 来源、脚本变量、其余是 C++ / 蓝图反射 */
export function valueBadge(v: string) {
  if (v.startsWith('$')) return t('变量')
  if (/^@lua(Mod|G)?\b/.test(v)) return 'Lua'
  if (v.startsWith('@cvar')) return 'CVar'
  return t('代码')
}

export const valueCheck: CheckKind = {
  id: 'value',
  label: () => t('代码变量 / 脚本变量'),
  hint: () => t('子系统、玩家、Lua 模块里的值，或 $变量'),
  badge: (c) => valueBadge(String(c.value ?? '')),
  match: (c) => typeof c.value === 'string' && !('target' in c),
  make: () => ({ value: '', equals: true }),
  summary: (c) => `${String(c.value)} ${compareText(c)}`.trim(),
  Editor,
}
