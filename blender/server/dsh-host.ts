import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { McpContent, McpResult, McpTool, PluginConfig, PluginServerContext } from '../../sdk/server.ts'

/**
 * 在面板进程里跑 dsh-blender-plugin 的宿主层（包里的 dsh/，源码在仓库 blender/dsh/src，改动见 VENDORED.md）。
 * 上游原本挂在 DSH 宿主上：工具交给宿主注册、截图交给宿主的附件服务、生命周期交给 cordis 的 effect。
 * 面板给它一个最小的宿主（下面的 ctx），6 个工具的参数、说明、执行和回执文字都原样用上游的，
 * 再由面板以 MCP 交给 CLI。Gateway 是上游运行时起的子进程（dsh/lib/runtime/gateway.js）。
 */

/** 包里 dsh 副本的根：dsh/lib/panel-entry.js、dsh/lib/runtime/gateway.js、dsh/runtime/py/ 和上游 npm 包的布局一致 */
let root = ''
let logger: PluginServerContext['log'] | undefined

export function initDsh(ctx: PluginServerContext) {
  root = path.join(ctx.dir, 'dsh')
  logger = ctx.log
}

/** Blender 扩展（DSH Blender Bridge）的安装包，插件页提供下载 */
export const addonZipPath = () => path.join(root, 'extension', 'dsh_blender_bridge.zip')

/**
 * 插件参数 → 上游认的环境变量。宿主层在本进程读，Gateway 子进程启动时继承，所以要在加载和起 Gateway 之前设好；
 * 参数改了插件会重启（index.ts 的 onConfig）。留空、「按系统」的不设，交给上游自己的默认值和查找顺序。
 */
function applyDshEnv(cfg: PluginConfig) {
  const set = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === '') delete process.env[k]
    else process.env[k] = String(v)
  }
  set('DSH_PANEL_HOST', '1')
  // 写权限、会话归属按宿主 id 认：面板重启后还是同一个宿主，接得上原来的 Blender 会话
  set('DSH_HOST_ID', 'agent-panel')
  set('DSH_BLENDER_GATEWAY_ENTRY', path.join(root, 'lib', 'runtime', 'gateway.js'))
  set('DSH_BLENDER_EXE', String(cfg.blenderPath ?? ''))
  set('DSH_BLENDER_WORKDIR', String(cfg.workDir ?? ''))
  set('DSH_BLENDER_GATEWAY_PORT', Number(cfg.gatewayPort) || undefined)
  set('DSH_BLENDER_VIRTUAL_GUI', cfg.virtualGui === 'default' ? undefined : String(cfg.virtualGui ?? ''))
  set('DSH_BLENDER_VIRTUAL_GUI_MAX', Number(cfg.virtualGuiMax) || undefined)
  set('DSH_HEADLESS_WAIT_MS', Number(cfg.headlessWaitSeconds) ? Number(cfg.headlessWaitSeconds) * 1000 : undefined)
  set('DSH_BLENDER_LEASE_TTL_MS', Number(cfg.leaseMinutes) ? Number(cfg.leaseMinutes) * 60_000 : undefined)
}

