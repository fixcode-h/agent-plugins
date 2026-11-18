import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { useToChat } from '../../../chat.tsx'

/**
 * 用「游戏测试」角色开一个对话（定稿 11.1：「让 Agent 写」「让 Agent 看」共用）。
 * 项目里加了这个角色就直接建对话并跳过去；还没加时把同样的话放进对话输入框（用户选对话、看过再发），技能照样能用。
 */
const ROLE = 'builtin:ue-gametest'

interface AgentLite {
  id: string
  origin?: string
}

export function useGtAgentChat() {
  const { project } = useUe()
  const { hooks, panel, toast } = h()
  const data = hooks.useData() as unknown as { agents?: AgentLite[]; upsertTask?: (x: unknown) => void }
  const nav = hooks.useNav()
  const chat = useToChat()
  const role = data.agents?.find((a) => a.origin === ROLE)

  const start = async (prompt: string) => {
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

  return {
    hasRole: !!role,
    /** 没有角色、面板也没有「发给对话」钩子时用不了 */
    available: !!role || chat.available,
    start: (prompt: string) => void start(prompt),
    dialog: chat.dialog,
  }
}
