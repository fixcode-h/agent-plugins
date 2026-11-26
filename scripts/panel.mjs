// 准备仓库根的 .panel：面板源码的检出。照面板源码布局搬过来的插件（ui-design）类型检查、单测都要从这里取面板的模块和依赖。
// 本机：有 AGENT_PANEL_DIR、本仓库是面板的子仓库（挂在面板的 plugins/ 下，外层就是面板），或者旁边有 ../agent-panel，就建一个指向它的链接（用的是你本机面板的当前代码和 node_modules）；
// 都没有（CI）：浅克隆面板的 dev 分支再 npm ci。已经有 .panel 就不动。
import { execFileSync } from 'node:child_process'
import { existsSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(ROOT, '.panel')
const branch = process.env.AGENT_PANEL_BRANCH || 'dev'

if (existsSync(target)) {
  console.log('.panel 已经有了，不动它')
  process.exit(0)
}
const local = [process.env.AGENT_PANEL_DIR, path.join(ROOT, '..'), path.join(ROOT, '..', 'agent-panel')].find(
  (d) => d && existsSync(path.join(d, 'shared', 'plugins', 'host-modules.json')),
)
if (local) {
  // Windows 上目录链接用 junction，不需要管理员权限
  symlinkSync(path.resolve(local), target, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`.panel → ${local}`)
  if (!existsSync(path.join(local, 'node_modules'))) console.log('面板目录里还没装依赖，先在那边跑一次 npm install')
} else {
  const run = (cmd, args, cwd = ROOT) =>
    execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  // 面板仓库改成私有后（2026-11-26），CI 要带能读面板仓库的令牌（仓库机密 PANEL_TOKEN）才克隆得下来；
  // 令牌放进请求头而不是 URL，克隆失败时日志里也不会打出来
  const token = process.env.PANEL_TOKEN
  const auth = token
    ? ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]
    : []
  if (!token && process.env.CI)
    console.log('面板仓库是私有的：没设仓库机密 PANEL_TOKEN（能读 fixcode-h/agent-panel 的令牌）时克隆会失败')
  run('git', [...auth, 'clone', '--depth', '1', '--branch', branch, 'https://github.com/fixcode-h/agent-panel.git', target])
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], target)
}
