import { useState, type ReactNode } from 'react'
import { isBlock, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { BlockGuards } from '../gt-guards/BlockGuards.tsx'

/** 改一个字段：值是 undefined / 空字符串时删掉这个字段，存进文件的步骤保持短 */
export function patch(step: GtStep, k: string, v: unknown): GtStep {
  const out = { ...step }
  if (v === undefined || v === '') delete out[k]
  else out[k] = v
  return out
}

/** 检查器里的一行：左边标签，右边控件（照效果图：标签窄、控件占满） */
export function Row({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="ue:grid ue:grid-cols-[72px_minmax(0,1fr)] ue:items-start ue:gap-2">
      <span className="ue:pt-1.5 ue:text-footnote ue:text-subtle" title={hint}>
        {label}
      </span>
      <div className="ue:min-w-0">{children}</div>
    </div>
  )
}

export function TextField({
  step,
  k,
  onChange,
  placeholder,
  mono,
}: {
  step: GtStep
  k: string
  onChange: (s: GtStep) => void
  placeholder?: string
  mono?: boolean
}) {
  const { ui, cn } = h()
  return (
    <ui.Input
      size="sm"
      spellCheck={false}
      className={cn('ue:w-full', mono && 'ue:font-mono')}
      placeholder={placeholder}
      value={typeof step[k] === 'string' ? (step[k] as string) : step[k] === undefined ? '' : JSON.stringify(step[k])}
      onChange={(e: { target: { value: string } }) => onChange(patch(step, k, e.target.value))}
    />
  )
}

/** 数字字段：可以写 $变量（times: "$n"），纯数字存成数字 */
export function NumberField({
  step,
  k,
  onChange,
  placeholder,
  allowVar,
}: {
  step: GtStep
  k: string
  onChange: (s: GtStep) => void
  placeholder?: string
  allowVar?: boolean
}) {
  const { ui } = h()
  const v = step[k]
  return (
    <ui.Input
      size="sm"
      className="ue:w-28 ue:font-mono"
      placeholder={placeholder}
      value={v === undefined ? '' : String(v)}
      onChange={(e: { target: { value: string } }) => {
        const s = e.target.value.trim()
        if (!s) return onChange(patch(step, k, undefined))
        if (allowVar && s.startsWith('$')) return onChange(patch(step, k, s))
        const n = Number(s)
        if (Number.isFinite(n)) onChange(patch(step, k, n))
      }}
    />
  )
}

/**
 * 所有步骤共用的字段（协议第 2 节开头）：说明、失败了怎么办（停下 / 接着往下 / 重试 N 次）、总时限、
 * 执行期间出了报错就算失败、停用；已达成就跳过的条件折叠在最下面
 */
export function CommonFields({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const [skip, setSkip] = useState(!!step.skipIf)
  const onFail = typeof step.onFail === 'string' ? step.onFail : 'stop'
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('说明')}>
        <TextField step={step} k="note" onChange={onChange} placeholder={t('这一步在做什么（报告里显示）')} />
      </Row>
      <Row label={t('失败了')}>
        <div className="ue:flex ue:items-center ue:gap-2">
          <ui.Segmented
            size="sm"
            label={t('失败了')}
            value={onFail}
            onChange={(v: string) =>
              onChange(
                patch(
                  patch(step, 'onFail', v === 'stop' ? undefined : v),
                  'retries',
                  v === 'retry' ? (step.retries ?? 2) : undefined,
                ),
              )
            }
            options={[
              { id: 'stop', label: t('停下') },
              { id: 'continue', label: t('接着往下') },
              { id: 'retry', label: t('重试') },
            ]}
          />
          {onFail === 'retry' && <NumberField step={step} k="retries" onChange={onChange} placeholder="2" />}
        </div>
      </Row>
      <Row label={t('总时限')} hint={t('写在块上是整块的总时限；块里每步各自的等待不变')}>
        <div className="ue:flex ue:items-center ue:gap-2">
          <NumberField step={step} k="timeoutMs" onChange={onChange} placeholder={t('默认')} />
          <span className="ue:text-footnote ue:text-subtle">{t('毫秒')}</span>
        </div>
      </Row>
      <div className="ue:flex ue:flex-wrap ue:gap-x-4 ue:gap-y-1.5 ue:pl-[80px]">
        <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
          <input
            type="checkbox"
            checked={step.expectNoErrors === true}
            onChange={(e) => onChange(patch(step, 'expectNoErrors', e.target.checked || undefined))}
          />
          {t('执行期间出了 Error、Ensure 或 Lua 报错就算失败')}
        </label>
        <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
          <input
            type="checkbox"
            checked={step.disabled === true}
            onChange={(e) => onChange(patch(step, 'disabled', e.target.checked || undefined))}
          />
          {t('停用（跑的时候跳过）')}
        </label>
        <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => {
              setSkip(e.target.checked)
              if (!e.target.checked) onChange(patch(step, 'skipIf', undefined))
            }}
          />
          {t('已达成就跳过')}
        </label>
      </div>
      {skip && (
        <div className="ue:flex ue:flex-col ue:gap-1.5">
          <span className="ue:text-footnote ue:text-subtle">
            {t('这些条件成立时跳过这一步（目标已经是想要的状态）')}
          </span>
          <CondEditor compact value={step.skipIf} onChange={(c) => onChange({ ...step, skipIf: c })} />
        </div>
      )}
      {isBlock(step) && (
        <div className="ue:border-t ue:border-line ue:pt-3">
          <BlockGuards step={step} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
