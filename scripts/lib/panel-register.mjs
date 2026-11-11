// node --import 这个文件：先挂面板的 tsx（跑 .ts/.tsx），再挂插件的解析钩子（scripts/lib/panel-hooks.mjs）
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const panel = path.resolve(process.env.AGENT_PLUGIN_PANEL)
const plugin = path.resolve(process.env.AGENT_PLUGIN_DIR)
await import(pathToFileURL(path.join(panel, 'node_modules/tsx/dist/esm/api/index.mjs')).href).then((m) => m.register())
register('./panel-hooks.mjs', import.meta.url, { data: { plugin, panel } })
