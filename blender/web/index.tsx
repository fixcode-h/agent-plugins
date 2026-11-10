import { Box } from 'lucide-react'
import type { ActivateWeb } from '../../sdk/web.ts'
import { setHost, t } from './host.ts'
import { MODE, isModel } from './mode.ts'
import { ModelPage } from './ModelPage.tsx'
import { ModelPreview } from './ModelPreview.tsx'
import { Status } from './Status.tsx'

/**
 * Blender 插件的网页入口（agent-panel 插件 SDK，面板 ADR 0059）：
 * 图标栏里的「模型设计」整页（不在设计模式里，也不用选项目）、模型对话右栏的「模型」预览页签、插件页上的运行状态。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = (host) => {
  setHost(host)
  return {
    // 模型设计对话（task.plugin = blender.model）归这一页：面板不把它们列进 Agent 项目和 Chat，打开时转到这里
    pages: [{ id: 'model', label: t('模型设计'), icon: Box, taskPlugin: MODE, Page: ModelPage }],
    taskTabs: [
      {
        id: 'model',
        label: t('模型'),
        icon: Box,
        when: isModel,
        home: true,
        Panel: ({ task }) => <ModelPreview taskId={task.id} running={task.status === 'running'} />,
      },
    ],
    Status,
  }
}

export default activate
