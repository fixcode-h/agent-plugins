import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { PathText } from '../../path-text.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { aiEditPrompt } from './forge-prompts.ts'

/**
 * 「让 AI 改…」（用户 2026-11-16 同意的扩展）：对一份已有配置写一句改动需求，交给对话里的 Agent。
 * 内容放进对话输入框，用户看过再发；Agent 改完存盘，右栏正盯着这份配置（forge-watch），会自动刷新差异和计划。
 */
export function ForgeAiEdit({
  entry,
  configRoot,
  onClose,
  onSend,
}: {
  entry: ForgeEntry
  configRoot: string
  onClose: () => void
  onSend: (prompt: string) => void
}) {
  const { ui } = h()
  const [need, setNeed] = useState('')
  const send = () =>
    need.trim() &&
    onSend(
      aiEditPrompt({
        kind: entry.kind,
        asset: entry.asset,
        config: entry.config!.replace(/\\/g, '/'),
        configRoot,
        need,
      }),
    )
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('让 AI 改这份配置')}
      footer={
        <>
          <span className="ue:flex-1" />
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!need.trim()} onClick={send}>
            <Sparkles className="ue:h-3.5 ue:w-3.5" />
            {t('交给 Agent')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <p className="ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:text-footnote ue:text-subtle">
          <span className="ue:shrink-0">{t('配置')}</span>
          <PathText path={entry.config ?? ''} tail={3} className="ue:text-muted" />
        </p>
        <ui.Field
          label={t('要怎么改')}
          hint={t('Agent 只改需要改的地方，改完演练、不导入；存盘后这里自动刷新差异和计划')}
        >
          <ui.Textarea
            rows={5}
            value={need}
            placeholder={t('例如：标题字号改成 32，关闭按钮挪到右上角，加一个金币数量的文本')}
            onChange={(e: { target: { value: string } }) => setNeed(e.target.value)}
          />
        </ui.Field>
      </div>
    </ui.Modal>
  )
}
