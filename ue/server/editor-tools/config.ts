import type { OpCtx } from '../ops.ts'
import { configTypes, loadLayers, searchConfig, sectionRows, sectionsOf } from './config-layers.ts'
import { tryOp } from './live.ts'

/**
 * 配置浏览（网页配置页和 ue_console action=config 共用）：磁盘上各层 ini 写了什么 + 进程里合并后的最终值。
 * 进程的值和按各层叠出来的不一样时标出来：多半是插件的 Config、命令行或运行中改过（这正是排查要找的）。
 */
export interface ConfigArgs {
  /** 配置名：Engine、Game、Input…；不给时只列有哪些 */
  file?: string
  section?: string
  key?: string
  /** section 名筛选 */
  filter?: string
  /** 全部配置里按键名、值、section 搜 */
  query?: string
}

export async function configView(ctx: OpCtx, a: ConfigArgs) {
  const p = ctx.project
  if (a.query) return { query: a.query, ...(await searchConfig(p, a.query)) }
  const types = await configTypes(p)
  if (!a.file) return { types }
  const layers = await loadLayers(p, a.file)
  const base = { file: a.file, layers: layers.map((l) => ({ label: l.label, file: l.file })) }
  if (!a.section) {
    const sections = sectionsOf(layers, a.filter)
    const live = await tryOp<{ sections: string[] }>(ctx, 'config.get', { file: a.file, filter: a.filter ?? '', limit: 5000 })
    // 只在进程里有的 section（插件的 Config、运行中加的）也列出来，标 liveOnly
    const known = new Set(sections.map((s) => s.name))
    const extra = (live.data?.sections ?? []).filter((s) => !known.has(s)).map((name) => ({ name, layers: [], liveOnly: true }))
    return { ...base, sections: [...sections, ...extra].sort((x, y) => x.name.localeCompare(y.name)), live: liveInfo(live) }
  }
  const rows = sectionRows(layers, a.section, a.key)
  const live = await tryOp<{ values: { key: string; value: string }[]; missing?: boolean }>(ctx, 'config.get', {
    file: a.file,
    section: a.section,
    key: a.key ?? '',
    limit: 5000,
  })
  const liveMap = new Map<string, string[]>()
  for (const v of live.data?.values ?? []) {
    const id = v.key.toLowerCase()
    liveMap.set(id, [...(liveMap.get(id) ?? []), v.value])
  }
  const keys = rows.map((r) => {
    const lv = liveMap.get(r.key.toLowerCase())
    liveMap.delete(r.key.toLowerCase())
    return {
      ...r,
      ...(lv && { live: lv }),
      ...(live.data && !sameList(lv ?? [], r.values) && { differs: true }),
    }
  })
  // 各层都没写、只在进程里有的键（插件 Config、命令行 -ini: 覆盖）
  for (const [, values] of liveMap) {
    const key = live.data!.values.find((v) => liveMap.get(v.key.toLowerCase()) === values)?.key ?? ''
    keys.push({ key, values: [], last: '', layers: [], live: values, differs: true })
  }
  return { ...base, section: a.section, keys, live: liveInfo(live) }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

function liveInfo(r: { data?: { instance?: { pid: number; kind: string } }; error?: string }) {
  return r.data ? { pid: r.data.instance?.pid, kind: r.data.instance?.kind } : { error: r.error }
}
