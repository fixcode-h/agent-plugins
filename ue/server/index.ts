import type { ActivateServer } from '../../sdk/server.ts'
import { projectState } from './actions.ts'
import { availableVersion } from './uelink.ts'
import { bridgeVersionIn, olderVersion } from './instances.ts'
import { handle } from './api.ts'
import { stopAllBackground } from './editor.ts'
import { stopForgeWatches } from './uekit/forge-watch.ts'
import { stopAllStreams } from './uekit/stream.ts'
import { stopAllLaunchTracks } from './launch/track.ts'
import { stopAllForegroundWatches } from './launch/fg-watch.ts'
import { stopLuaGmWatch } from './lua-gm/scan.ts'
import { installedIn } from './uekit/catalog.ts'
import { EXT_TOOL_PLUGIN } from './uekit/tools-ext.ts'
import { listProjects, projectForRun } from './registry.ts'
import { ueTextifier } from './textify.ts'
import { ueToolDefs, ueTools } from './tools.ts'
import { UE_SUMMARY } from './tool-guides.ts'
import { setCtx, t } from './util.ts'
import { detectUe, enableRegisteredOnce, ueReady } from './capability.ts'

/**
 * UE 插件的服务端入口（agent-panel 插件 SDK，面板 ADR 0059，插件接口 2）。
 * 插件接口 9 起按项目生效：只在项目「能力」里打开了 UE 的项目挂工具（面板把关），目录里有 .uproject 时推荐打开。
 * 网页的 UE 管理页、添加项目和桥接安装走 fetch；Agent 的 ue_* 工具只挂给接入了 UE 的项目里的对话；
 * UE 端是项目里的 UELink 插件（UEKit 插件库 fixcode-h/UEKit 里的基础插件；包里 bridge/UELink 带一份，安装时和插件库最新正式版取高的复制进项目）。
 */

/** 用到这个技能的角色视为 UE 角色（attach=role 时只给它们挂工具） */
const UE_SKILLS = ['ue-runtime-debug', 'ue-asset-authoring', 'ue-perf-analysis']

const HINT = `## UE 工具
这个对话所在的项目接入了 UE（面板「UE」页）。你有 ue_* 工具直接操作正在运行的 UE 编辑器 / 游戏，编辑器没开时也能读资源：
- 先 ue_status 看有哪些进程和世界（编辑器、PIE 客户端 / 服务器），操作时用 target 选；同步属性要在服务器世界改。
- 找对象：ue_find（Actor 按名字前缀）→ ue_get 读属性（属性路径 Stats.MaxHP、Items[2].Count）→ ue_set 改；ue_call 调函数，ue_gm 跑 GM，ue_console 执行命令。
- 看现象：ue_log 取日志（记下 cursor 下次只取新的），ue_screenshot 截视口。
- C++ 逻辑要断点调试：ue_vs_debug（start / attach、wait、step、continue）、ue_vs_breakpoints、ue_vs_inspect（stack、locals、eval），要 VS 装 UEToVS 0.8.0；UE 停在断点时其他 ue_* 都不通，先 continue。
- 卡顿、掉帧、内存高：ue_perf 抓帧数据（CSV Profiler）或内存报告，ue_capture 看摘要、下钻、对比；抓取文件不要直接读。
- 改资源（DataTable、DataAsset）先在运行时验证；资源改动只是暂存，要 ue_save 才写回（会请用户确认）。
- 看资源：ue_asset describe / export / refs；新建、复制、改名、删除也在 ue_asset（先 dryRun；要不要请用户确认看结构性操作权限），不认识的类型用 ue_asset help。
- 蓝图：ue_blueprint outline 看大纲 → graph 读一张图的伪代码 → edit 按操作列表改（先 dryRun 演练，改完看返回的编译结果，有错按节点 id 接着修），保存前用 ue_compile 编译确认通过；ue_find kind=node 跨蓝图搜节点。蓝图资源路径在 ue_get / ue_set 里是类默认值，在 ue_blueprint / ue_asset 里是蓝图本身。
- 工具报错原样告诉用户，不要绕过权限或换别的办法偷偷重试；运行时修改和没保存的资源修改可以 ue_undo 撤回。`

