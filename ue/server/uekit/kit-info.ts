import { readFile } from 'node:fs/promises'
import { hasUnLua } from '../lua/unlua-detect.ts'
import type { UeProject } from '../types.ts'
import { findPluginDirs } from '../uelink.ts'

/**
 * UE 插件页卡片上的「兼容性和依赖」：从插件目录的清单里取实测引擎、依赖、可选插件、带给 Agent 的工具，
 * 可选插件再看这个项目开没开（设计稿 designs/UE插件管理页重设计-设计稿.md）。
 * 只读磁盘上的 .uproject 和 Plugins/，不连 UE、不上网。
 */
export interface KitInfo {
  engineMin?: string
  /** 实测过的引擎版本（前两段），清单里没写为空 */
  engineTested: string[]
  /** 依赖的本库插件和版本范围，如 { UELink: '>=2.3.0' } */
  requires: Record<string, string>
  /** 可选的引擎或项目插件：on = 项目里能用（.uproject 里开了，或者 Plugins/ 下有） */
  optional: { name: string; on: boolean }[]
  /** 装了才挂的 Agent 工具 */
  tools: string[]
}

/** 清单里的 kit.json 字段（catalog.mjs 原样带过来），engineTested 早期是字符串 */
export interface KitFields {
  engineMin?: string
  engineTested?: string | string[]
  requires?: Record<string, string>
  optionalPlugins?: string[]
  panelTools?: string[]
}

/** .uproject 里 Enabled 的插件名 */
async function enabledInUproject(p: UeProject) {
  const doc = await readFile(p.uproject, 'utf8')
    .then((s) => JSON.parse(s) as { Plugins?: { Name?: string; Enabled?: boolean }[] })
    .catch(() => undefined)
  return new Set((doc?.Plugins ?? []).filter((x) => x.Enabled !== false && x.Name).map((x) => x.Name!))
}

export async function kitInfo(p: UeProject, m: KitFields | null | undefined): Promise<KitInfo | undefined> {
  if (!m) return undefined
  const tested = Array.isArray(m.engineTested) ? m.engineTested : m.engineTested ? [m.engineTested] : []
  const names = m.optionalPlugins ?? []
  const enabled = names.length ? await enabledInUproject(p) : new Set<string>()
  const optional = await Promise.all(
    names.map(async (name) => ({
      name,
      // UnLua 常是改过的分支、放得很偏，按 lua/unlua-detect.ts 的统一认法（不只看 Plugins/ 下有没有同名目录）
      on: name === 'UnLua' ? await hasUnLua(p) : enabled.has(name) || (await findPluginDirs(p.root, name)).length > 0,
    })),
  )
  return {
    engineMin: m.engineMin,
    engineTested: tested.map((v) => v.split('.').slice(0, 2).join('.')),
    requires: m.requires ?? {},
    optional,
    tools: m.panelTools ?? [],
  }
}
