import { useState, type KeyboardEvent } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { Task } from '../../sdk/web.ts'
import { h, t } from './host.ts'
import { MODE } from './mode.ts'

/**
 * 旧版面板没有开放 TaskComposer（新建对话的输入框）时的退路：一个文本框，发出去用面板默认的 CLI 和模型。
 * 对话不属于项目（projectId 为空），场景存在插件数据目录里
 */
export function SimpleComposer({ onCreated }: { onCreated: (task: Task) => void }) {
  const { panel, ui, hooks, toast, taskSummary } = h()
  const [askUser] = hooks.useNewAskUser()
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    try {
      const created = await panel.createTask({
        projectId: '',
        mode: 'chat',
        workflowId: '',
        agentId: '',
        cli: '',
        model: '',
        effort: '',
        params: {},
        prompt: prompt.trim(),
        attachments: [],
        askUser,
        plugin: MODE,
      })
      setPrompt('')
      onCreated(taskSummary(created) as Task)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bl:flex bl:flex-col bl:gap-2 bl:rounded-2xl bl:border bl:border-line bl:bg-card bl:p-3 bl:shadow-card">
      <ui.Textarea
        rows={4}
        autoFocus
        aria-label={t('要建什么模型')}
        className="bl:border-0 bl:bg-transparent bl:px-1 bl:shadow-none bl:focus:ring-0"
        value={prompt}
        placeholder={t('例如：低多边形风格的宝箱，带开合的盖子，导出 GLB')}
        onChange={(e: { target: { value: string } }) => setPrompt(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void send()
          }
        }}
      />
      <div className="bl:flex bl:justify-end">
        <ui.Button size="sm" disabled={!prompt.trim() || busy} onClick={() => void send()}>
          {busy ? <Loader2 className="bl:h-3.5 bl:w-3.5 bl:animate-spin" /> : <ArrowUp className="bl:h-3.5 bl:w-3.5" />}
          {t('开始建模')}
        </ui.Button>
      </div>
    </div>
  )
}
