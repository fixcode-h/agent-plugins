import { Copy, FileText, Loader2, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { copyText } from '../../menu.tsx'
import { ErrorText, Note, Term } from '../../ui.tsx'

/**
 * 一步失败时 GameTest 自动留下的证据（1.2 起，报告里那一步的 payload.evidence）：都是相对项目根的路径，
 * 内容不进报告，要看时面板按路径读文件（截图走 ext/file，日志、控件快照走 ext/gt/text）
 */
export interface GtEvidenceData {
  dir?: string
  screenshot?: string
  screenshotError?: string
  widgets?: string
  screens?: number
  log?: string
  target?: { path?: string; class?: string; text?: string; visibility?: string; enabled?: boolean }
  selectorError?: string
}

export const evidenceOf = (payload?: Record<string, unknown>): GtEvidenceData | undefined => {
  const e = payload?.evidence
  return e && typeof e === 'object' && !Array.isArray(e) ? (e as GtEvidenceData) : undefined
}

/**
 * 步骤详情里的「失败证据」：截图、选择器这一刻找不找得到（找得到说明控件在、但没点成；找不到列出候选）、
 * 失败前后的日志（点开才读文件）。imageUrl / loadText 由页面给：设置的组件页里没有 UE 项目，示例不给，按钮就是灰的
 */
export function GtEvidence({
  e,
  imageUrl,
  loadText,
  onAgent,
}: {
  e: GtEvidenceData
  imageUrl?: (path: string) => string
  loadText?: (path: string) => Promise<{ text: string; truncated?: boolean }>
  onAgent?: () => void
}) {
  const { ui } = h()
  const [log, setLog] = useState<{ text: string; truncated?: boolean }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const openLog = () => {
    if (!e.log || !loadText) return
    setLoading(true)
    setError('')
    loadText(e.log)
      .then(setLog)
      .catch((x: Error) => setError(x.message))
      .finally(() => setLoading(false))
  }
  const visible = e.target && e.target.visibility !== 'Collapsed' && e.target.visibility !== 'Hidden'
  return (
    <section className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-3 ue:text-footnote">
      <div className="ue:flex ue:items-center ue:gap-2">
        <h3 className="ue:text-caption ue:font-medium ue:text-subtle">{t('失败证据')}</h3>
        {e.dir && (
          <code className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{e.dir}</code>
        )}
        {e.dir && <ui.IconButton icon={Copy} size="sm" label={t('复制证据目录')} onClick={() => copyText(e.dir!)} />}
        {onAgent && (
          <ui.Button size="sm" variant="secondary" onClick={onAgent}>
            <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('交给 Agent')}
          </ui.Button>
        )}
      </div>
      {e.target ? (
        <p className="ue:leading-relaxed ue:text-fg">
          {t('这一刻选择器找得到控件（{c}，{v}，{en}）：控件在，这一步没成的原因看截图和日志', {
            c: e.target.class ?? '?',
            v: visible ? t('可见') : t('不可见'),
            en: e.target.enabled === false ? t('禁用') : t('可用'),
          })}
          {e.target.path && <span className="ue:ml-1 ue:font-mono ue:text-subtle">{e.target.path}</span>}
        </p>
      ) : (
        e.selectorError && (
          <Note>
            <span className="ue:font-medium">{t('这一刻选择器找不到控件')}</span>
            <span className="ue:mt-1 ue:block ue:whitespace-pre-wrap ue:break-all ue:text-muted">
              {e.selectorError}
            </span>
          </Note>
        )
      )}
      {e.screenshot && imageUrl ? (
        <img alt={t('失败时的截图')} src={imageUrl(e.screenshot)} className="ue:rounded-lg ue:border ue:border-line" />
      ) : (
        e.screenshotError && <p className="ue:text-subtle">{t('没截到图：{e}', { e: e.screenshotError })}</p>
      )}
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
        {e.log && (
          <ui.Button size="sm" variant="secondary" disabled={!loadText || loading} onClick={openLog}>
            {loading ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <FileText className="ue:h-3.5 ue:w-3.5" />
            )}{' '}
            {log ? t('重新读日志') : t('看前后日志')}
          </ui.Button>
        )}
        {e.widgets && (
          <ui.Button size="sm" variant="secondary" onClick={() => copyText(e.widgets!)}>
            <Copy className="ue:h-3.5 ue:w-3.5" /> {t('复制控件快照路径')}
            {e.screens !== undefined && <span className="ue:text-subtle">{t('（{n} 个屏）', { n: e.screens })}</span>}
          </ui.Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {log && (
        <Term className="ue:max-h-80">
          <pre className="ue:whitespace-pre-wrap">{log.text}</pre>
          {log.truncated && <p className="ue:text-subtle">{t('文件太长，只显示开头一段')}</p>}
        </Term>
      )}
    </section>
  )
}
