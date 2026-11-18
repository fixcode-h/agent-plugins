import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { UeProject } from '../types.ts'
import type { IndexAsset, IndexLua, Mounts } from './types.ts'
import { toObjectPath } from './mounts.ts'
import { nativeWidgetClasses } from './native-widgets.ts'

/**
 * 读 UEToVS（用户本地的 VS 插件）已经建好的索引，不自己再扫一遍（用户 2026-11-16 要的「先解析 UEToVS 的 Index」）：
 * - 资源：<解决方案目录>/.vs/UEToVS/Blueprints/blueprints.jsonl.gz（UEToVS 的 BlueprintIndex，format 1）。
 *   gzip 的 JSON 行，第一行 {"format":1}，之后每行一个资源：p 文件路径、o 对象路径、pc 父类、npc 原生父类、gc 生成类、
 *   n 名字表。项目和项目插件里的 .uasset / .umap 都在（不是蓝图的也记着，只是没有 pc / n），名字表这里用不上。
 * - Lua：<解决方案目录>/.vs/UEToVS/Lua/lua-index.json（format 见 UEToVS LuaModel.cs）：files[].path / module。
 * 解决方案（.sln）可能在项目目录、外层目录，源码版引擎还可能在引擎根目录，挨个找，取最新的那份。
 * 格式对不上（UEToVS 升级换了格式）就当没有，退回面板自己扫，不报错
 */

export const UETOVS_ASSETS = path.join('.vs', 'UEToVS', 'Blueprints', 'blueprints.jsonl.gz')
export const UETOVS_LUA = path.join('.vs', 'UEToVS', 'Lua', 'lua-index.json')
const ASSET_FORMAT = 1

/** 可能放 .sln 的目录：项目目录、往外两层、引擎根目录 */
export function solutionDirs(p: Pick<UeProject, 'root' | 'engineDir'> & { engine?: { dir?: string } }) {
  const root = path.resolve(p.root)
  const dirs = [root, path.dirname(root), path.dirname(path.dirname(root)), p.engineDir, p.engine?.dir]
  return [...new Set(dirs.filter((d): d is string => !!d).map((d) => path.resolve(d)))]
}

export interface Found {
  file: string
  mtimeMs: number
  size: number
  /** 不在项目目录里的（外层、引擎根）：要按项目根筛掉别的项目的资源 */
  shared: boolean
}

/** 几个候选目录里最新的那份索引文件；都没有返回空 */
export async function findIndexFile(dirs: string[], rel: string, root: string): Promise<Found | undefined> {
  let best: Found | undefined
  for (const d of dirs) {
    const file = path.join(d, rel)
    const st = await stat(file).catch(() => undefined)
    if (!st?.isFile()) continue
    if (!best || st.mtimeMs > best.mtimeMs)
      best = { file, mtimeMs: st.mtimeMs, size: st.size, shared: path.resolve(d) !== path.resolve(root) }
  }
  return best
}

const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()

/** "/Script/UMG.UserWidget"、"/Game/A/BP_Base.BP_Base_C" → "UserWidget"、"BP_Base" */
export function shortClass(s: string | undefined) {
  if (!s) return ''
  const name = s.slice(s.lastIndexOf('.') + 1)
  return name.endsWith('_C') ? name.slice(0, -2) : name
}

/**
 * 蓝图的资源类型：UEToVS 只记父类不记资源类。控件蓝图按**继承**认（用户 2026-11-18：所有 UMG 都直接或间接继承 UserWidget，
 * 不按名字认）：原生父类是 UserWidget 或它的子类（项目头文件里拼出的继承链，见 native-widgets.ts）
 */
function blueprintClass(native: string, widgets: Set<string>) {
  if (native === 'EditorUtilityWidget' || native === 'EditorUtilityWidgetBlueprint')
    return 'EditorUtilityWidgetBlueprint'
  if (widgets.has(native)) return 'WidgetBlueprint'
  if (/AnimInstance$/.test(native)) return 'AnimBlueprint'
  return 'Blueprint'
}

/** 蓝图的原生父类：有 npc 用它，没有就顺着父蓝图（pc 是 /Game/A/BP_Base.BP_Base_C）往上找 */
function nativeOf(gc: string, bps: Map<string, { pc: string; npc: string }>) {
  const seen = new Set<string>()
  for (let cur = bps.get(gc); cur && !seen.has(cur.pc); cur = bps.get(cur.pc)) {
    if (cur.npc) return shortClass(cur.npc)
    seen.add(cur.pc)
    if (!bps.has(cur.pc)) return shortClass(cur.pc)
  }
  return ''
}

/** 解析 blueprints.jsonl.gz；格式不对返回空（调用方退回扫磁盘） */
export async function readUetovsAssets(found: Found, root: string, mounts: Mounts): Promise<IndexAsset[] | undefined> {
  const prefix = norm(path.resolve(root)) + '/'
  const lines = createInterface({ input: createReadStream(found.file).pipe(createGunzip()), crlfDelay: Infinity })
  const rows: { objectPath: string; file: string; pc: string; npc: string; isBp: boolean }[] = []
  let first = true
  try {
    for await (const line of lines) {
      if (!line) continue
      const o = JSON.parse(line) as Record<string, unknown>
      if (first) {
        first = false
        if (o.format !== ASSET_FORMAT) return undefined
        continue
      }
      const file = typeof o.p === 'string' ? o.p : ''
      if (!file) continue
      // 外层目录的解决方案可能管着好几个项目，只要这个项目的
      if (found.shared && !norm(file).startsWith(prefix)) continue
      const objectPath = (typeof o.o === 'string' && o.o) || toObjectPath(file, mounts)
      if (!objectPath) continue
      const pc = typeof o.pc === 'string' ? o.pc : ''
      const npc = typeof o.npc === 'string' ? o.npc : ''
      rows.push({ objectPath, file, pc, npc, isBp: !!(pc || npc || o.gc) })
    }
  } catch {
    // 读到一半坏了（UEToVS 正在替换文件、gzip 截断）：当这次没有，下次再读
    return undefined
  }
  if (first) return undefined
  const bps = new Map(rows.filter((r) => r.isBp).map((r) => [`${r.objectPath}_C`, r]))
  const widgets = await nativeWidgetClasses(root)
  return rows.map((r): IndexAsset => {
    if (/\.umap$/i.test(r.file)) return [r.objectPath, 'World']
    if (!r.isBp) return [r.objectPath, '']
    const cls = blueprintClass(nativeOf(`${r.objectPath}_C`, bps), widgets)
    return r.pc || r.npc ? [r.objectPath, cls, shortClass(r.pc || r.npc)] : [r.objectPath, cls]
  })
}

interface LuaIndexFile {
  format?: number
  files?: { path?: string; module?: string }[]
}

/** 解析 lua-index.json；读不了返回空 */
export async function readUetovsLua(found: Found, root: string): Promise<IndexLua[] | undefined> {
  const data = await readFile(found.file, 'utf8')
    .then((s) => JSON.parse(s.replace(/^﻿/, '')) as LuaIndexFile)
    .catch(() => undefined)
  if (!data || !Array.isArray(data.files)) return undefined
  const prefix = norm(path.resolve(root)) + '/'
  const out: IndexLua[] = []
  for (const f of data.files) {
    if (!f.path) continue
    if (found.shared && !norm(f.path).startsWith(prefix)) continue
    const mod = f.module || path.basename(f.path).replace(/\.lua$/i, '')
    out.push([mod, f.path])
  }
  return out
}