/**
 * 新对话开头提醒用户桥接可以更新（面板插件框架改进 C1，旧面板不显示 notices）：只提醒、不拦，
 * 旧桥接上用不到新操作的功能照常能用，用到时 rpc 会说清楚要更新（instances.ts 的 oldBridgeError）
 */
async function bridgeNotice(root: string) {
  const [installed, bundled] = await Promise.all([bridgeVersionIn(root), availableVersion()])
  if (!installed || installed === '?' || !bundled || !olderVersion(installed, bundled)) return undefined
  return [
    t('项目里的 UE 桥接是 {old}，UELink 已经有 {new}：新功能要更新后才能用。到 UE 页「UE 插件」更新，再重新编译。', {
      old: installed,
      new: bundled,
    }),
  ]
}

/** ue_forge / ue_gametest 只在项目里装了对应的 UEKit 扩展时挂：没装的工具 Agent 用不了，挂上只占说明 */
async function withExtensions<T extends { name: string }>(root: string, tools: T[]) {
  const missing = new Set<string>()
  for (const [tool, plugin] of Object.entries(EXT_TOOL_PLUGIN))
    if (!(await installedIn(root, plugin))) missing.add(tool)
  return tools.filter((x) => !missing.has(x.name))
}

const activate: ActivateServer = async (ctx) => {
  setCtx(ctx)
  // 升级到按项目生效：已经在 UE 页接入过的项目都打开一次，免得升级后工具突然不挂了
  await enableRegisteredOnce().catch((e: Error) => ctx.log.warn('UE：打开已接入项目失败', { error: e.message }))
  return {
    fetch: handle,

    async tools(run) {
      // 设计文档 3.6：只认 Agent 模式（项目里执行）的对话，聊天和设计模式不挂。
      // 旧面板把项目里的对话、子对话也交成 mode=chat（它们存的 task.mode 就是 chat），只看 mode 会让所有项目对话都不挂：
      // Chat 页的对话没有项目，带着项目的一律当项目里的对话
      if (run.mode === 'chat' && !run.projectId) return { skip: t('Chat 页的对话不挂，只在项目里的 Agent 对话挂') }
      if (run.pluginTask) return { skip: t('其他插件的设计模式对话不挂') }
      const project = await projectForRun(run.projectId, run.cwd)
      if (!project) return { skip: t('这个项目还没在 UE 页接入') }
      if (ctx.config().attach === 'role' && !run.skills.some((s) => UE_SKILLS.includes(s)))
        return { skip: t('插件设置为只给 UE 角色挂，这个角色没有 {skills} 技能', { skills: UE_SKILLS.join(' / ') }) }
      return {
        servers: [
          {
            name: 'ue',
            summary: UE_SUMMARY,
            tools: () => withExtensions(project.root, ueTools(project.id, project.root, run.agentName)),
          },
        ],
        hint: run.resume ? undefined : HINT,
        notices: run.resume ? undefined : await bridgeNotice(project.root),
      }
    },

    // 设置 →「MCP」的能力目录（面板插件接口 8）：不开对话也能列出工具和说明
    catalog: () => ({
      servers: [
        {
          name: 'ue',
          summary: UE_SUMMARY,
          attach:
            ctx.config().attach === 'role'
              ? t('在 UE 页接入的项目里、带 UE 技能的角色的 Agent 对话（插件设置为只给 UE 角色）')
              : t('在 UE 页接入的项目里的 Agent 对话（Chat 页不挂）'),
          hint: HINT,
          tools: () => ueToolDefs().map(({ fn: _fn, targets: _t, ...d }) => d),
        },
      ],
    }),

    // 评审看 .uasset 的改动：前后两版经桥接转成文本再比较（面板 7e0339f 起有这个接口，旧面板不调）
    textify: ueTextifier,

    // 项目能力（插件接口 9）：新建项目时按目录推荐，打开了但没接入、没装桥接时提示
    detect: detectUe,
    ready: ueReady,

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
      stopAllStreams()
      stopForgeWatches()
      stopAllLaunchTracks()
      stopAllForegroundWatches()
      stopLuaGmWatch()
    },
  }
}

export default activate
