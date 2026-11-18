import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../../host.ts'
import { agentWritePrompt } from './agent-write-prompt.ts'
import { useGtAgentChat } from './useGtAgentChat.tsx'

/**
 * GameTest 页「新建 → 让 Agent 写」（定稿 11.1）：写一句要测什么，用「游戏测试」角色开一个对话，
 * Agent 按技能 ue-gametest-authoring 读代码、写脚本、校验、跑；写好的脚本出现在场景库（tags 带 agent）。
 */
export function useGtAgentWrite(root: string) {
  const agent = useGtAgentChat()
  const [dir, setDir] = useState<string>()

  const dialog = (
    <>
      {dir !== undefined && (
        <AgentWriteDialog
          dir={dir}
          hasRole={agent.hasRole}
          onClose={() => setDir(undefined)}
          onSend={(need, refs) => {
            agent.start(agentWritePrompt({ need, refs, root, dir }))
            setDir(undefined)
          }}
        />
      )}
      {agent.dialog}
    </>
  )
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