/** 上游工具定义里面板会读的几项（defineTool 在面板里原样返回定义，见 dsh/src/host/dsh-tools-shim.ts） */
interface DshTool {
  name: string
  description: string
  parameters?: Record<string, { type?: string; description?: string; required?: boolean }>
  output?: { render?: (args: unknown, value: unknown) => { type: string; text?: string; attachment?: unknown }[] }
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

interface DshModule {
  registerTools: (ctx: unknown, port: number) => void
  registerLifecycle: (ctx: unknown, port: number, autoStart: boolean) => void
  ensureBackend: (port: number) => Promise<boolean>
  killChildHandle: () => boolean
  probe: (port: number, timeoutMs?: number) => Promise<boolean>
  resolveHttpPort: () => number
  legacyToolHint: (name: unknown) => string | undefined
  PLUGIN_VERSION: string
}

/** 调用者身份：上游按它区分会话、给子 Agent 授写权限（父对话 main，子对话 subagent） */
export interface DshCaller {
  taskId: string
  parentTaskId?: string
  name?: string
}

/** 截图：上游存进宿主的附件服务，面板放内存里（MCP 结果里直接带图），只留最近的几十张 */
const images = new Map<string, { data: Uint8Array; mediaType: string }>()
const IMAGE_KEEP = 64

function pngSize(data: Uint8Array) {
  // PNG 头：宽高在 IHDR 的第 16–24 字节，大端
  if (data.length < 24) return { width: 0, height: 0 }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

const attachments = {
  imageLimits: { mediaTypes: ['image/png', 'image/jpeg'] },
  async saveImage(input: { data: Uint8Array; mediaType: string; name: string }) {
    const attachmentId = randomUUID()
    images.set(attachmentId, { data: input.data, mediaType: input.mediaType })
    while (images.size > IMAGE_KEEP) images.delete(images.keys().next().value!)
    return {
      attachmentId,
      mediaType: input.mediaType,
      bytes: input.data.length,
      ...pngSize(input.data),
      name: input.name,
    }
  },
}

let mod: DshModule | null = null
let loading: Promise<DshModule> | null = null
const tools = new Map<string, DshTool>()
const disposers: (() => void)[] = []
let registeredPort = 0

/** 上游 cordis ctx 里面板要提供的几样：effect（返回清理函数）、tools.register / guard、get('attachments')、logger */
const ctx = {
  effect(fn: () => unknown) {
    const d = fn()
    if (typeof d === 'function') disposers.push(d as () => void)
  },
  tools: {
    register(def: DshTool) {
      tools.set(def.name, def)
      return () => tools.delete(def.name)
    },
    // 上游用 guard 把旧工具名变成「改用哪个工具」的提示；面板对没有的工具名统一报错，这里不接
    guard: () => () => {},
  },
  get: (name: string) => (name === 'attachments' ? attachments : undefined),
  logger: { warn: (m: string) => logger?.warn(m), info: (m: string) => logger?.info(m) },
}

async function load(cfg: PluginConfig): Promise<DshModule> {
  // 参数每次都重设：宿主层按调用时的环境变量取端口，Gateway 子进程启动时继承
  applyDshEnv(cfg)
  if (mod) return mod
  loading ??= (async () => {
    const entry = path.join(root, 'lib', 'panel-entry.js')
    if (!existsSync(entry)) throw new Error(`插件包里缺少 ${entry}，请重新安装 Blender 插件`)
    // 同一个进程里 ESM 按地址缓存：升级插件后上游模块要等面板重启才换成新版（入口和 Gateway 子进程会用新的）
    const m = (await import(pathToFileURL(entry).href)) as DshModule
    logger?.info('已加载 dsh-blender-plugin', { version: m.PLUGIN_VERSION })
    mod = m
    return m
  })()
  try {
    return await loading
  } catch (e) {
    loading = null
    throw e
  }
}

/** 停掉：清掉看护、杀掉 Gateway 子进程、注销工具（插件关掉、参数变了要重启时） */
export function stopDsh() {
  while (disposers.length) {
    try {
      disposers.pop()!()
    } catch {
      /* 清理失败不影响别的 */
    }
  }
  tools.clear()
  registeredPort = 0
  mod?.killChildHandle()
}

/**
 * 启动：注册 6 个工具，「打开插件时就启动 Gateway」开着时起 Gateway 并开 15 秒看护（上游的 registerLifecycle）。
 * 端口取上游的 resolveHttpPort（读 applyDshEnv 设好的 DSH_BLENDER_GATEWAY_PORT）。已经起过就不重来；参数改了由调用方先 stopDsh
 */
export async function startDsh(cfg: PluginConfig) {
  const m = await load(cfg)
  const port = m.resolveHttpPort()
  if (registeredPort === port && tools.size) return m
  stopDsh()
  m.registerTools(ctx, port)
  if (cfg.autoStart !== false) m.registerLifecycle(ctx, port, true)
  registeredPort = port
  return m
}

/** Gateway 状态（插件页）：活着没有、端口 */
export async function dshGateway() {
  if (!mod || !registeredPort) return { running: false, port: 0 }
  return { running: await mod.probe(registeredPort, 1500), port: registeredPort }
}

/** 上游参数写法（平铺的 { 名字: { type, description, required } }）转成 JSON Schema；type: 'json' 是任意值 */
function inputSchema(params: DshTool['parameters']) {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []
  for (const [k, p] of Object.entries(params ?? {})) {
    properties[k] = {
      ...(p.type && p.type !== 'json' ? { type: p.type } : {}),
      ...(p.description ? { description: p.description } : {}),
    }
    if (p.required) required.push(k)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

/** 上游回执 → MCP 内容：按工具自己的 render 拆成文字和图片；没有 render 时取 text / image / images */
function toMcp(def: DshTool, args: unknown, value: unknown): McpResult {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const blocks: { type: string; text?: string; attachment?: unknown }[] = def.output?.render
    ? def.output.render(args, value)
    : [
        { type: 'text', text: String(v.text ?? '') },
        ...[v.image, ...(Array.isArray(v.images) ? v.images : [])]
          .filter(Boolean)
          .map((attachment) => ({ type: 'image', attachment })),
      ]
  const content: McpContent[] = []
  for (const b of blocks) {
    if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text })
    if (b.type === 'image') {
      const id = (b.attachment as { attachmentId?: string } | undefined)?.attachmentId
      const img = id ? images.get(id) : undefined
      if (img) content.push({ type: 'image', data: Buffer.from(img.data).toString('base64'), mimeType: img.mediaType })
    }
  }
  if (!content.length) content.push({ type: 'text', text: JSON.stringify(value ?? null) })
  // 上游的失败统一带 envelope.error（toolError），交给 CLI 时标成出错
  const failed = !!(v.envelope && typeof v.envelope === 'object' && (v.envelope as { error?: unknown }).error)
  return { content, ...(failed ? { isError: true } : {}) }
}

/** 给一轮对话的 6 个工具：执行时带上这轮对话的身份（上游从 exec.agent 里取） */
export async function dshTools(caller: DshCaller, cfg: PluginConfig): Promise<McpTool[]> {
  await startDsh(cfg)
  const exec = (callId: string) => ({
    callId,
    agent: {
      id: caller.taskId,
      name: caller.name,
      role: caller.parentTaskId ? 'subagent' : 'main',
      ...(caller.parentTaskId ? { parentAgentId: caller.parentTaskId } : {}),
      session: { id: caller.parentTaskId ?? caller.taskId },
    },
  })
  return [...tools.values()].map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: inputSchema(def.parameters),
    call: async (args, c) => {
      // Gateway 可能还没起（「打开插件时就启动」关着）：上游各工具自己会 ensureBackend
      const value = await def.execute(args, exec(c.callId))
      return toMcp(def, args, value)
    },
  }))
}
