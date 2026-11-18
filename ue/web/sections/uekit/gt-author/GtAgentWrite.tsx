import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useToChat } from '../../../chat.tsx'
import { agentWritePrompt } from './agent-write-prompt.ts'

/**
 * GameTest 页「新建 → 让 Agent 写」（定稿 11.1）：写一句要测什么，用「游戏测试」角色开一个对话，
 * Agent 按技能 ue-gametest-authoring 读代码、写脚本、校验、跑；写好的脚本出现在场景库（tags 带 agent）。
 * 项目里还没加「游戏测试」角色时，把同样的话放进新对话的输入框（用户看过再发），技能照样能用。
 */
const ROLE = 'builtin:ue-gametest'

interface AgentLite {
  id: string
  origin?: string
}

export function useGtAgentWrite(root: string) {
  const { project } = useUe()
  const { hooks, panel, toast, ui } = h()
  const data = hooks.useData() as unknown as { agents?: AgentLite[]; upsertTask?: (x: unknown) => void }
  const nav = hooks.useNav()
  const chat = useToChat()
  const [dir, setDir] = useState<string>()
  const role = data.agents?.find((a) => a.origin === ROLE)

  const send = async (need: string, refs: string) => {
    const prompt = agentWritePrompt({ need, refs, root, dir: dir ?? '' })
    setDir(undefined)
    if (!role) {
      chat.send(prompt)
      toast.success(t('在 Agent 角色里添加「游戏测试」后，可以直接用它开对话'))
      return
    }
    try {
      const task = await panel.createTask({
        projectId: project.id,
        mode: 'agent',
        workflowId: '',
        agentId: role.id,
        cli: '',
        model: '',
        effort: '',
        params: {},
        prompt,
        attachments: [],
      })
      data.upsertTask?.(task)
      nav.go({ page: 'projects', id: project.id, sub: task.id })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const dialog = (
    <>
      {dir !== undefined && (
        <AgentWriteDialog
          dir={dir}
          hasRole={!!role}
          onClose={() => setDir(undefined)}
          onSend={(need, refs) => void send(need, refs)}
        />
      )}
      {chat.dialog}
    </>
  )
  void ui
  return { open: (inDir: string) => setDir(inDir), dialog }
}

function AgentWriteDialog({
  dir,
  hasRole,
  onClose,
  onSend,
}: {
  dir: string
  hasRole: boolean
  onClose: () => void
  onSend: (need: string, refs: string) => void
}) {
  const { ui } = h()
  const [need, setNeed] = useState('')
  const [refs, setRefs] = useState('')
  return (
    <ui.Modal
      open
      onOpenChange={(v: boolean) => !v && onClose()}
      title={t('让 Agent 写测试')}
      footer={
        <>
          <span className="ue:flex-1" />
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!need.trim()} onClick={() => onSend(need, refs)}>
            <Sparkles className="ue:h-3.5 ue:w-3.5" />
            {hasRole ? t('开始写') : t('放进新对话')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
          {t(
            'Agent 读项目代码，查能用的变量、控件和接口，写 GameTest 脚本、校验、在编辑器里跑；失败时会判断是功能问题还是脚本问题。不用录制。',
          )}
        </p>
        <ui.Field label={t('要测什么')}>
          <ui.Textarea
            rows={4}
            autoFocus
            value={need}
            placeholder={t('例如：背包「一键出售」卖掉所有灰色装备，金币增加、列表里不再有它们')}
            onChange={(e: { target: { value: string } }) => setNeed(e.target.value)}
          />
        </ui.Field>
        <ui.Field label={t('参考（可选）')} hint={t('提交号、需求文档、相关代码的路径，Agent 会先读它们')}>
          <ui.Input
            value={refs}
            placeholder={t('例如：Content/Script/UI/Bag/BagPanel.lua，或提交 a1b2c3d')}
            onChange={(e: { target: { value: string } }) => setRefs(e.target.value)}
          />
        </ui.Field>
        <p className="ue:text-footnote ue:text-subtle">
          {t('写在：{d}', { d: dir || t('场景根') })}
          {!hasRole && ` · ${t('项目里还没有「游戏测试」角色：内容会放进新对话的输入框，你看过再发')}`}
        </p>
      </div>
    </ui.Modal>
  )
}
