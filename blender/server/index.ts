import { readFile } from 'node:fs/promises'
import type { ActivateServer, McpTool, PluginConfig, PluginRun } from '../../sdk/server.ts'
import { addonTargets, installAddon } from './addon-install.ts'
import { addonZipPath, dshGateway, dshToolDefs, dshTools, initDsh, startDsh, stopDsh } from './dsh-host.ts'
import { DSH_SUMMARY, MODEL_SUMMARY, withGuide } from './tool-guides.ts'
import { MODEL_HINT } from './model-meta.ts'
import { MODEL_TOOLS } from './model-tools.ts'
import { blenderStatus, initModel, readGlb, readModelMeta, stopModel } from './model.ts'

/**
 * Blender 插件的服务端入口（agent-panel 插件 SDK，面板 ADR 0059）。两块能力：
 * - dsh-blender-plugin 的 6 个工具（blender_session / op / py / see / run / inspect），MCP 服务名 blender：
 *   驱动用户自己开着的 Blender（装了 DSH Blender Bridge 扩展）、虚拟 GUI 和无头作业，Gateway 是上游的子进程；
 * - 模型设计（面板 ADR 0025）：每个模型对话一个后台 Blender，blender_python / blender_scene 两个工具，MCP 服务名 blender-model，
 *   网页右栏的「模型」页签实时预览。
 */

/** 模型设计对话的 task.plugin（和网页部分模型设计页的 taskPlugin 一致） */
const MODEL_MODE = 'blender.model'
/** 用到这些技能的角色视为 Blender 角色：对话挂上 dsh 的工具 */
const BLENDER_SKILLS = ['blender-modeling', 'blender', 'blender-model-animation-workflow']

/** 给 Agent 的 dsh 工具说明：上游的工具说明已经很全，这里只说就绪检查和 GUI 优先 */
const DSH_HINT = `## Blender 工具
面板挂了 Blender 工具（blender_session / blender_op / blender_py / blender_see / blender_run / blender_inspect）：
- 先 blender_session(action="doctor")，kind=ok 才算就绪；没有 GUI 会话时说明情况，请用户打开 Blender 并在「DSH Blender Bridge」面板点连接，不要绕过。
- GUI 优先：改场景用 blender_py，看结果用 blender_see；超过约 1 秒的重活、批量渲染用 blender_run（kind=headless / render）。
- 写操作前用 blender_session 的 txn 打快照，改坏了回滚；pause、resume 只有用户能做。`

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

/** 这些参数变了要重启（环境变量在加载宿主层、起 Gateway 时读）；attach 只影响下一轮对话，不用重启 */
const RESTART_KEYS = [
  'blenderPath',
  'workDir',
  'gatewayPort',
  'virtualGui',
  'virtualGuiMax',
  'headlessWaitSeconds',
  'leaseMinutes',
  'autoStart',
]

