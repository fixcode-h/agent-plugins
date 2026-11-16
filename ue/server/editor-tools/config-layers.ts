import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'

/**
 * 项目配置的分层（设计稿「UE 插件优化与扩展」二 P2）：排查「这个值从哪来」时，看每一层 ini（Base、Default、平台、Saved）
 * 各写了什么、最后是哪一层定的。直接读磁盘上的文件，UE 没开也能看；进程里合并后的最终值（含插件和命令行改的）
 * 由 UELink 的 config.get 给，config.ts 把两边放在一起。
 */

/** 一行配置：op 是 UE ini 的前缀（''=设值、+ 不重复追加、. 追加、- 删一个值、! 清空） */
export interface IniEntry {
  op: '' | '+' | '.' | '-' | '!'
  key: string
  value: string
  line: number
}
export type IniFile = Map<string, IniEntry[]>

export interface Layer {
  /** 显示名：引擎 Base、项目 Default、Saved（编辑器）… */
  label: string
  file: string
}

/** UE 在这台机器上用的平台目录名 */
export const platformName = () =>
  process.platform === 'darwin' ? 'Mac' : process.platform === 'linux' ? 'Linux' : 'Windows'

/** 按 UE 的规则解析一份 ini：section 名区分大小写（和 UE 一致），键名照原样 */
export function parseIni(text: string): IniFile {
  const out: IniFile = new Map()
  let cur: IniEntry[] | undefined
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw || raw.startsWith(';') || raw.startsWith('#')) continue
    const sec = /^\[(.+)\]$/.exec(raw)
    if (sec) {
      cur = out.get(sec[1]) ?? []
      out.set(sec[1], cur)
      continue
    }
    if (!cur) continue
    const eq = raw.indexOf('=')
    const left = (eq < 0 ? raw : raw.slice(0, eq)).trim()
    let value = eq < 0 ? '' : raw.slice(eq + 1).trim()
    // 整段带引号的值去掉外层引号（UE 读的时候也会去掉）
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    const op = (['+', '.', '-', '!'] as const).find((p) => left.startsWith(p)) ?? ''
    const key = op ? left.slice(1).trim() : left
    if (!key) continue
    cur.push({ op, key, value, line: i + 1 })
  }
  return out
}

/** 把一层的改动叠到已有的值上（UE 合并 ini 的规则） */
export function applyEntry(values: string[], e: IniEntry): string[] {
  switch (e.op) {
    case '':
      return [e.value]
    case '+':
      return values.includes(e.value) ? values : [...values, e.value]
    case '.':
      return [...values, e.value]
    case '-':
      return values.filter((v) => v !== e.value)
    case '!':
      return []
  }
}

/**
 * 一种配置（Engine、Game、Input…）从低到高的各层文件，只列 UE 5 实际会读的位置。
 * 插件自己的 Config/ 和命令行覆盖不在这里（进程里的最终值会体现出来）
 */
export function layersOf(p: UeProject, type: string, plat = platformName()): Layer[] {
  const eng = p.engine.dir ? path.join(p.engine.dir, 'Engine', 'Config') : ''
  const proj = path.join(p.root, 'Config')
  const saved = path.join(p.root, 'Saved', 'Config')
  const list: (Layer | false)[] = [
    !!eng && { label: t('引擎 {name}', { name: 'Base' }), file: path.join(eng, 'Base.ini') },
    !!eng && { label: t('引擎 {name}', { name: `Base${type}` }), file: path.join(eng, `Base${type}.ini`) },
    !!eng && { label: t('引擎 {name}', { name: `${plat} Base` }), file: path.join(eng, plat, `Base${plat}${type}.ini`) },
    { label: t('项目 {name}', { name: `Default${type}` }), file: path.join(proj, `Default${type}.ini`) },
    !!eng && { label: t('引擎 {name}', { name: plat }), file: path.join(eng, plat, `${plat}${type}.ini`) },
    { label: t('项目 {name}', { name: plat }), file: path.join(proj, plat, `${plat}${type}.ini`) },
    { label: t('项目 {name}', { name: `Platforms/${plat}` }), file: path.join(p.root, 'Platforms', plat, 'Config', `${plat}${type}.ini`) },
    { label: t('Saved（编辑器）'), file: path.join(saved, `${plat}Editor`, `${type}.ini`) },
    { label: t('Saved（游戏）'), file: path.join(saved, plat, `${type}.ini`) },
  ]
  return list.filter((x): x is Layer => !!x)
}

