import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { EngineInfo } from './types.ts'
import { exists, readJson, run } from './util.ts'

/**
 * 找 .uproject 和项目用的引擎：只用 Node 自带模块和 util.ts 的小工具，不碰面板开放模块，
 * 所以测试步骤「蓝图编译」的独立脚本（bp-check/cli.ts）也能打进去用（detect.ts 牵着桥接、UEKit，打不进独立脚本）
 */

/** 在目录里找 .uproject：先看目录本身，再看下一层（面板项目可能是仓库根，UE 项目在子目录） */
export async function findUproject(dir: string): Promise<string> {
  const pick = async (d: string) => {
    const names = await readdir(d).catch(() => [] as string[])
    const u = names.find((n) => n.toLowerCase().endsWith('.uproject'))
    return u ? path.join(d, u) : ''
  }
  const here = await pick(dir)
  if (here) return here
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const sub = await pick(path.join(dir, e.name))
    if (sub) return sub
  }
  return ''
}

async function buildVersion(dir: string) {
  const v = await readJson<{ MajorVersion?: number; MinorVersion?: number; PatchVersion?: number }>(
    path.join(dir, 'Engine', 'Build', 'Build.version'),
    {},
  )
  return v.MajorVersion ? `${v.MajorVersion}.${v.MinorVersion ?? 0}.${v.PatchVersion ?? 0}` : ''
}

/** Launcher 装的引擎：Windows 读 LauncherInstalled.dat */
async function launcherEngines(): Promise<{ version: string; dir: string }[]> {
  const out: { version: string; dir: string }[] = []
  const dat = path.join(
    process.env.ProgramData || 'C:\\ProgramData',
    'Epic',
    'UnrealEngineLauncher',
    'LauncherInstalled.dat',
  )
  const list = await readJson<{ InstallationList?: { InstallLocation: string; AppName: string }[] }>(dat, {})
  for (const i of list.InstallationList ?? []) {
    const m = /^UE_(\d+\.\d+)/.exec(i.AppName)
    if (m) out.push({ version: m[1], dir: i.InstallLocation })
  }
  // 非 Windows 和自定义位置：常见的默认安装目录
  for (const base of [
    'C:\\Program Files\\Epic Games',
    '/Users/Shared/Epic Games',
    path.join(homedir(), 'UnrealEngine'),
  ]) {
    for (const n of await readdir(base).catch(() => [] as string[])) {
      const m = /^UE_(\d+\.\d+)$/.exec(n)
      if (m && !out.some((o) => o.version === m[1])) out.push({ version: m[1], dir: path.join(base, n) })
    }
  }
  return out
}

/** 源码版引擎：Windows 注册表 HKCU\Software\Epic Games\Unreal Engine\Builds，其他系统 ~/.config/Epic/UnrealEngine/Install.ini */
async function sourceBuilds(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (process.platform === 'win32') {
    const r = await run('reg', ['query', 'HKCU\\Software\\Epic Games\\Unreal Engine\\Builds'], { timeout: 5000 })
    for (const line of r.out.split(/\r?\n/)) {
      const m = /^\s*(\S+)\s+REG_SZ\s+(.+?)\s*$/.exec(line)
      if (m) out[m[1]] = m[2]
    }
  } else {
    const ini = await readFile(path.join(homedir(), '.config', 'Epic', 'UnrealEngine', 'Install.ini'), 'utf8').catch(
      () => '',
    )
    for (const line of ini.split(/\r?\n/)) {
      const m = /^\s*([^=;[]+?)\s*=\s*(.+?)\s*$/.exec(line)
      if (m) out[m[1]] = m[2]
    }
  }
  return out
}

/** 按 EngineAssociation 找引擎；custom 是用户在「权限与设置」里手填的引擎目录 */
export async function findEngine(uproject: string, association: string, custom = ''): Promise<EngineInfo> {
  if (custom && exists(path.join(custom, 'Engine'))) {
    return { association, dir: custom, version: (await buildVersion(custom)) || association, source: 'custom' }
  }
  if (/^\d+\.\d+/.test(association)) {
    const hit = (await launcherEngines()).find((e) => e.version === association)
    if (hit && exists(hit.dir))
      return { association, dir: hit.dir, version: (await buildVersion(hit.dir)) || association, source: 'launcher' }
    return { association, dir: '', version: association, source: 'unknown' }
  }
  if (association) {
    const builds = await sourceBuilds()
    const dir = builds[association] ?? builds[association.replace(/[{}]/g, '')] ?? ''
    if (dir && exists(dir)) return { association, dir, version: await buildVersion(dir), source: 'source' }
    return { association, dir: '', version: '', source: 'unknown' }
  }
  // 空的 association：项目放在引擎源码树里，往上找 Engine/
  let d = path.dirname(path.dirname(uproject))
  for (let i = 0; i < 4; i++) {
    if (exists(path.join(d, 'Engine', 'Build', 'Build.version')))
      return { association, dir: d, version: await buildVersion(d), source: 'source' }
    d = path.dirname(d)
  }
  return { association, dir: '', version: '', source: 'unknown' }
}
