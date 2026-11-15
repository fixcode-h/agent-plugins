/**
 * 核对 wraps/ 里的包装配方（面板 ADR 0068）：文件名和 repo 对得上、必填字段在、路径不越界、
 * 环境变量不是凭据或面板自己的变量、安装动作在白名单里。完整的格式由面板安装时按 WrapRecipe（zod）再查一遍，
 * 这里只拦最常见的写错，免得合进市场后用户一包装就报错。只用 Node 自带模块。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.join(import.meta.dirname, '..', 'wraps')
const ACTIONS = new Set(['npm-ci', 'npm-package', 'uv-tool', 'release-asset', 'npm-run'])
const RESERVED = [/^AGENT_PANEL_/, /^ANTHROPIC_/, /^OPENAI_/, /^CLAUDECODE$/, /^HOME$/, /^USERPROFILE$/, /^GIT_/, /^PATH$/]
const CREDENTIAL = /(^|_)(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD)$|^GITHUB_TOKEN$|^GH_TOKEN$/
const badPath = (p) => typeof p !== 'string' || !p || /^[\\/]|^[a-zA-Z]:/.test(p) || p.split(/[\\/]/).includes('..')

const errors = []
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
for (const f of files) {
  const err = (m) => errors.push(`wraps/${f}：${m}`)
  let r
  try {
    r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
  } catch (e) {
    err(`JSON 格式不对：${e.message}`)
    continue
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(r.repo ?? '')) err('repo 要写成 owner/repo')
  else if (`${r.repo.replace('/', '__')}.json` !== f) err(`文件名应该是 ${r.repo.replace('/', '__')}.json`)
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(r.id ?? '')) err('id 只能用小写字母开头的字母、数字和连字符')
  if (!r.name) err('缺 name')
  if (r.track && !['release', 'tag', 'branch'].includes(r.track)) err(`track 不认识：${r.track}`)
  if (r.activation && !['global', 'project'].includes(r.activation)) err(`activation 不认识：${r.activation}`)
  for (const s of r.skills ?? []) if (s.from !== '.' && badPath(s.from)) err(`技能的 from 不对：${s.from}`)
  for (const p of [...(r.copy ?? []), ...(r.path ?? [])]) if (p !== '.' && badPath(p)) err(`路径不对：${p}`)
  for (const a of r.install ?? []) if (!ACTIONS.has(a.kind)) err(`安装动作不在白名单里：${a.kind}`)
  for (const k of Object.keys(r.env ?? {})) {
    const up = k.toUpperCase()
    if (RESERVED.some((x) => x.test(up))) err(`环境变量 ${k} 是面板或 CLI 自己的，插件不能写（PATH 写在 path 字段里）`)
    else if (CREDENTIAL.test(up)) err(`环境变量 ${k} 是凭据，改成插件参数让用户填`)
  }
  const keys = new Set((r.settings ?? []).map((s) => s.key))
  for (const [k, v] of Object.entries(r.env ?? {}))
    for (const m of String(v).matchAll(/\{config\.([\w-]+)\}/g))
      if (!keys.has(m[1])) err(`环境变量 ${k} 引用的插件参数 ${m[1]} 没在 settings 里声明`)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`包装配方 ${files.length} 个，格式没问题`)
