import { Copy, SquarePen } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { copyText } from '../../menu.tsx'
import { ErrorBox, Hint, Loading } from './forge-parts.tsx'

/**
 * 「配置原文」页签：只读代码块，带行号和简单的 JSON 着色。
 * 不在页面里编辑 JSON（设计稿 §5：配置是真源，编辑交给编辑器 / Agent），右上角给「用编辑器打开」「复制」。
 * 面板共用控件里没有代码块，这里自己画；颜色只用主题色。
 * 解析失败时说明里常带「第 N 行」，那一行用 danger 底标出来。
 */
export function ForgeConfig({
  loading,
  error,
  text,
  truncated,
  badLine,
  onOpen,
}: {
  loading: boolean
  error: string
  text?: string
  truncated?: boolean
  /** 要标红的行（从 1 数），解析失败时从说明里取 */
  badLine?: number
  onOpen: () => void
}) {
  const { ui, cn } = h()
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (text === undefined) return loading ? <Loading /> : <Hint>{t('没有配置原文')}</Hint>
  const lines = text.split(/\r?\n/)
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:p-4">
      <div className="ue:flex ue:items-center ue:justify-end ue:gap-1.5">
        <ui.Button size="sm" variant="secondary" onClick={onOpen}>
          <SquarePen className="ue:h-3.5 ue:w-3.5" /> {t('用编辑器打开')}
        </ui.Button>
        <ui.Button size="sm" variant="secondary" onClick={() => copyText(text)}>
          <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制')}
        </ui.Button>
      </div>
      <div className="ue:overflow-auto ue:rounded-lg ue:border ue:border-line ue:bg-sel/25 ue:py-2 ue:font-mono ue:text-footnote ue:leading-5">
        <table className="ue:border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className={cn(badLine === i + 1 && 'ue:bg-danger/10')}>
                <td className="ue:pr-3 ue:pl-3 ue:text-right ue:align-top ue:text-subtle ue:select-none">{i + 1}</td>
                <td className="ue:pr-4 ue:whitespace-pre ue:text-fg">{paint(line)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <p className="ue:text-caption ue:text-subtle">{t('配置太长，只显示了前一部分')}</p>}
    </div>
  )
}

// 字符串（后面跟冒号的是 key）、数字、true / false / null
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

/** 一行 JSON 着色：key 用 accent，字符串 success，数字 warning，布尔和 null 用 run */
function paint(line: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(line.slice(last, at))
    const [all, str, colon, num, lit] = m
    if (str !== undefined)
      out.push(
        <span key={at} className={colon ? 'ue:text-accent-text' : 'ue:text-success'}>
          {str}
        </span>,
        colon ?? '',
      )
    else if (num !== undefined)
      out.push(
        <span key={at} className="ue:text-warning">
          {num}
        </span>,
      )
    else if (lit !== undefined)
      out.push(
        <span key={at} className="ue:text-run">
          {lit}
        </span>,
      )
    last = at + all.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** 从解析失败的说明里找行号（UEKit 的说明写「第 N 行」，英文版写 line N） */
export function lineFromMessage(msg?: string) {
  const m = msg?.match(/第\s*(\d+)\s*行|line\s+(\d+)/i)
  return m ? Number(m[1] ?? m[2]) : undefined
}
