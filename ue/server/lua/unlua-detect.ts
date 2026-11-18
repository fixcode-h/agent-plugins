import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../types.ts'

/**
 * 项目用没用 UnLua。不按固定的插件目录判断：用户的 UnLua 常是二次开发过的分支，可能放在 Plugins 的子目录里、
 * 装在引擎里，或者 .uplugin 改了名。认的依据按代价从低到高：
 *   1. .uproject 的 Plugins 里启用了名字带 UnLua 的插件（明确 Enabled:false 的当没有，和桥接的 Build.cs 一致）；
 *   2. 项目 Plugins/ 下任一层的插件：文件名是 UnLua.uplugin，或者插件里有 UnLua 模块（Source/UnLua/UnLua.Build.cs，改了名的插件也认）；
 *   3. 项目代码的 *.Build.cs 依赖了 UnLua 模块；
 *   4. 引擎 Engine/Plugins/ 下任一层的插件，认法同 2。
 * 运行中的进程报了 Lua 环境（/info 的 lua 字段）由调用方另外合进来（actions.ts projectState）。
 */
export interface UnLuaFound {
  found: boolean
  /** 认出来的依据：uproject / plugin / buildcs / engine；disabled 是 .uproject 里关掉了 */
  via?: 'uproject' | 'plugin' | 'buildcs' | 'engine' | 'disabled'
  /** 找到的文件（插件清单或 Build.cs），给提示和日志用 */
  where?: string
}

/** 插件目录里不会再有插件、又很大的子目录：不往里走，扫引擎时尤其要省 */
const SKIP = new Set(
  [
    'source',
    'content',
    'binaries',
    'intermediate',
    'resources',
    'shaders',
    'config',
    'saved',
    'extras',
    'thirdparty',
    'docs',
    'node_modules',
    '.git',
    '.svn',
  ].map((s) => s.toLowerCase()),
)

const exists = (f: string) =>
  stat(f).then(
    () => true,
    () => false,
  )

/** UnLua 模块的 Build.cs（桥接按模块名 UnLua 链接，插件本身改了名也一样） */
const hasUnLuaModule = (pluginDir: string) => exists(path.join(pluginDir, 'Source', 'UnLua', 'UnLua.Build.cs'))

/** 在一棵插件目录树里找 UnLua：任一层的 .uplugin，文件名是 UnLua 或目录里有 UnLua 模块 */
export async function findUnLuaPlugin(dir: string, maxDepth = 8): Promise<string | undefined> {
  const walk = async (d: string, depth: number): Promise<string | undefined> => {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    const plugin = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.uplugin'))
    if (plugin) {
      const f = path.join(d, plugin.name)
      if (plugin.name.toLowerCase() === 'unlua.uplugin' || (await hasUnLuaModule(d))) return f
    }
    if (depth >= maxDepth) return undefined
    // 插件里还可以套插件（UnLua 官方仓库就是 Plugins/UnLua/Plugins/UnLua），所以找到 .uplugin 也接着往下走，只跳过大目录
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name.toLowerCase())) continue
      const hit = await walk(path.join(d, e.name), depth + 1)
      if (hit) return hit
    }
    return undefined
  }
  return walk(dir, 0)
}

/** 项目代码（Source/ 下的 *.Build.cs）有没有依赖 UnLua 模块 */
async function buildCsUsesUnLua(root: string): Promise<string | undefined> {
  const walk = async (d: string, depth: number): Promise<string | undefined> => {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.Build.cs')) continue
      const f = path.join(d, e.name)
      const text = await readFile(f, 'utf8').catch(() => '')
      if (/"UnLua"/.test(text)) return f
    }
    if (depth >= 3) return undefined
    for (const e of entries) {
      if (!e.isDirectory() || ['private', 'public', 'classes'].includes(e.name.toLowerCase())) continue
      const hit = await walk(path.join(d, e.name), depth + 1)
      if (hit) return hit
    }
    return undefined
  }
  return walk(path.join(root, 'Source'), 0)
}

interface UProjectPlugin {
  Name?: string
  Enabled?: boolean
}

export async function detectUnLua(
  p: Pick<UeProject, 'root' | 'uproject' | 'engine' | 'engineDir'>,
): Promise<UnLuaFound> {
  const desc = await readFile(p.uproject || '', 'utf8')
    .then((s) => JSON.parse(s) as { Plugins?: UProjectPlugin[] })
    .catch(() => ({}) as { Plugins?: UProjectPlugin[] })
  const named = (desc.Plugins ?? []).filter((x) => /unlua/i.test(x?.Name ?? ''))
  if (named.some((x) => x.Enabled === false) && !named.some((x) => x.Enabled === true))
    return { found: false, via: 'disabled', where: p.uproject }
  if (named.some((x) => x.Enabled !== false)) return { found: true, via: 'uproject', where: p.uproject }

  const inProject = await findUnLuaPlugin(path.join(p.root, 'Plugins'))
  if (inProject) return { found: true, via: 'plugin', where: inProject }
  const buildCs = await buildCsUsesUnLua(p.root)
  if (buildCs) return { found: true, via: 'buildcs', where: buildCs }
  const engineDir = p.engine?.dir || p.engineDir
  if (engineDir) {
    // 引擎里的插件要项目启用了才算（.uproject 里写了它的名字，或清单里 EnabledByDefault），和桥接的 Build.cs 一致
    const inEngine = await findUnLuaPlugin(path.join(engineDir, 'Engine', 'Plugins'))
    if (inEngine) {
      const name = path.basename(inEngine, path.extname(inEngine))
      const entry = (desc.Plugins ?? []).find((x) => x?.Name?.toLowerCase() === name.toLowerCase())
      const byDefault = /"EnabledByDefault"\s*:\s*true/.test(await readFile(inEngine, 'utf8').catch(() => ''))
      if (entry ? entry.Enabled !== false : byDefault) return { found: true, via: 'engine', where: inEngine }
    }
  }
  return { found: false }
}

/**
 * 带缓存的版本：概况每次刷新都要问，扫引擎的插件树要几百次 stat。
 * 键里带 .uproject 和 Plugins/ 的修改时间：改了启用的插件、在 Plugins/ 下直接装或删插件马上重新认；
 * 装进更深的子目录、引擎里的变化一分钟内复用旧结果
 */
const cache = new Map<string, { at: number; value: Promise<UnLuaFound> }>()
const TTL = 60_000

export async function unluaOf(p: Pick<UeProject, 'root' | 'uproject' | 'engine' | 'engineDir'>): Promise<UnLuaFound> {
  const mtime = (f: string) =>
    stat(f).then(
      (s) => s.mtimeMs,
      () => 0,
    )
  const key = [
    p.root,
    p.uproject,
    p.engine?.dir || p.engineDir || '',
    await mtime(p.uproject || ''),
    await mtime(path.join(p.root, 'Plugins')),
  ].join('|')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const value = detectUnLua(p).catch(() => ({ found: false }) as UnLuaFound)
  for (const k of cache.keys()) if (k.startsWith(p.root + '|')) cache.delete(k)
  cache.set(key, { at: Date.now(), value })
  return value
}

export const hasUnLua = async (p: Pick<UeProject, 'root' | 'uproject' | 'engine' | 'engineDir'>) =>
  (await unluaOf(p)).found
