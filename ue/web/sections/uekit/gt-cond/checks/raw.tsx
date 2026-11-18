import { useState } from 'react'
import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import type { CheckKind } from './registry.ts'

/** 认不出来的判断（image、count、actorNear 这些，或以后 GameTest 新加的）：直接改 JSON，不丢字段 */
function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [err, setErr] = useState('')
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <ui.Textarea
        rows={5}
        className="ue:font-mono ue:text-footnote"
        value={text}
        onChange={(e: { target: { value: string } }) => {
          setText(e.target.value)
          try {
            const v = JSON.parse(e.target.value) as unknown
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(t('要是一个对象'))
            setErr('')
            onChange(v as CondNode)
          } catch (x) {
            setErr((x as Error).message)
          }
        }}
      />
      {err && <span className="ue:text-caption ue:text-danger">{err}</span>}
    </div>
  )
}

export const rawCheck: CheckKind = {
  id: 'raw',
  label: () => t('其他（写 JSON）'),
  badge: () => t('其他'),
  match: () => true,
  make: () => ({}),
  summary: (c) => JSON.stringify(c),
  Editor,
  hidden: true,
}
