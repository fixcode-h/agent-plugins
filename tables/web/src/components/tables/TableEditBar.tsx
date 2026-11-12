import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'

/** 编辑栏最多自动长到几行，再多就出滚动条（可以拖右下角拉高） */
const MAX_LINES = 4

/**
 * 表格上方的编辑栏（像 Excel 的公式栏）：看全当前格的长文本，也能直接在这里改。
 * Enter 确认、Shift+Enter 换行、Esc 放弃；右边是这一列的规则。开关在工具栏「查看」里，记在本机
 */
export function TableEditBar({
  at,
  value,
  rule,
  readOnly,
  onCommit,
  onDone,
}: {
  /** 当前格：「E6 · DisplayName」；没选中格子时空 */
  at: string
  value: string
  /** 这一列的规则：「枚举 Size · 0~4」 */
  rule: string
  readOnly: boolean
  onCommit: (v: string) => void
  /** 确认或放弃后把焦点还给表格 */
  onDone: () => void
}) {
  const [draft, setDraft] = useState(value)
  // Enter / Esc 已经处理过：接着的失焦不再提交一遍（不然撤销里多一步）
  const handled = useRef(false)
  // 换了格子（或格子被别处改了）：编辑栏跟着换
  useEffect(() => setDraft(value), [value, at])
  const lines = Math.min(MAX_LINES, Math.max(1, draft.split('\n').length))
  return (
    <div className="tb:flex tb:shrink-0 tb:items-start tb:gap-2 tb:border-b tb:bg-panel tb:px-3 tb:py-1 tb:text-footnote">
      <span
        className="tb:flex tb:h-7 tb:w-36 tb:shrink-0 tb:items-center tb:truncate tb:font-mono tb:text-muted"
        title={at}
      >
        {at || '—'}
      </span>
      <textarea
        aria-label={t('编辑栏')}
        value={draft}
        disabled={!at}
        readOnly={readOnly}
        rows={lines}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            handled.current = true
            setDraft(value)
            onDone()
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handled.current = true
            if (!readOnly && draft !== value) onCommit(draft)
            onDone()
          }
        }}
        onFocus={() => (handled.current = false)}
        onBlur={() => !handled.current && !readOnly && draft !== value && onCommit(draft)}
        placeholder={at ? '' : t('选中一格看它的完整内容')}
        className={cn(
          'thin-scroll tb:min-h-7 tb:min-w-0 tb:flex-1 tb:resize-y tb:rounded-(--c-input-radius) tb:border tb:border-transparent tb:bg-transparent tb:px-2 tb:py-1 tb:font-(family-name:--c-grid-font) tb:text-body tb:leading-5 tb:text-fg tb:outline-none',
          'tb:hover:border-line tb:focus:border-focus tb:focus:bg-(--c-input-bg) tb:disabled:opacity-60',
        )}
      />
      {rule && (
        <span
          className="tb:flex tb:h-7 tb:max-w-[40%] tb:shrink tb:items-center tb:truncate tb:text-subtle"
          title={rule}
        >
          {rule}
        </span>
      )}
    </div>
  )
}
