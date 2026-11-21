import path from 'node:path'
import { patchProject } from '../registry.ts'
import type { LuaBuildConfig, UeProject } from '../types.ts'
import { t } from '../util.ts'
import { DEFAULT_LUA_BUILD, saveSharedLuaBuild, SHARED_KEYS, sharedPart } from './store.ts'

/**
 * Lua 编译的设置（设计稿四.3）：团队共用的部分存项目文档根、个人习惯存本机项目登记，读项目时已合进 p.luaBuild（store.ts）。
 * 只有这里配好的两条指令能跑：网页按钮和 Agent 的 ue_lua action=compile 都不能自己传命令；
 * 从仓库拉来、本机没确认过的指令也不跑（store.ts 的 luaBuildApproved）。
 */
export { DEFAULT_LUA_BUILD }

export function luaBuildConfig(p: UeProject): LuaBuildConfig {
  return { ...DEFAULT_LUA_BUILD, ...(p.luaBuild ?? {}) }
}

const KEYS = Object.keys(DEFAULT_LUA_BUILD) as (keyof LuaBuildConfig)[]

export async function saveLuaBuildConfig(p: UeProject, patch: Record<string, unknown>) {
  const next: LuaBuildConfig = luaBuildConfig(p)
  for (const k of KEYS) {
    if (!(k in patch)) continue
    if (k === 'autoReload') next.autoReload = patch.autoReload === true
    else next[k] = String(patch[k] ?? '').trim()
  }
  if (!next.scriptDir) next.scriptDir = DEFAULT_LUA_BUILD.scriptDir
  if (!next.errorFormat) next.errorFormat = DEFAULT_LUA_BUILD.errorFormat
  // 报错格式写错了在保存时就说，别等编译完才发现一条错误都认不出来
  compileErrorPattern(next.errorFormat)
  const before = luaBuildConfig(p)
  const changed = SHARED_KEYS.some((k) => before[k] !== next[k])
  await saveSharedLuaBuild(p, sharedPart(next), changed)
  return (await patchProject(p.id, { luaBuild: next })).luaBuild ?? next
}

/** 设置里的相对目录都按项目根算；写了绝对路径就用它 */
export const inProject = (p: UeProject, dir: string) => (dir ? path.resolve(p.root, dir) : p.root)

/**
 * 报错格式 → 正则。两种写法：
 * - 模板：{file}、{line}、{col}、{message} 四个占位符，其余原样匹配，例如 `{file}:{line}: {message}`；不要求从行首开始
 *   （luac 会在前面加 `luac: `）。{file} 不含空格和冒号（Windows 盘符 C: 除外），路径带空格的项目改写正则。
 * - 正则：前后用 / 包起来，命名分组 file、line、col（可选）、message，例如 `/^(?<file>.+?)\((?<line>\d+)\): (?<message>.*)$/`
 */
export function compileErrorPattern(format: string): RegExp {
  const f = format.trim()
  if (f.length > 2 && f.startsWith('/') && f.lastIndexOf('/') > 0) {
    const end = f.lastIndexOf('/')
    let re: RegExp
    try {
      re = new RegExp(f.slice(1, end), f.slice(end + 1).replace(/[gy]/g, ''))
    } catch (e) {
      throw new Error(t('报错格式的正则写错了：{msg}', { msg: (e as Error).message }))
    }
    if (!/\(\?<file>/.test(re.source) || !/\(\?<line>/.test(re.source))
      throw new Error(t('报错格式的正则要有命名分组 file 和 line'))
    return re
  }
  if (!f.includes('{file}') || !f.includes('{line}')) throw new Error(t('报错格式里要有 {file} 和 {line}'))
  const parts = f.split(/(\{file\}|\{line\}|\{col\}|\{message\})/)
  const seen = new Set<string>()
  const src = parts
    .map((s) => {
      const name = s.match(/^\{(file|line|col|message)\}$/)?.[1]
      if (!name) return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*')
      // 同一个占位符写了两次时第二次只匹配不取值（命名分组不能重名）
      const g = seen.has(name) ? '' : `?<${name}>`
      seen.add(name)
      if (name === 'file') return `(${g}(?:[A-Za-z]:)?[^\\s:"'<>|]+)`
      if (name === 'message') return `(${g}.*)`
      return `(${g}\\d+)`
    })
    .join('')
  return new RegExp(src)
}
