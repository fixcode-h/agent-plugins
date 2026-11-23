import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { downloadFile } from '@panel/server/download'
import { mirrorUrls } from '@panel/shared/mirrors/registry'
import { c, t } from '../util.ts'
import { ocrInstalled, unloadOcr } from './engine.ts'
import { dirSize, installedFile, MODEL_VERSION, ocrDir, ORT_VERSION } from './files.ts'
import { extractTgz } from './tar.ts'

/**
 * 设置 → 插件 → UE 的「OCR」：下载 ONNX Runtime（npm 镜像）和 PP-OCRv5 mobile 模型（ModelScope）到插件数据目录。
 * 都走面板的下载（「设置 · 网络与代理」的代理、断点续传）；进度用 pages.push 推给打开着的设置页，页面不轮询。
 * 先下到 ocr/.staging，全部成功再换进去，下到一半失败不会留下半套。
 */
export const OCR_EVENT = 'ue-ocr'

export interface OcrState {
  installed: boolean
  /** 占用的磁盘大小（字节） */
  size?: number
  version?: string
  /** 正在下载：第几步 / 共几步、这一步的名字、已下载字节 / 大约总字节 */
  busy?: { step: number; steps: number; what: string; done: number; total: number }
  error?: string
  /** 删掉了但原生模块还加载着（Windows 上要重启面板才能删干净） */
  needRestart?: boolean
}

const MS = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master'

interface Item {
  what: string
  urls: string[]
  /** 大约多大（字节），只用来画进度条 */
  approx: number
  /** 下载后：tgz 解出需要的文件，其余原样放到 models/ */
  place: (file: string, staging: string) => Promise<void>
}

