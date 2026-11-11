// sdk/ 是面板插件接口的副本，以前全靠人记得同步。有 .panel（面板源码，npm run panel 准备）时核对三件事：
// 1. sdk/host-modules.json 和面板 shared/plugins/host-modules.json 一样（构建脚本按它把 import 接到面板）；
// 2. 各插件清单的 api 不超过面板的 PLUGIN_API（超过的面板直接拒装）；
// 3. sdk/server.ts 的类型和面板 server/plugins/sdk.ts 严格一样（scripts/sdk-compat/server.ts，tsc 检查）。
// 没有 .panel 时跳过并说明：CI 每次都先 npm run panel，所以发版前一定会查。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PANEL = path.join(ROOT, '.panel')
if (!existsSync(path.join(PANEL, 'shared', 'plugins', 'host-modules.json'))) {
  console.log('没有 .panel，跳过 SDK 副本核对（npm run panel 准备后再查）')
  process.exit(0)
}
const errors = []
const read = (f) => readFileSync(f, 'utf8')

const mine = JSON.parse(read(path.join(ROOT, 'sdk', 'host-modules.json')))
const theirs = JSON.parse(read(path.join(PANEL, 'shared', 'plugins', 'host-modules.json')))
if (JSON.stringify(mine) !== JSON.stringify(theirs))
  errors.push('sdk/host-modules.json 和面板 shared/plugins/host-modules.json 不一样：把面板那份复制过来')

const api = Number(/export const PLUGIN_API = (\d+)/.exec(read(path.join(PANEL, 'shared', 'plugins', 'types.ts')))?.[1])
for (const d of readdirSync(ROOT, { withFileTypes: true })) {
  const f = path.join(ROOT, d.name, 'plugin.json')
  if (!d.isDirectory() || !existsSync(f)) continue
  const m = JSON.parse(read(f))
  if ((m.api ?? 1) > api) errors.push(`${m.id}：清单 api 是 ${m.api}，面板的 PLUGIN_API 只有 ${api}`)
}

try {
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'scripts/sdk-compat'],
    { cwd: ROOT, stdio: 'pipe' },
  )
} catch (e) {
  errors.push(
    `sdk/server.ts 和面板 server/plugins/sdk.ts 的类型不一样（下面报错的那一行就是要同步的类型）：\n${String(e.stdout)}`,
  )
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`SDK 副本和面板一致（插件接口 ${api}）`)