/** 解析过的文件按修改时间缓存：引擎的 BaseEngine.ini 上百 KB，翻 section 时不用每次重读 */
const cache = new Map<string, { mtime: number; ini: IniFile }>()
export async function readIni(file: string): Promise<IniFile | undefined> {
  const s = await stat(file).catch(() => undefined)
  if (!s?.isFile()) return undefined
  const hit = cache.get(file)
  if (hit && hit.mtime === s.mtimeMs) return hit.ini
  const ini = parseIni(await readFile(file, 'utf8').catch(() => ''))
  cache.set(file, { mtime: s.mtimeMs, ini })
  return ini
}

/** 有哪些配置：项目 Config/Default*.ini 和引擎 Config/Base*.ini 的名字合起来，常用的排前面 */
export async function configTypes(p: UeProject): Promise<string[]> {
  const names = new Set<string>()
  const scan = async (dir: string, prefix: string) => {
    for (const n of await readdir(dir).catch(() => [] as string[])) {
      const m = new RegExp(`^${prefix}(\\w+)\\.ini$`, 'i').exec(n)
      if (m) names.add(m[1])
    }
  }
  await scan(path.join(p.root, 'Config'), 'Default')
  if (p.engine.dir) await scan(path.join(p.engine.dir, 'Engine', 'Config'), 'Base')
  const first = ['Engine', 'Game', 'Input', 'Editor', 'GameplayTags', 'Scalability', 'DeviceProfiles']
  return [...names].sort((a, b) => {
    const ia = first.indexOf(a)
    const ib = first.indexOf(b)
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    return a.localeCompare(b)
  })
}

export interface LoadedLayer extends Layer {
  ini: IniFile
}

export async function loadLayers(p: UeProject, type: string): Promise<LoadedLayer[]> {
  const out: LoadedLayer[] = []
  for (const l of layersOf(p, type)) {
    const ini = await readIni(l.file)
    if (ini) out.push({ ...l, ini })
  }
  return out
}

/** 一种配置里的 section：各层合起来，每个 section 记下哪几层写了它 */
export function sectionsOf(layers: LoadedLayer[], filter = '') {
  const f = filter.toLowerCase()
  const map = new Map<string, string[]>()
  for (const l of layers)
    for (const s of l.ini.keys()) {
      if (f && !s.toLowerCase().includes(f)) continue
      const list = map.get(s) ?? []
      list.push(l.label)
      map.set(s, list)
    }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, layers]) => ({ name, layers }))
}

export interface KeyRow {
  key: string
  /** 按各层叠出来的值（多个值是数组项） */
  values: string[]
  /** 最后改它的那一层：这一层定了最终值 */
  last: string
  /** 每层对这个键写了什么 */
  layers: { label: string; file: string; entries: IniEntry[] }[]
}

/** 一个 section 里每个键在各层的写法和叠出来的值。键名比较不分大小写（UE 的 FName 不分） */
export function sectionRows(layers: LoadedLayer[], section: string, key = ''): KeyRow[] {
  const rows = new Map<string, KeyRow>()
  for (const l of layers) {
    const entries = l.ini.get(section)
    if (!entries) continue
    for (const e of entries) {
      if (key && e.key.toLowerCase() !== key.toLowerCase()) continue
      const id = e.key.toLowerCase()
      const row = rows.get(id) ?? { key: e.key, values: [], last: '', layers: [] }
      row.values = applyEntry(row.values, e)
      row.last = l.label
      const mine = row.layers.at(-1)?.label === l.label ? row.layers.at(-1)! : undefined
      if (mine) mine.entries.push(e)
      else row.layers.push({ label: l.label, file: l.file, entries: [e] })
      rows.set(id, row)
    }
  }
  return [...rows.values()]
}

/** 全部配置里按键名、值、section 名搜（「这个值在哪设的」），最多 limit 条 */
export async function searchConfig(p: UeProject, query: string, limit = 100) {
  const q = query.trim().toLowerCase()
  const hits: { type: string; section: string; key: string; value: string; layer: string; file: string; line: number }[] =
    []
  if (!q) return { hits, more: false }
  for (const type of await configTypes(p)) {
    for (const l of await loadLayers(p, type)) {
      for (const [section, entries] of l.ini) {
        const secHit = section.toLowerCase().includes(q)
        for (const e of entries) {
          if (!secHit && !e.key.toLowerCase().includes(q) && !e.value.toLowerCase().includes(q)) continue
          if (hits.length >= limit) return { hits, more: true }
          hits.push({ type, section, key: e.key, value: e.value, layer: l.label, file: l.file, line: e.line })
        }
      }
    }
  }
  return { hits, more: false }
}
