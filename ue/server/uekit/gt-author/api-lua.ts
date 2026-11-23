import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseLuaModule, type LuaFunction } from './lua-parse.ts'
import { indexedDirs } from '../../file-index.ts'
import { listLua, moduleName, readLua, relToRoot } from './lua-files.ts'

/**
 * 项目 Lua 接口（GameTest 脚本协议 8.2）：_settings.json 的 api.lua 列的文件夹（相对 Lua 脚本根，默认 GameTestApi）下的模块，
 * 模块表上的函数就是接口。面板扫，写进场景根 _api.json 的 lua 段（C++ 那段由编辑器里的 GameTestEditor 写，互不碰）。
 *
 * 接口名 `项目.<相对文件夹的模块路径>.<函数名>`（GameTestApi/QuestApi.lua 的 Finish → 项目.QuestApi.Finish）。
 * 认不了的进 rejected 并写原因：方法（: 定义的要 self）、名字以 _ 开头（约定私有）、参数是函数 / userdata（脚本里构造不出来）。
 */
export const DEFAULT_LUA_API = ['GameTestApi']

export interface LuaApiItem {
  name: string
  module: string
  function: string
  category: string
  note?: string
  readOnly: boolean
  file: string
  line: number
  args: { name: string; type: string; note?: string }[]
  returns: string
}

export interface LuaApiRejected {
  module: string
  function: string
  file: string
  line: number
  why: string
}

export interface LuaApiSection {
  folders: string[]
  items: LuaApiItem[]
  rejected: LuaApiRejected[]
  /** 配了但不存在的文件夹：设置页标出来，免得以为扫过了却一个都没有 */
  missing?: string[]
  /** 每个文件夹认出了几个接口（设置页显示） */
  perFolder: Record<string, number>
}

const BAD_TYPE = /^(fun\b|function\b|userdata\b|thread\b|lightuserdata\b)/

/** 参数类型写成 EmmyLua 的样子，转成协议的类型名（_api.json 和 gt.api 用同一套） */
export function protocolType(t: string) {
  const base = t.replace(/\?$/, '')
  const map: Record<string, string> = {
    integer: 'int',
    int: 'int',
    number: 'float',
    float: 'float',
    string: 'string',
    boolean: 'bool',
    bool: 'bool',
  }
  return (map[base] ?? (base === 'any' ? 'any' : base)) + (t.endsWith('?') ? '?' : '')
}

function reject(fn: LuaFunction): string | undefined {
  if (fn.method) return '是方法（function M:Fn），接口要写成模块函数 function M.Fn，不需要 self'
  if (fn.name.startsWith('_')) return '名字以 _ 开头，按约定是私有函数'
  const bad = fn.args.find((a) => BAD_TYPE.test(a.type))
  if (bad) return `参数 ${bad.name} 是 ${bad.type}，脚本里构造不出来`
  return undefined
}

/**
 * 文件夹写法：相对脚本根的目录；带 `**` 的（`**\/GameTestApi`、`Game/**\/GameTestApi`）找它前面那段目录下任意一层同名的目录。
 * 返回实际目录（绝对路径）
 */
export async function resolveFolders(root: string, folder: string): Promise<string[]> {
  const f = folder.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!f) return []
  const star = f.indexOf('**')
  if (star < 0) return [path.resolve(root, f)]
  const base = path.resolve(root, f.slice(0, star))
  const name = f.slice(star + 2).replace(/^\/+/, '')
  if (!name || name.includes('/')) return [] // 只支持 **/名字 这一种，复杂的通配写具体目录
  const out: string[] = []
  // 面板有项目文件索引时直接从目录清单里挑同名的
  const listed = await indexedDirs(base)
  if (listed)
    return listed
      // 和下面走目录一样：找到同名的就不再往它里面找
      .filter((d) => {
        const segs = d.toLowerCase().split('/')
        return segs.length <= 13 && segs.indexOf(name.toLowerCase()) === segs.length - 1
      })
      .slice(0, 51)
      .map((d) => path.join(base, ...d.split('/')))
  const walk = async (d: string, depth: number) => {
    if (depth > 12 || out.length > 50) return
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue
      const sub = path.join(d, e.name)
      if (e.name.toLowerCase() === name.toLowerCase()) out.push(sub)
      else await walk(sub, depth + 1)
    }
  }
  await walk(base, 0)
  return out
}

export async function scanLuaApi(root: string, folders: string[]): Promise<LuaApiSection> {
  const items: LuaApiItem[] = []
  const rejected: LuaApiRejected[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  const perFolder: Record<string, number> = {}
  for (const folder of folders) {
    perFolder[folder] = 0
    const dirs = await resolveFolders(root, folder)
    let found = 0
    for (const dir of dirs) {
      const files = await listLua(dir)
      if (files.length || (await stat(dir).catch(() => undefined))?.isDirectory()) found++
      for (const abs of files) {
        const info = parseLuaModule(await readLua(abs).catch(() => ''))
        const file = relToRoot(root, abs)
        const mod = moduleName(root, abs)
        const short = path.relative(dir, abs).replace(/\\/g, '/').replace(/\.lua$/i, '').replace(/\//g, '.')
        for (const fn of info.functions) {
          const why = reject(fn)
          if (why) {
            rejected.push({ module: mod, function: fn.name, file, line: fn.line, why })
            continue
          }
          const name = `项目.${short}.${fn.name}`
          if (seen.has(name)) continue
          seen.add(name)
          perFolder[folder]++
          items.push({
            name,
            module: mod,
            function: fn.name,
            category: short.split('.').at(-1) ?? short,
            ...(fn.note ? { note: fn.note } : {}),
            readOnly: fn.readOnly,
            file,
            line: fn.line,
            args: fn.args.map((a) => ({ name: a.name, type: protocolType(a.type), ...(a.note ? { note: a.note } : {}) })),
            returns: fn.returns ? protocolType(fn.returns) : '',
          })
        }
      }
    }
    if (!dirs.length || !found) missing.push(folder)
  }
  return { folders, items, rejected, perFolder, ...(missing.length ? { missing } : {}) }
}
