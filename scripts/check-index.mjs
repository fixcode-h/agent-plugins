// plugins.json（面板读的插件目录）要和各插件的 plugin.json 对得上：id、名字、版本一致，
// Release 的标签和附件名按约定写（<id>-v<版本>、<id>-<版本>.zip），Release 工作流照这个发
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'plugins.json'), 'utf8')).plugins
const errors = []
const dirs = readdirSync(ROOT, { withFileTypes: true }).filter(
  (e) => e.isDirectory() && existsSync(path.join(ROOT, e.name, 'plugin.json')),
)
for (const d of dirs) {
  const m = JSON.parse(readFileSync(path.join(ROOT, d.name, 'plugin.json'), 'utf8'))
  if (m.id !== d.name) errors.push(`${d.name}/plugin.json 的 id 是 ${m.id}，要和目录名一致`)
  const e = index.find((x) => x.id === m.id)
  if (!e) {
    errors.push(`plugins.json 里没有 ${m.id}`)
    continue
  }
  if (e.version !== m.version) errors.push(`${m.id}：plugins.json 写的版本 ${e.version}，plugin.json 是 ${m.version}`)
  if (e.name !== m.name) errors.push(`${m.id}：名字和 plugin.json 不一致`)
  if (e.tag !== `${m.id}-v${m.version}`) errors.push(`${m.id}：tag 要写 ${m.id}-v${m.version}`)
  if (e.asset !== `${m.id}-${m.version}.zip`) errors.push(`${m.id}：asset 要写 ${m.id}-${m.version}.zip`)
}
for (const e of index) if (!dirs.some((d) => d.name === e.id)) errors.push(`plugins.json 里的 ${e.id} 没有对应的目录`)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`plugins.json 和 ${dirs.length} 个插件对得上`)
