import { useState, type ReactNode } from 'react'
import { isBlock, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { BlockGuards } from '../gt-guards/BlockGuards.tsx'
import { FieldGroup, SwitchRow } from './fields/FieldGroup.tsx'

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

/** 说明：这一步在做什么（报告里显示），检查器最上面 */
export function NoteField({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  return (
    <Row label={t('说明')}>
      <TextField step={step} k="note" onChange={onChange} placeholder={t('这一步在做什么（报告里显示）')} />
    </Row>
  )
}

/**
 * 所有步骤共用的字段（协议第 2 节开头），按用途分三组（用户 2026-11-19）：
 * 执行（失败了怎么办、选了重试才出次数、总时限）、跳过（停用、已达成就跳过 + 条件）、判定（报错算失败）。
 * 说明单独放在检查器最上面（NoteField）
 */
export function CommonFields({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const [skip, setSkip] = useState(!!step.skipIf)
  const onFail = typeof step.onFail === 'string' ? step.onFail : 'stop'
  return (
    <div className="ue:flex ue:flex-col ue:gap-4">
      <FieldGroup title={t('执行')}>
        <Row label={t('失败了')}>
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
        </Row>
        {onFail === 'retry' && (
          <Row label={t('重试次数')}>
            <div className="ue:flex ue:items-center ue:gap-2">
              <NumberField step={step} k="retries" onChange={onChange} placeholder="2" />
              <span className="ue:text-footnote ue:text-subtle">{t('次')}</span>
            </div>
          </Row>
        )}
        <Row
          label={t('总时限')}
          hint={t('不填用默认；0 = 不限，一直等到成立或手动停止。写在块上是整块的总时限，块里每步各自的等待不变')}
        >
          <div className="ue:flex ue:items-center ue:gap-2">
            <NumberField step={step} k="timeoutMs" onChange={onChange} placeholder={t('默认')} />
            <span className="ue:text-footnote ue:text-subtle">{t('毫秒（0 = 不限）')}</span>
          </div>
        </Row>
      </FieldGroup>
      <FieldGroup title={t('跳过')}>
        <SwitchRow
          label={t('停用')}
          desc={t('跑的时候跳过这一步')}
          checked={step.disabled === true}
          onChange={(c) => onChange(patch(step, 'disabled', c || undefined))}
        />
        <SwitchRow
          label={t('已达成')}
          desc={t('下面的条件成立就跳过')}
          checked={skip}
          onChange={(c) => {
            setSkip(c)
            if (!c) onChange(patch(step, 'skipIf', undefined))
          }}
        />
        {skip && <CondEditor compact value={step.skipIf} onChange={(c) => onChange({ ...step, skipIf: c })} />}
      </FieldGroup>
      <FieldGroup title={t('判定')}>
        <SwitchRow
          label={t('报错算失败')}
          desc={t('执行期间出了 Error、Ensure 或 Lua 报错')}
          checked={step.expectNoErrors === true}
          onChange={(c) => onChange(patch(step, 'expectNoErrors', c || undefined))}
        />
      </FieldGroup>
      {isBlock(step) && (
        <div className="ue:border-t ue:border-line ue:pt-3">
          <BlockGuards step={step} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
