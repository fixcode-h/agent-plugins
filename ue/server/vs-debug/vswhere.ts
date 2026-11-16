import path from 'node:path'
import { exists, run } from '../util.ts'

/**
 * 用 VS 安装器自带的 vswhere 找 devenv.exe（「打开 VS」用）。
 * 先找装了 MSBuild 组件的（能编 UE 的那套），找不到再放宽条件；只在 Windows 上找
 */
export const vswherePath = () =>
  path.win32.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  )

const BASE = ['-latest', '-prerelease', '-products', '*']
export const VSWHERE_ARGS = [
  [...BASE, '-requires', 'Microsoft.Component.MSBuild', '-property', 'productPath'],
  [...BASE, '-property', 'productPath'],
]

/** vswhere -property productPath 的输出：一行一个路径，取第一个 devenv.exe（老版本 VS 的 productPath 可能是别的） */
export function parseVswhere(out: string): string | undefined {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /devenv\.exe$/i.test(l))
}

/** 找到了一直用；没找到隔一分钟才再查（用户可能刚装好 VS），免得每次状态刷新都起 vswhere */
let cached: { at: number; value: Promise<string | undefined> } | undefined
const RETRY_MS = 60000

export function findDevenv(): Promise<string | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  if (cached && Date.now() - cached.at < RETRY_MS) return cached.value
  const value = (async () => {
    const exe = vswherePath()
    if (!exists(exe)) return undefined
    for (const args of VSWHERE_ARGS) {
      const r = await run(exe, args, { timeout: 10000 })
      const hit = r.code === 0 ? parseVswhere(r.out) : undefined
      if (hit) return hit
    }
    return undefined
  })()
  cached = { at: Date.now(), value }
  value.then((v) => {
    // 找到了就不再过期
    if (v && cached?.value === value) cached = { at: Infinity, value }
  })
  return value
}
