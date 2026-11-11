// 漏翻检查：每个插件的界面文案（代码里 t('…')、ctx.t('…')，清单里的名字、简介、参数说明、工具显示名）
// 都要在 locales/en.json 里有英文；en.json 里多出来的（代码里已经不用的）也报出来。
// 发给 Agent 的提示词（角色设定、工作流说明、技能触发说明）不翻译，不在检查范围。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (/\.tsx?$/.test(e.name)) out.push(f)
  }
  return out
}

function codeStrings(dir) {
  const out = new Set()
  // shared/：照面板源码布局搬过来的插件（插件接口 4）前后端共用的代码也有界面文案
  for (const f of ['server', 'web', 'shared'].flatMap((s) => walk(path.join(dir, s)))) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g))
      out.add(m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n'))
  }
  return out
}

function manifestStrings(m) {
  const out = new Set([m.description])
  for (const s of m.settings ?? []) {
    for (const k of ['label', 'desc', 'group', 'placeholder', 'unit']) if (s[k]) out.add(s[k])
    for (const o of s.options ?? []) out.add(o.label)
  }
  for (const v of Object.values(m.toolNames ?? {})) out.add(v)
  return out
}

let bad = 0
for (const e of readdirSync(ROOT, { withFileTypes: true })) {
  const dir = path.join(ROOT, e.name)
  if (!e.isDirectory() || !existsSync(path.join(dir, 'plugin.json'))) continue
  const m = JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
  const enFile = path.join(dir, 'locales', 'en.json')
  const en = existsSync(enFile) ? JSON.parse(readFileSync(enFile, 'utf8')) : {}
  const used = new Set([...codeStrings(dir), ...manifestStrings(m)])
  // 纯英文、数字的（Blender、Gateway）不用翻
  const need = [...used].filter((s) => /[一-鿿]/.test(s))
  const missing = need.filter((s) => !(s in en))
  const extra = Object.keys(en).filter((k) => !used.has(k))
  if (missing.length)
    console.log(`${m.id}：漏翻 ${missing.length} 条\n${missing.map((s) => `  ${JSON.stringify(s)}`).join('\n')}`)
  if (extra.length)
    console.log(`${m.id}：en.json 里多出 ${extra.length} 条\n${extra.map((s) => `  ${JSON.stringify(s)}`).join('\n')}`)
  bad += missing.length + extra.length
  if (!missing.length && !extra.length) console.log(`${m.id}：文案 ${need.length} 条，英文齐全`)
}
process.exit(bad ? 1 : 0)
