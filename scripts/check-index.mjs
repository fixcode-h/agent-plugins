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
// wraps：市场里列出的官方包装配方（面板读成「包装」条目，安装走包装弹窗）：要有 wraps/ 里的配方，id、名字和配方一致
const wraps = JSON.parse(readFileSync(path.join(ROOT, 'plugins.json'), 'utf8')).wraps ?? []
for (const w of wraps) {
  const file = path.join(ROOT, 'wraps', `${String(w.repo).replace('/', '__')}.json`)
  if (!existsSync(file)) {
    errors.push(`plugins.json 的 wraps 里 ${w.repo} 在 wraps/ 下没有配方`)
    continue
  }
  const r = JSON.parse(readFileSync(file, 'utf8'))
  if (r.id !== w.id) errors.push(`wraps 里 ${w.repo} 的 id 是 ${w.id}，配方写的是 ${r.id}`)
  if (r.name !== w.name) errors.push(`wraps 里 ${w.repo} 的名字和配方不一致`)
  if (index.some((e) => e.id === w.id)) errors.push(`wraps 里的 ${w.id} 和插件同名`)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`plugins.json 和 ${dirs.length} 个插件、${wraps.length} 个包装配方对得上`)
