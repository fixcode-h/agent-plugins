import type { ActivateServer } from '../../sdk/server.ts'
import { projectState } from './actions.ts'
import { handle } from './api.ts'
import { stopAllBackground } from './editor.ts'
import { listProjects, projectForRun } from './registry.ts'
import { ueTools } from './tools.ts'
import { setCtx } from './util.ts'

/**
 * UE 插件的服务端入口（agent-panel 插件 SDK，面板 ADR 0059，插件接口 2）。
 * 网页的 UE 管理页、添加项目和桥接安装走 fetch；Agent 的 12 个 ue_* 工具只挂给接入了 UE 的项目里的对话；
 * UE 端是项目里的 AgentPanelBridge 插件（包里 bridge/ 目录，安装时复制进项目）。
 */

/** 用到这个技能的角色视为 UE 角色（attach=role 时只给它们挂工具） */
const UE_SKILL = 'ue-runtime-debug'

const HINT = `## UE 工具
这个对话所在的项目接入了 UE（面板「UE」页）。你有 ue_* 工具直接操作正在运行的 UE 编辑器 / 游戏，编辑器没开时也能读资源：
- 先 ue_status 看有哪些进程和世界（编辑器、PIE 客户端 / 服务器），操作时用 target 选；同步属性要在服务器世界改。
- 找对象：ue_find（Actor 按名字前缀）→ ue_get 读属性（属性路径 Stats.MaxHP、Items[2].Count）→ ue_set 改；ue_call 调函数，ue_gm 跑 GM，ue_console 执行命令。
- 看现象：ue_log 取日志（记下 cursor 下次只取新的），ue_screenshot 截视口。
- 改资源（DataTable、DataAsset）先在运行时验证；资源改动只是暂存，要 ue_asset save 才写回（会请用户确认）。
- 工具报错原样告诉用户，不要绕过权限或换别的办法偷偷重试；运行时修改可以 ue_undo 撤回。`

const activate: ActivateServer = async (ctx) => {
  setCtx(ctx)
  return {
    fetch: handle,

    async tools(run) {
      // 设计文档 3.6：只认 Agent 模式（项目里执行）的对话，聊天和设计模式不挂
      if (run.mode === 'chat' || run.pluginTask) return undefined
      const project = await projectForRun(run.projectId, run.cwd)
      if (!project) return undefined
      if (ctx.config().attach === 'role' && !run.skills.includes(UE_SKILL)) return undefined
      return {
        servers: [{ name: 'ue', tools: () => ueTools(project.id, run.agentName) }],
        hint: run.resume ? undefined : HINT,
      }
    },

    async status() {
      const projects = await listProjects()
      const states = await Promise.all(projects.map((p) => projectState(p).catch(() => undefined)))
      return {
        projects: projects.length,
        running: states.reduce((n, s) => n + (s?.instances.filter((i) => i.online).length ?? 0), 0),
        items: states.filter(Boolean).map((s) => ({
          name: s!.project.name,
          engine: s!.project.engine.version,
          bridge: s!.bridge,
          bundled: s!.bundled,
          instances: s!.instances.length,
        })),
      }
    },

    stop() {
      stopAllBackground()
    },
  }
}

export default activate
