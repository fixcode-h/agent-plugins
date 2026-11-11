// 单测：照面板源码布局放文件的插件（目录里的 tsconfig.json 引用了 ../.panel，目前是 ui-design）的 *.test.ts。
// 先 npm run panel 准备好 .panel；插件里没有的模块从 .panel 取（scripts/lib/panel-hooks.mjs）。
// 工作目录是插件目录，测试里按 'shared/…' 读文件的写法和在面板里一样。
// 用法：node scripts/test.mjs [插件 id] [测试文件（相对插件目录）…]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const panel = path.join(ROOT, '.panel')
if (!existsSync(path.join(panel, 'node_modules', 'tsx'))) {
  console.error('.panel 没准备好（要有面板源码和它的 node_modules）：先跑 npm run panel')
  process.exit(1)
}

function walk(dir, base, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, base, out)
    else if (/\.test\.tsx?$/.test(e.name)) out.push(path.relative(base, f))
  }
  return out
}

const [only, ...picked] = process.argv.slice(2)
const plugins = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && (!only || e.name === only))
  .map((e) => e.name)
  .filter((id) => {
    const ts = path.join(ROOT, id, 'tsconfig.json')
    return (
      existsSync(path.join(ROOT, id, 'plugin.json')) && existsSync(ts) && readFileSync(ts, 'utf8').includes('../.panel')
    )
  })

let failed = 0
for (const id of plugins) {
  const dir = path.join(ROOT, id)
  const files = picked.length
    ? picked
    : ['server', 'web', 'shared']
        .filter((d) => existsSync(path.join(dir, d)))
        .flatMap((d) => walk(path.join(dir, d), dir))
  console.log(`${id}：${files.length} 个测试文件`)
  const r = spawnSync(
    process.execPath,
    [
      '--import',
      path.join(ROOT, 'scripts/lib/panel-register.mjs'),
      '--test',
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      ...files,
    ],
    { cwd: dir, stdio: 'inherit', env: { ...process.env, AGENT_PLUGIN_PANEL: panel, AGENT_PLUGIN_DIR: dir } },
  )
  if (r.status !== 0) failed++
}
process.exit(failed ? 1 : 0)
