import type { ActivateWeb, Task } from '../../sdk/web.ts'
import type { UeProject } from '../server/types.ts'
import { get } from './api.ts'
import { setHost } from './host.ts'
import { GamepadIcon } from './icon.tsx'
import { Status } from './Status.tsx'
import { TaskPanel } from './TaskPanel.tsx'
import { UePage } from './UePage.tsx'

/** 接入了 UE 的面板项目（对话右栏的「UE」页签按它判断）：激活时取一次，之后每分钟刷新 */
let ueProjects = new Set<string>()
async function refresh() {
  ueProjects = new Set(
    (await get<{ projects: UeProject[] }>('/projects').catch(() => ({ projects: [] }))).projects.map((p) => p.id),
  )
}

/**
 * UE 插件的网页入口（agent-panel 插件 SDK，插件接口 2）：图标栏里的 UE 管理页、接入 UE 的项目里对话右栏的「UE」页签、
 * 插件页上的运行状态。文案在 activate 之后才取：面板先读好包里的英文再调这里
 */
const activate: ActivateWeb = (host) => {
  setHost(host)
  void refresh()
  setInterval(() => void refresh(), 60000)
  return {
    pages: [{ id: 'main', label: 'UE', icon: GamepadIcon, Page: UePage }],
    taskTabs: [
      {
        id: 'ue',
        label: 'UE',
        icon: GamepadIcon,
        when: (task: Task) => ueProjects.has(task.projectId) && task.mode !== 'chat' && !task.plugin,
        Panel: ({ task }) => <TaskPanel taskId={task.id} projectId={task.projectId} />,
      },
    ],
    Status,
  }
}

export default activate
