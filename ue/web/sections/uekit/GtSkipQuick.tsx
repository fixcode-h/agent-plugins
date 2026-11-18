import { Check } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { type QuickCond, type QuickKind } from './gt-skip.ts'

/**
 * 跳过条件的快捷设置（用户 2026-11-18：默认不跳过，要用户自己设，设置要便捷）：常用三类一行填完——
 * 文字是不是某段文字、某个控件显不显示、某个勾选框勾没勾。看哪个控件留空就是这一步自己的控件。
 * 更复杂的（字段、图片、任一成立）用「手写条件」
 */
export function GtSkipQuick({
  init,
  disabled,
  onKind,
  onSave,
  onCancel,
}: {
  init: QuickCond
  disabled?: boolean
  /** 换类型时按录制候选重新填初值 */
  onKind: (k: QuickKind) => QuickCond
  onSave: (q: QuickCond) => void
  onCancel: () => void
}) {
  const { ui } = h()
  const [q, setQ] = useState(init)
  const kinds: { id: QuickKind; label: string }[] = [
    { id: 'text', label: t('文字是') },
    { id: 'visible', label: t('控件显示') },
    { id: 'checked', label: t('勾选框') },
  ]
  const yesNo =
    q.kind === 'visible'
      ? [
          { id: 'yes', label: t('显示着') },
          { id: 'no', label: t('没显示') },
        ]
      : [
          { id: 'yes', label: t('已勾上') },
          { id: 'no', label: t('没勾上') },
        ]
  const empty = q.kind === 'text' && !q.value.trim()
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:px-3 ue:py-2.5">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-footnote">
        <span className="ue:w-12 ue:shrink-0 ue:text-subtle">{t('什么时')}</span>
        <ui.Segmented
          size="sm"
          value={q.kind}
          onChange={(k: string) => setQ(onKind(k as QuickKind))}
          options={kinds.map((k) => ({ ...k, disabled }))}
        />
      </div>
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-footnote">
        <span className="ue:w-12 ue:shrink-0 ue:text-subtle">{t('看控件')}</span>
        <ui.Input
          size="sm"
          className="ue:min-w-0 ue:flex-1 ue:font-mono"
          disabled={disabled}
          placeholder={t('留空 = 这一步点的控件')}
          value={q.target}
          onChange={(e: { target: { value: string } }) => setQ({ ...q, target: e.target.value })}
        />
      </div>
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-footnote">
        <span className="ue:w-12 ue:shrink-0 ue:text-subtle">{q.kind === 'text' ? t('文字') : t('状态')}</span>
        {q.kind === 'text' ? (
          <ui.Input
            size="sm"
            className="ue:min-w-0 ue:flex-1"
            disabled={disabled}
            placeholder={t('例如 已领取')}
            value={q.value}
            onChange={(e: { target: { value: string } }) => setQ({ ...q, value: e.target.value })}
            onKeyDown={(e: { key: string }) => e.key === 'Enter' && !empty && onSave(q)}
          />
        ) : (
          <ui.Segmented
            size="sm"
            value={q.value === 'no' ? 'no' : 'yes'}
            onChange={(v: string) => setQ({ ...q, value: v })}
            options={yesNo.map((o) => ({ ...o, disabled }))}
          />
        )}
      </div>
      {q.kind === 'text' && (
        <p className="ue:text-caption ue:text-subtle">{t('比的时候忽略数字和标点：「已领取(1/3)」也算「已领取」')}</p>
      )}
      <div className="ue:flex ue:justify-end ue:gap-2">
        <ui.Button size="sm" variant="ghost" onClick={onCancel}>
          {t('取消')}
        </ui.Button>
        <ui.Button size="sm" disabled={disabled || empty} onClick={() => onSave(q)}>
          <Check className="ue:h-3.5 ue:w-3.5" /> {t('保存')}
        </ui.Button>
      </div>
    </div>
  )
}
