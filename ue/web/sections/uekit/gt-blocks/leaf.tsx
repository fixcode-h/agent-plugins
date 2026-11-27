import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { stepTitle } from '../gt-step-title.ts'
import { actionIcon } from '../gt-action-icon.ts'
import { ExtraFields, FieldForm } from './fields/FieldForm.tsx'
import { actionTitle, fieldsOf, NOT_FIELDS } from './fields/registry.ts'
import './fields/actions.ts'
import { setFallbackUi, type BlockUi } from './registry.ts'

/** 公共字段由外壳画，JSON 里只改动作自己的字段：去掉 id 和公共字段 */
const COMMON = [
  'id',
  'title',
  'note',
  'onFail',
  'retries',
  'timeoutMs',
  'skipIf',
  'expectNoErrors',
  'disabled',
  'guards',
]

/**
 * 原有动作（click、key、type、move、wait、assert、console、gm…）的检查器：按动作字段表（fields/actions.ts）出表单，
 * 用户 2026-11-19：JSON 不给用户编辑。没登记的动作（编辑器录制的步骤等）按这一步现有的字段自动出输入框；
 * 直接改 JSON 收在最下面折起来的「高级」里，录制写的 hint 一直保留
 */
function LeafInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const defs = fieldsOf(step.action)
  const own = Object.keys(step).filter((k) => !NOT_FIELDS.has(k))
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      {defs ? (
        <FieldForm defs={defs} step={step} onChange={onChange} />
      ) : own.length ? (
        <ExtraFields keys={own} step={step} onChange={onChange} />
      ) : (
        <p className="ue:text-footnote ue:text-subtle">{t('这一步没有要填的')}</p>
      )}
      <JsonAdvanced step={step} onChange={onChange} />
    </div>
  )
}

/** 高级：直接改这一步自己的字段（JSON），默认折起来 */
function JsonAdvanced({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui, cn } = h()
  const [open, setOpen] = useState(false)
  const own = () => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(step)) if (!COMMON.includes(k)) o[k] = v
    return JSON.stringify(o, null, 2)
  }
  const [text, setText] = useState(own)
  const [err, setErr] = useState('')
  // 换了一步（或表单里改了这一步）时重新填
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setText(own()), [step])
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <button
        type="button"
        className="ue:flex ue:w-fit ue:items-center ue:gap-1 ue:text-caption ue:text-subtle ue:hover:text-fg"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn('ue:h-3 ue:w-3 ue:transition-transform', open && 'ue:rotate-90')} />
        {t('高级：直接改 JSON')}
      </button>
      {open && (
        <>
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
        </>
      )}
    </div>
  )
}

setFallbackUi(
  (action): BlockUi => ({
    action,
    title: () => actionTitle(action),
    icon: actionIcon(action),
    tone: 'subtle',
    summary: (s) => stepTitle(s),
    Inspector: LeafInspector,
  }),
)

export { LeafInspector }
