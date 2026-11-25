import { readFile, stat } from 'node:fs/promises'
import { readAsset, type Asset } from '../../shared/uasset/asset.ts'
import { UassetError } from '../../shared/uasset/errors.ts'
import { setUassetT } from '../../shared/uasset/i18n.ts'
import type { UObj } from '../../shared/uasset/objects.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { assetFile } from './locate.ts'

/**
 * 编辑器没开时读资源（ue/docs/uasset-offline-reader.md）：按包路径找到磁盘上的文件，用自写的 TS 读取器读成对象表。
 * 同一个资源在资源页上会连着调好几个操作（摘要、属性、组件、大纲），按「文件 + 修改时间 + 大小」缓存最近几份，
 * 文件改了（保存、同步）自然重读。
 */

// 读取器的报错原样给用户和 Agent 看，走插件的翻译
setUassetT(t)

const MAX = 8
const cache = new Map<string, { key: string; asset: Asset }>() // 模块状态：最近读过的资源，丢了重读

export interface Loaded {
  asset: Asset
  file: string
  size: number
}

/** 读不了的原因（不是资源文件、烘焙过的、引擎版本不认识……）：调用方按它决定改用 UE 还是报错 */
export class OfflineReadError extends Error {}

export async function loadAsset(project: UeProject, pkgPath: string): Promise<Loaded> {
  const file = await assetFile(project.root, pkgPath)
  const st = await stat(file).catch(() => null)
  if (!st) throw new OfflineReadError(t('磁盘上没有 {p} 的文件（可能还没保存过）', { p: pkgPath.split('.')[0] }))
  const key = `${st.mtimeMs}:${st.size}`
  const hit = cache.get(file)
  if (hit?.key === key) {
    // 挪到最后：Map 的顺序当最近使用
    cache.delete(file)
    cache.set(file, hit)
    return { asset: hit.asset, file, size: st.size }
  }
  let asset: Asset
  try {
    asset = readAsset(new Uint8Array(await readFile(file)))
  } catch (e) {
    if (e instanceof UassetError) throw new OfflineReadError(e.message)
    throw new OfflineReadError(t('读取 {p} 出错：{why}', { p: pkgPath.split('.')[0], why: (e as Error).message }))
  }
  cache.set(file, { key, asset })
  while (cache.size > MAX) cache.delete(cache.keys().next().value!)
  return { asset, file, size: st.size }
}

/**
 * 对象路径 → 包里的对象：/Game/A/B（只给包）、/Game/A/B.B（资源本体）、/Game/A/B.B_C（生成类）、
 * /Game/A/B.Default__B_C（类默认对象）、/Game/A/B.B:Sub.Inner（子对象）。找不到返回 undefined
 */
export function findObject(a: Asset, objectPath: string): UObj | undefined {
  const p = String(objectPath).trim()
  if (!p.includes('.')) return a.main
  const hit = a.byPath.get(p)
  if (hit) return hit
  // 大小写不一致（用户手打的路径）
  const lower = p.toLowerCase()
  for (const [k, o] of a.byPath) if (k.toLowerCase() === lower) return o
  return undefined
}
