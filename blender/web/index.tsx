import { Box } from 'lucide-react'
import type { ActivateWeb, Task } from '../../sdk/web.ts'
import { setHost, t } from './host.ts'
import { ModelPreview } from './ModelPreview.tsx'
import { NewModelDialog } from './NewModelDialog.tsx'
import { Status } from './Status.tsx'

/** 模型设计对话：新建时写的 task.plugin，老版本面板建的对话带 modelDesign 标记 */
const MODE = 'blender.model'
const isModel = (task: Task) => task.plugin === MODE || task.modelDesign === true

/**
 * Blender 插件的网页入口（agent-panel 插件 SDK，面板 ADR 0059）：
 * 设计模式里的「模型设计」、模型对话右栏的「模型」预览页签、插件页上的运行状态。
 * 文案在 activate 之后才取：面板先读好包里的英文再调这里。
 */
const activate: ActivateWeb = (host) => {
  setHost(host)
  return {
    designModes: [
      {
        id: MODE,
        name: t('模型设计'),
        desc: t('Blender 建模 · 按项目对话'),
        icon: Box,
        tone: 'bg-peer',
        empty: t('还没有模型设计对话。模型设计用 Blender 建模，对话会按项目列在这里。'),
        newLabel: t('新建模型设计'),
        NewDialog: NewModelDialog,
      },
    ],
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
