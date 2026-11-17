import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { readJson } from '../util.ts'
import { decodePng } from './png.ts'
import { installedFile, modelsDir, runtimeDir } from './files.ts'
import { recognize, type OcrBox, type OcrRunner, type Tensor } from './pipeline.ts'

/**
 * 加载装好的 OCR（ONNX Runtime + PP-OCRv5）：第一次用时从数据目录 require，之后常驻。
 * 运行时是原生模块，不进插件包、也不是面板的依赖，所以按绝对路径 createRequire，而不是 import。
 */
interface OrtSession {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>
  release?: () => Promise<void>
}
interface Ort {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown
  InferenceSession: { create(file: string, opts?: Record<string, unknown>): Promise<OrtSession> }
}

interface Engine {
  runner: OcrRunner
  dict: string[]
  sessions: OrtSession[]
}

let loading: Promise<Engine> | undefined

export async function ocrInstalled() {
  return !!(await readJson<{ version?: string } | undefined>(installedFile(), undefined))?.version
}

async function load(): Promise<Engine> {
  if (!(await ocrInstalled())) throw new Error('OCR 还没装：到「设置 → 插件 → UE」下载')
  const req = createRequire(path.join(runtimeDir(), 'index.js'))
  const ort = req('onnxruntime-node') as Ort
  // 线程数压低：OCR 在录完之后跑，不抢面板和 UE 的 CPU
  const opts = { intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all' }
  const det = await ort.InferenceSession.create(path.join(modelsDir(), 'det.onnx'), opts)
  const rec = await ort.InferenceSession.create(path.join(modelsDir(), 'rec.onnx'), opts)
  const wrap =
    (s: OrtSession) =>
    async (t: Tensor): Promise<Tensor> => {
      const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', t.data, t.dims) })
      const o = out[s.outputNames[0]]
      return { data: o.data as Float32Array, dims: o.dims }
    }
  const lines = (await readFile(path.join(modelsDir(), 'dict.txt'), 'utf8')).split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return { runner: { det: wrap(det), rec: wrap(rec) }, dict: lines, sessions: [det, rec] }
}

function engine() {
  loading ??= load().catch((e: unknown) => {
    loading = undefined
    throw e
  })
  return loading
}

/** 认一张 PNG 里的字；同一时间只跑一张（ONNX Runtime 自己用多线程，并发只会抢 CPU） */
let queue: Promise<unknown> = Promise.resolve()
export function ocrPng(file: string): Promise<OcrBox[]> {
  const job = queue.then(async () => {
    const e = await engine()
    return recognize(decodePng(await readFile(file)), e.runner, e.dict)
  })
  queue = job.catch(() => undefined)
  return job
}

/** 删除 OCR 前放掉会话（Windows 上加载着的 DLL 删不掉，原生模块本身要重启面板才放） */
export async function unloadOcr() {
  const e = await loading?.catch(() => undefined)
  loading = undefined
  for (const s of e?.sessions ?? []) await s.release?.().catch(() => undefined)
  return !!e
}
