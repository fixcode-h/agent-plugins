import { useEffect, useState } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { stepTitle } from '../gt-step-title.ts'
import { actionIcon } from '../gt-action-icon.ts'
import { setFallbackUi, type BlockUi } from './registry.ts'

/** 公共字段由外壳画，这里只改动作自己的字段：去掉 id 和公共字段后的 JSON */
const COMMON = ['id', 'note', 'onFail', 'retries', 'timeoutMs', 'skipIf', 'expectNoErrors', 'disabled', 'guards']

/**
 * 原有动作（click、key、type、move、wait、assert、console、gm…）的兜底：名字就是 action，
 * 一句话用 GameTest 页步骤列表同一套（gt-step-title.ts），检查器直接改这一步自己的字段（JSON），不丢录制写的 hint
 */
function LeafInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const own = () => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(step)) if (!COMMON.includes(k)) o[k] = v
    return JSON.stringify(o, null, 2)
  }
  const [text, setText] = useState(own)
  const [err, setErr] = useState('')
  // 换了一步（或别处改了这一步）时重新填
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setText(own()), [step])
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <span className="ue:text-footnote ue:text-subtle">{t('这一步的字段（动作和参数见 GameTest 文档的动作表）')}</span>
      <ui.Textarea
        rows={8}
        spellCheck={false}
        className="ue:font-mono ue:text-footnote"
        value={text}
        onChange={(e: { target: { value: string } }) => {
          setText(e.target.value)
          try {
            const v = JSON.parse(e.target.value) as Record<string, unknown>
            if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.action !== 'string')
              throw new Error(t('要是一个带 action 的对象'))
            const keep: Record<string, unknown> = {}
            for (const k of COMMON) if (k in step) keep[k] = step[k]
            setErr('')
            onChange({ ...v, ...keep } as GtStep)
          } catch (x) {
            setErr((x as Error).message)
          }
        }}
      />
      {err && <span className="ue:text-caption ue:text-danger">{err}</span>}
    </div>
  )
}

setFallbackUi(
  (action): BlockUi => ({
    action,
    title: () => action,
    icon: actionIcon(action),
    tone: 'subtle',
    summary: (s) => stepTitle(s),
    Inspector: LeafInspector,
  }),
)

export { LeafInspector }
