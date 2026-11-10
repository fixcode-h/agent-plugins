import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { candidates, onPath } from './model.ts'

/**
 * 把 Blender 扩展（DSH Blender Bridge）直接装进本机 Blender，省掉「下载 → 偏好设置 → 从磁盘安装」。
 *
 * 一个「目标」是一个 Blender 版本（主.次，例如 4.2）：扩展按版本装在各自的用户配置目录里，
 * 4.2 和 4.3 是两份。找到可执行文件的版本用 Blender 自己的命令行装（`--command extension install-file -e`），
 * 会顺带启用并存进偏好设置；只找到配置目录、没找到程序的版本（便携版、装在别处）退一步把包解到
 * 它的 extensions/user_default/ 下，Blender 启动时能认出来，但要用户自己在「偏好设置 → 扩展」里勾选启用。
 */

const EXT_ID = 'dsh_blender_bridge'
/** 扩展平台从 4.2 开始才有，更早的版本装不了 */
const MIN = [4, 2]

export interface AddonTarget {
  /** 版本号「主.次」，也是安装接口认的 id */
  version: string
  /** 可执行文件；空串表示只找到了配置目录 */
  exe: string
  /** 用户配置目录（<配置根>/<版本>） */
  configDir: string
  /** 已装的扩展版本，没装是空串 */
  installed: string
  /** 版本够不够 4.2 */
  supported: boolean
}

/** 各系统 Blender 用户配置的根：下面一个版本一个目录 */
function configRoot(): string {
  if (process.platform === 'win32')
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Blender Foundation',
      'Blender',
    )
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Blender')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'blender')
}

const extDir = (configDir: string) => path.join(configDir, 'extensions', 'user_default', EXT_ID)

async function installedVersion(configDir: string): Promise<string> {
  const toml = await readFile(path.join(extDir(configDir), 'blender_manifest.toml'), 'utf8').catch(() => '')
  return /^\s*version\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? ''
}

const supported = (v: string) => {
  const [a, b] = v.split('.').map(Number)
  return a > MIN[0] || (a === MIN[0] && b >= MIN[1])
}

const run = (cmd: string, args: string[], timeout: number) =>
  new Promise<{ out: string; err: string }>((resolve, reject) =>
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (e, out, err) =>
      e
        ? reject(Object.assign(e, { stdout: String(out), stderr: String(err) }))
        : resolve({ out: String(out), err: String(err) }),
    ),
  )

/** 本机所有能找到的 Blender 程序：设置里填的、PATH 里的、常见安装位置（Windows 下 Program Files 里每个版本一个） */
function executables(configured: string): string[] {
  const list = [configured, onPath('blender'), ...candidates()]
  if (process.platform === 'darwin' && existsSync('/Applications')) {
    // Blender 4.2.app 这类改了名的副本也算
    for (const n of readdirSync('/Applications'))
      if (/^Blender.*\.app$/i.test(n)) list.push(path.join('/Applications', n, 'Contents', 'MacOS', 'Blender'))
  }
  return [...new Set(list.filter((f) => f && existsSync(f)).map((f) => path.resolve(f)))]
}

async function exeVersion(exe: string): Promise<string> {
  const { out } = await run(exe, ['--version'], 30_000).catch(() => ({ out: '' }))
  const m = /Blender\s+(\d+)\.(\d+)/.exec(out)
  return m ? `${m[1]}.${m[2]}` : ''
}

/** 列出可以装的 Blender 版本，新的在前 */
export async function addonTargets(configuredExe: string): Promise<AddonTarget[]> {
  const root = configRoot()
  const byVersion = new Map<string, { exe: string; configDir: string }>()
  for (const v of existsSync(root) ? readdirSync(root).filter((n) => /^\d+\.\d+$/.test(n)) : [])
    byVersion.set(v, { exe: '', configDir: path.join(root, v) })
  const exes = executables(configuredExe)
  const versions = await Promise.all(exes.map(exeVersion))
  exes.forEach((exe, i) => {
    const v = versions[i]
    if (!v) return
    const cur = byVersion.get(v)
    // 同一版本有几个程序时用先找到的（设置里填的、PATH 里的排在前面）
    if (cur?.exe) return
    byVersion.set(v, { exe, configDir: cur?.configDir ?? path.join(root, v) })
  })
  const out = await Promise.all(
    [...byVersion].map(async ([version, t]) => ({
      version,
      ...t,
      installed: await installedVersion(t.configDir),
      supported: supported(version),
    })),
  )
  const num = (v: string) => v.split('.').map(Number)
  return out.sort((a, b) => num(b.version)[0] - num(a.version)[0] || num(b.version)[1] - num(a.version)[1])
}

/** 只解这个扩展包用：读中央目录，存储（0）和 deflate（8）两种，路径里有 .. 或绝对路径的条目拒绝 */
async function unzip(zip: Buffer, dest: string) {
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--)
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('not a zip')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip')
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const skip = nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + skip
    if (name.split(/[\\/]/).includes('..') || path.isAbsolute(name)) throw new Error(`bad entry ${name}`)
    const file = path.join(dest, name)
    if (name.endsWith('/')) {
      await mkdir(file, { recursive: true })
      continue
    }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(start, start + size)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null
    if (!data) throw new Error(`unsupported zip method ${method}`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }
}

/** 装好的结果：enabled 为 false 时要用户自己去偏好设置里勾选启用 */
export interface InstallResult {
  version: string
  installed: string
  enabled: boolean
}

export async function installAddon(
  target: AddonTarget,
  zipPath: string,
  t: (zh: string, vars?: Record<string, string | number>) => string,
): Promise<InstallResult> {
  if (!target.supported)
    throw new Error(t('Blender {version} 不支持扩展，需要 4.2 或更新的版本', { version: target.version }))
  if (!existsSync(zipPath)) throw new Error(t('插件包里没有 Blender 扩展'))
  if (target.exe) {
    // -r user_default：装进用户默认的本地仓库（4.2 起自带）；-e：顺带启用并存进偏好设置
    try {
      await run(target.exe, ['--command', 'extension', 'install-file', '-r', 'user_default', '-e', zipPath], 180_000)
    } catch (e) {
      const err = e as Error & { stdout?: string; stderr?: string }
      const detail = (err.stderr || err.stdout || err.message).trim().split('\n').slice(-6).join('\n')
      throw new Error(t('Blender {version} 安装扩展失败：{error}', { version: target.version, error: detail }))
    }
  } else {
    await rm(extDir(target.configDir), { recursive: true, force: true })
    await unzip(await readFile(zipPath), path.dirname(extDir(target.configDir)))
  }
  const installed = await installedVersion(target.configDir)
  // 便携版的配置不在用户目录（在程序旁边的 portable/），命令成功就算装上了
  if (!installed && !target.exe)
    throw new Error(
      t('Blender {version} 安装扩展失败：{error}', { version: target.version, error: extDir(target.configDir) }),
    )
  return { version: target.version, installed, enabled: !!target.exe }
}
