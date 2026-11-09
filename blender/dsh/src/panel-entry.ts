/**
 * Agent 面板改动（不在上游）：面板加载上游宿主层的唯一入口，见 ../VENDORED.md。
 * 上游的 src/index.ts / plugin.ts 依赖 DSH 宿主（cordis、schemastery、TUI），面板不用；
 * 这里只转出注册 6 个工具、生命周期（Gateway 自动拉起和看护）和 Gateway 进程控制要用的函数，实现一行不改。
 */
export { registerTools } from './tools/index.js'
export { registerLifecycle } from './plugin-lifecycle.js'
export { ensureBackend, killChildHandle, probe, resolveHttpPort } from './host/backend/index.js'
export { legacyToolHint } from './tools/migration.js'
export { PLUGIN_VERSION } from './constants.js'