/** onnxruntime-node 包里只留 package.json、dist 和当前平台的二进制 */
function ortItems(): Item[] {
  const plat = `bin/napi-v6/${process.platform}/${process.arch}/`
  const pkg = (name: string, keep: (rel: string) => boolean, approx: number): Item => ({
    what: name,
    // npmmirror 在前、官方兜底（地址在面板的镜像注册表）
    urls: mirrorUrls('npm', `${name}/-/${name}-${ORT_VERSION}.tgz`, true),
    approx,
    place: async (file, staging) => {
      const n = await extractTgz(file, path.join(staging, 'runtime', 'node_modules', name), (entry) => {
        const rel = entry.replace(/^package\//, '')
        return rel !== entry && keep(rel) ? rel : undefined
      })
      if (!n) throw new Error(t('{name} 的压缩包里没有可用的文件', { name }))
    },
  })
  return [
    pkg('onnxruntime-common', () => true, 400_000),
    pkg(
      'onnxruntime-node',
      (rel) => rel === 'package.json' || rel.startsWith('dist/') || rel.startsWith(plat),
      115_000_000,
    ),
  ]
}

function modelItems(): Item[] {
  const model = (what: string, url: string, name: string, approx: number): Item => ({
    what,
    urls: [url],
    approx,
    place: async (file, staging) => {
      await mkdir(path.join(staging, 'models'), { recursive: true })
      await rename(file, path.join(staging, 'models', name))
    },
  })
  return [
    model(t('文字检测模型'), `${MS}/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx`, 'det.onnx', 4_800_000),
    model(t('文字识别模型'), `${MS}/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx`, 'rec.onnx', 16_600_000),
    model(t('字表'), `${MS}/paddle/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile/ppocrv5_dict.txt`, 'dict.txt', 75_000),
  ]
}

const SUPPORTED = ['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-arm64']

let busy: OcrState['busy']
let lastError: string | undefined
let needRestart = false
let abort: AbortController | undefined

export async function ocrState(): Promise<OcrState> {
  const installed = await ocrInstalled()
  return {
    installed,
    ...(installed ? { size: await dirSize(ocrDir()), version: `${MODEL_VERSION} · ONNX Runtime ${ORT_VERSION}` } : {}),
    ...(busy ? { busy } : {}),
    ...(lastError ? { error: lastError } : {}),
    ...(needRestart ? { needRestart } : {}),
  }
}

let lastPush = 0
async function push(force = false) {
  // 下载中每秒推两次就够，进度条不用更密
  const now = Date.now()
  if (!force && now - lastPush < 500) return
  lastPush = now
  c().pages.push(OCR_EVENT, await ocrState())
}

async function fetchOne(item: Item, to: string, onBytes: (n: number) => void, signal: AbortSignal) {
  const errors: string[] = []
  for (const url of item.urls) {
    const timer = setInterval(() => {
      stat(`${to}.part`).then(
        (s) => onBytes(s.size),
        () => undefined,
      )
    }, 500)
    try {
      await downloadFile(url, to, { signal, idleMs: 60000 })
      return
    } catch (e) {
      if (signal.aborted) throw e
      errors.push(`${url}：${(e as Error).message}`)
    } finally {
      clearInterval(timer)
    }
  }
  throw new Error(t('下载 {what} 失败：{e}', { what: item.what, e: errors.join('；') }))
}

async function run(signal: AbortSignal) {
  const dir = ocrDir()
  const staging = path.join(dir, '.staging')
  const dl = path.join(dir, '.download')
  await rm(staging, { recursive: true, force: true })
  await mkdir(dl, { recursive: true })
  const items = [...ortItems(), ...modelItems()]
  const total = items.reduce((n, i) => n + i.approx, 0)
  let before = 0
  for (const [i, item] of items.entries()) {
    busy = { step: i + 1, steps: items.length, what: item.what, done: before, total }
    await push(true)
    const file = path.join(dl, path.basename(new URL(item.urls[0]).pathname))
    await fetchOne(
      item,
      file,
      (n) => {
        busy = { step: i + 1, steps: items.length, what: item.what, done: before + Math.min(n, item.approx), total }
        void push()
      },
      signal,
    )
    if (signal.aborted) throw new Error(t('已取消'))
    await item.place(file, staging)
    await rm(file, { force: true })
    before += item.approx
  }
  // 换进去：先放掉旧的会话，再删旧文件
  await unloadOcr()
  for (const sub of ['runtime', 'models']) {
    await rm(path.join(dir, sub), { recursive: true, force: true })
    await rename(path.join(staging, sub), path.join(dir, sub))
  }
  await writeFile(
    installedFile(),
    JSON.stringify(
      {
        version: MODEL_VERSION,
        ort: ORT_VERSION,
        platform: `${process.platform}-${process.arch}`,
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )
  await rm(staging, { recursive: true, force: true })
  await rm(dl, { recursive: true, force: true })
}

export function installOcr() {
  if (busy) return { ok: true }
  if (!SUPPORTED.includes(`${process.platform}-${process.arch}`))
    throw new Error(
      t('ONNX Runtime 没有这个平台的版本（{p}），OCR 用不了', { p: `${process.platform}-${process.arch}` }),
    )
  lastError = undefined
  abort = new AbortController()
  busy = { step: 0, steps: 5, what: '', done: 0, total: 1 }
  const signal = abort.signal
  void run(signal)
    .catch((e: Error) => {
      lastError = signal.aborted ? undefined : e.message
      c().log.warn('UE：OCR 下载失败', { error: e.message })
    })
    .finally(() => {
      busy = undefined
      abort = undefined
      void push(true)
    })
  return { ok: true }
}

export function cancelOcrInstall() {
  abort?.abort()
  return { ok: true }
}

export async function removeOcr() {
  if (busy) throw new Error(t('正在下载，先取消再删'))
  const loaded = await unloadOcr()
  lastError = undefined
  try {
    await rm(installedFile(), { force: true })
    await rm(ocrDir(), { recursive: true, force: true })
    needRestart = false
  } catch {
    // Windows 上已加载的 onnxruntime.dll 删不掉：installed.json 已经删了，算没装；重启面板后再删一次就干净了
    needRestart = loaded
  }
  await push(true)
  return ocrState()
}

/** 设置页的接口：GET ocr、POST ocr/install、ocr/cancel、ocr/remove */
export async function ocrRoute(method: string, sub: string) {
  if (method === 'GET' && !sub) return ocrState()
  if (method === 'POST' && sub === 'install') return installOcr()
  if (method === 'POST' && sub === 'cancel') return cancelOcrInstall()
  if (method === 'POST' && sub === 'remove') return removeOcr()
  return undefined
}
