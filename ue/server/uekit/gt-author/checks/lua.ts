import { stat } from 'node:fs/promises'
import { parseLuaModule } from '../lua-parse.ts'
import { moduleFile, readLua } from '../lua-files.ts'
import { ownFields, strings } from '../walk.ts'
import { issue, type Check, type Issue } from './types.ts'

/**
 * `@luaMod.<require 路径>.<字段>`：模块文件在不在脚本根里、字段或函数在文件里认不认得出来。
 * 只给警告：字段可能是运行时才加的（游戏开着时 UE 的 gt.validate 按实例表查才准）
 */
const REF = /@luaMod\.([A-Za-z_][\w.]*)/g

export const lua: Check = {
  name: 'lua',
  summary: '@luaMod 引用的 Lua 模块文件和字段',
  async run(env) {
    const out: Issue[] = []
    const cache = new Map<string, Set<string> | null>()
    const names = async (mod: string) => {
      if (!cache.has(mod)) {
        let abs = ''
        try {
          abs = moduleFile(env.luaRoot, mod)
        } catch {
          cache.set(mod, null)
          return null
        }
        if (!(await stat(abs).catch(() => undefined))?.isFile()) cache.set(mod, null)
        else {
          const info = parseLuaModule(await readLua(abs))
          cache.set(mod, new Set([...info.fields.map((f) => f.name), ...info.functions.map((f) => f.name)]))
        }
      }
      return cache.get(mod)!
    }
    for (const s of env.steps) {
      const seen = new Set<string>()
      for (const text of strings(ownFields(s.step)))
        for (const m of text.matchAll(REF)) {
          if (seen.has(m[1])) continue
          seen.add(m[1])
          const parts = m[1].split('.')
          // 模块路径和字段都用点分隔：从长到短找第一个有文件的前缀
          let hit: { mod: string; field?: string; known: Set<string> } | undefined
          for (let n = parts.length; n >= 1 && !hit; n--) {
            const known = await names(parts.slice(0, n).join('.'))
            if (known) hit = { mod: parts.slice(0, n).join('.'), field: parts[n], known }
          }
          if (!hit)
            out.push(issue(s, 'path_missing', `找不到 Lua 模块文件：@luaMod.${m[1]}（按脚本根下的 require 路径找）`, 'warning'))
          else if (hit.field && !hit.known.has(hit.field))
            out.push(
              issue(s, 'path_missing', `${hit.mod} 里没认出 ${hit.field}（运行时才赋值的字段可以忽略这条）`, 'warning'),
            )
        }
    }
    return out
  },
}
