import { Copy, Pencil, SquarePen } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { copyText } from '../../menu.tsx'
import { ForgeCodeView } from './ForgeCodeView.tsx'
import { ForgeConfigEdit } from './ForgeConfigEdit.tsx'
import { ErrorBox, Hint, Loading } from './forge-parts.tsx'

/**
 * 「配置原文」页签：只读代码块，带行号和简单的 JSON 着色；右上角「编辑」切到页面里直接改（ForgeConfigEdit.tsx，
 * 用户 2026-11-16 同意；原先设计稿 §5 只读、编辑交给外部编辑器），也留着「用编辑器打开」「复制」。
 * 面板共用控件里没有代码块，代码块在 ForgeCodeView.tsx 自己画（大配置只画看得见的行）；颜色只用主题色。
 * 解析失败时说明里常带「第 N 行」，那一行用 danger 底标出来。
 */
export function ForgeConfig({
  loading,
  error,
  text,
  truncated,
  badLine,
  onOpen,
  edit,
}: {
  loading: boolean
  error: string
  text?: string
  truncated?: boolean
  /** 要标红的行（从 1 数），解析失败时从说明里取 */
  badLine?: number
  onOpen: () => void
  /** 能在页面里编辑时给：项目、配置根和这份配置的相对路径 */
  edit?: { project: string; configRoot: string; path: string }
}) {
  const { ui } = h()
  const [editing, setEditing] = useState(false)
  if (editing && edit) return <ForgeConfigEdit {...edit} onDone={() => setEditing(false)} />
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (text === undefined) return loading ? <Loading /> : <Hint>{t('没有配置原文')}</Hint>
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <div className="ue:flex ue:items-center ue:justify-end ue:gap-1.5">
        {edit && (
          <ui.Button size="sm" onClick={() => setEditing(true)}>
            <Pencil className="ue:h-3.5 ue:w-3.5" /> {t('编辑')}
          </ui.Button>
        )}
        <ui.Button size="sm" variant="secondary" onClick={onOpen}>
          <SquarePen className="ue:h-3.5 ue:w-3.5" /> {t('用编辑器打开')}
        </ui.Button>
        <ui.Button size="sm" variant="secondary" onClick={() => copyText(text)}>
          <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制')}
        </ui.Button>
      </div>
      <ForgeCodeView text={text} badLine={badLine} />
      {truncated && <p className="ue:text-caption ue:text-subtle">{t('配置太长，只显示了前一部分')}</p>}
    </div>
  )
}

/** 从解析失败的说明里找行号（UEKit 的说明写「第 N 行」，英文版写 line N） */
export function lineFromMessage(msg?: string) {
  const m = msg?.match(/第\s*(\d+)\s*行|line\s+(\d+)/i)
  return m ? Number(m[1] ?? m[2]) : undefined
}