const activate: ActivateServer = async (ctx) => {
  initDsh(ctx)
  initModel(ctx)
  // 「打开插件时就启动 Gateway」：起失败不影响插件打开，状态面板和第一次调用工具时会报出来
  let startError = ''
  if (ctx.config().autoStart !== false)
    await startDsh(ctx.config()).catch((e: Error) => {
      startError = e.message
      ctx.log.warn('启动 Gateway 失败', { error: e.message })
    })

  // 自检（run.dryRun，插件接口 8）只列定义：不起 Gateway
  const dshServer = (run: PluginRun) => ({
    name: 'blender',
    summary: DSH_SUMMARY,
    tools: async (): Promise<McpTool[]> =>
      run.dryRun
        ? dshToolDefs().map((d) => ({ ...d, call: async () => ({ content: [] }) }))
        : dshTools({ taskId: run.taskId, parentTaskId: run.parentTaskId, name: run.agentName }, ctx.config()),
  })
  const modelTools = () => MODEL_TOOLS.map(withGuide)

  return {
    async fetch(req) {
      const url = new URL(req.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      // 把扩展装进本机 Blender：多个版本时网页先列出来让用户选，再按版本号装
      if (req.method === 'POST' && parts[0] === 'addon' && parts[1] === 'install' && parts.length === 2) {
        const body = (await req.json().catch(() => ({}))) as { version?: string }
        const targets = await addonTargets(String(ctx.config().blenderPath ?? '').trim())
        const target = targets.find((x) => x.version === body.version)
        if (!target) return json({ error: ctx.t('没有找到 Blender {version}', { version: body.version ?? '' }) }, 404)
        try {
          return json(await installAddon(target, addonZipPath(), ctx.t))
        } catch (e) {
          ctx.log.warn('安装 Blender 扩展失败', { version: target.version, error: (e as Error).message })
          return json({ error: (e as Error).message }, 500)
        }
      }
      if (req.method !== 'GET') return json({ error: 'not found' }, 404)
      if (parts[0] === 'addon' && parts[1] === 'targets' && parts.length === 2)
        return json(await addonTargets(String(ctx.config().blenderPath ?? '').trim()))
      if (parts[0] === 'status' && parts.length === 1) return json(await blenderStatus())
      if (parts[0] === 'addon.zip' && parts.length === 1) {
        const buf = await readFile(addonZipPath()).catch(() => null)
        if (!buf) return json({ error: ctx.t('插件包里没有 Blender 扩展') }, 404)
        return new Response(new Uint8Array(buf), {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="dsh_blender_bridge.zip"',
          },
        })
      }
      if (parts[0] === 'models' && parts.length === 2) return json(await readModelMeta(parts[1]))
      if (parts[0] === 'models' && parts.length === 3 && parts[2] === 'scene.glb') {
        const buf = await readGlb(parts[1])
        if (!buf) return json({ error: ctx.t('还没有模型') }, 404)
        // 版本号在地址里（?v=），每次都向服务端确认
        return new Response(new Uint8Array(buf), {
          headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-cache' },
        })
      }
      return json({ error: 'not found' }, 404)
    },

    tools(run) {
      const cfg = ctx.config()
      const model = run.pluginTask === MODEL_MODE
      const blenderAgent = run.skills.some((s) => BLENDER_SKILLS.includes(s))
      const all = cfg.attach === 'all'
      if (!model && !blenderAgent && !all)
        return {
          skip: ctx.t('这个角色没有 Blender 技能（{skills}），插件设置为只给 Blender 角色和模型设计对话挂', {
            skills: BLENDER_SKILLS.join(' / '),
          }),
        }
      const servers = [dshServer(run)]
      const hints = [DSH_HINT]
      if (model) {
        servers.push({ name: 'blender-model', summary: MODEL_SUMMARY, tools: async () => modelTools() })
        hints.unshift(MODEL_HINT)
      }
      return { servers, hint: run.resume ? undefined : hints.join('\n\n') }
    },

    // 设置 →「MCP」的能力目录（插件接口 8）
    catalog: () => ({
      servers: [
        {
          name: 'blender',
          summary: DSH_SUMMARY,
          attach:
            ctx.config().attach === 'all'
              ? ctx.t('所有对话（插件设置为全部挂）')
              : ctx.t('带 Blender 技能的角色的对话，以及模型设计对话'),
          hint: DSH_HINT,
          tools: dshToolDefs,
        },
        {
          name: 'blender-model',
          summary: MODEL_SUMMARY,
          attach: ctx.t('只在 Blender 页的模型设计对话里'),
          hint: MODEL_HINT,
          tools: modelTools,
        },
      ],
    }),

    onConfig(next: PluginConfig, prev: PluginConfig) {
      return RESTART_KEYS.some((k) => next[k] !== prev[k])
    },

    async status() {
      const [blender, gateway] = await Promise.all([blenderStatus(), dshGateway()])
      return {
        blenderPath: blender.path,
        blenderVersion: blender.version,
        blenderError: blender.error,
        gatewayRunning: gateway.running,
        gatewayPort: gateway.port,
        gatewayError: startError,
      }
    },

    async stop() {
      stopDsh()
      await stopModel()
    },
  }
}

export default activate
