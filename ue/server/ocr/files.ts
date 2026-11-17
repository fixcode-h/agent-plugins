import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { c } from '../util.ts'

/**
 * OCR 装在插件数据目录的 ocr/ 下（设置 → 插件 → UE 里下载，不进插件包）：
 *   runtime/node_modules/onnxruntime-node、onnxruntime-common   ONNX Runtime（只有当前平台的二进制）
 *   models/det.onnx、rec.onnx、dict.txt                          PP-OCRv5 mobile 检测、识别模型和字表
 *   installed.json                                               装好的版本；没有它就算没装（下载到一半不算）
 */
export const ORT_VERSION = '1.31.1'
export const MODEL_VERSION = 'PP-OCRv5-mobile'

export const ocrDir = () => path.join(c().dataDir, 'ocr')
export const runtimeDir = () => path.join(ocrDir(), 'runtime')
export const modelsDir = () => path.join(ocrDir(), 'models')
export const installedFile = () => path.join(ocrDir(), 'installed.json')

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(f)
    else total += (await stat(f).catch(() => undefined))?.size ?? 0
  }
  return total
}
