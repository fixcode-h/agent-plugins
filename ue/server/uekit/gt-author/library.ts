import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * ue_gametest look what=library：这个项目的公共库——场景根 common/ 下按功能分文件夹放的子脚本
 * （进地图等加载完、登录、走到 NPC 旁交互、关弹窗回主界面…）。公共库是每个项目自己的，跟着项目文档走，面板不内置。
 * Agent 写脚本前先查它，能用就 call；写出别的测试也会走的一段就提进来（技能 ue-gametest-authoring「公共库」一节）。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export const LIBRARY_DIR = 'common'

export interface LibraryItem {
  /** call 的 script 写这个（相对场景根，不带 .json） */
  script: string
  /** 功能文件夹（common/ 下第一层；直接放在 common/ 里的为空） */
  folder?: string
  name?: string
  title?: string
  note?: string
  params?: Record<string, { type?: string; default?: unknown; note?: string }>
  steps: number
  error?: string
}

async function walkJson(dir: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 6) return out
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) await walkJson(f, out, depth + 1)
    else if (/\.json$/i.test(e.name) && !e.name.startsWith('_')) out.push(f)
  }
  return out
}

function pickParams(v: unknown): LibraryItem['params'] {
  if (!isObj(v)) return undefined
  const out: NonNullable<LibraryItem['params']> = {}
  for (const [k, p] of Object.entries(v)) {
    if (!isObj(p)) continue
    out[k] = {
      ...(typeof p.type === 'string' ? { type: p.type } : {}),
      ...('default' in p ? { default: p.default } : {}),
      ...(typeof p.note === 'string' && p.note ? { note: p.note } : {}),
    }
  }
  return Object.keys(out).length ? out : undefined
}

export async function readLibrary(scenarioRoot: string): Promise<LibraryItem[]> {
  const base = path.join(scenarioRoot, LIBRARY_DIR)
  const items: LibraryItem[] = []
  for (const abs of (await walkJson(base)).sort()) {
    const script = path
      .relative(scenarioRoot, abs)
      .replace(/\\/g, '/')
      .replace(/\.json$/i, '')
    const parts = script.split('/')
    const folder = parts.length > 2 ? parts[1] : undefined
    try {
      const doc = JSON.parse((await readFile(abs, 'utf8')).replace(/^﻿/, '')) as unknown
      if (!isObj(doc)) throw new Error('不是 JSON 对象')
      items.push({
        script,
        ...(folder ? { folder } : {}),
        ...(typeof doc.name === 'string' && doc.name ? { name: doc.name } : {}),
        ...(typeof doc.title === 'string' && doc.title ? { title: doc.title } : {}),
        ...(typeof doc.note === 'string' && doc.note ? { note: doc.note } : {}),
        ...(pickParams(doc.params) ? { params: pickParams(doc.params) } : {}),
        steps: Array.isArray(doc.steps) ? doc.steps.length : 0,
      })
    } catch (e) {
      items.push({ script, ...(folder ? { folder } : {}), steps: 0, error: `读不了：${(e as Error).message}` })
    }
  }
  return items
}

/** look what=library 的返回：按 query 过滤、分页，带一句怎么用 */
export async function gtLibrary(scenarioRoot: string, a: Obj) {
  const all = await readLibrary(scenarioRoot)
  const q = typeof a.query === 'string' ? a.query.trim().toLowerCase() : ''
  const hit = q ? all.filter((x) => [x.script, x.name, x.title, x.note].some((s) => s?.toLowerCase().includes(q))) : all
  const offset = Math.max(0, Number(a.offset) || 0)
  const limit = Math.min(200, Math.max(1, Number(a.limit) || 50))
  const items = hit.slice(offset, offset + limit)
  const folders = [...new Set(all.map((x) => x.folder).filter(Boolean))]
  return {
    root: `${LIBRARY_DIR}/`,
    count: items.length,
    total: hit.length,
    ...(offset + limit < hit.length ? { hasMore: true, nextOffset: offset + limit } : {}),
    ...(folders.length ? { folders } : {}),
    items,
    note: all.length
      ? '用法：{"action": "call", "script": <script>, "with": {参数}}。新提的公共段放进 common/<功能>/，写 title、note 和 params'
      : '这个项目的公共库还是空的（场景根 common/）。写脚本时把和被测功能无关、别的测试也会走的一段（进地图等加载完、登录、走到 NPC 旁交互、关弹窗回主界面）提成 common/<功能>/<名字>.json，写 title、note 和 params，再 call 它',
  }
}

/** 公共库每份脚本的主流程（写法建议「和公共库一样的一段」用） */
export async function readLibrarySteps(scenarioRoot: string): Promise<{ script: string; steps: Obj[] }[]> {
  const out: { script: string; steps: Obj[] }[] = []
  for (const abs of await walkJson(path.join(scenarioRoot, LIBRARY_DIR))) {
    try {
      const doc = JSON.parse((await readFile(abs, 'utf8')).replace(/^﻿/, '')) as unknown
      if (!isObj(doc) || !Array.isArray(doc.steps)) continue
      const script = path
        .relative(scenarioRoot, abs)
        .replace(/\\/g, '/')
        .replace(/\.json$/i, '')
      out.push({ script, steps: doc.steps.filter(isObj) })
    } catch {
      // 读不了的跳过，look what=library 会标出来
    }
  }
  return out
}
