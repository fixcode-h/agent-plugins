import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Detection, EngineInfo, Vcs } from './types.ts'
import { exists, readJson, run, t } from './util.ts'
import { bridgeVersionIn, liveCards } from './instances.ts'

/** 最低支持的引擎版本（用户 2026-11-10 定：5.4 起） */
export const MIN_ENGINE = [5, 4]

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

export function versionOk(v: string) {
  const [a, b] = v.split('.').map((x) => parseInt(x, 10))
  if (!Number.isFinite(a)) return false
  return a > MIN_ENGINE[0] || (a === MIN_ENGINE[0] && (b || 0) >= MIN_ENGINE[1])
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

/** 按 EngineAssociation 找引擎；custom 是用户在「桥接与权限」里手填的引擎目录 */
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

/** 版本管理：往上找 .git / .svn，P4 看 P4CONFIG 文件或 p4 where 认不认这个目录 */
export async function detectVcs(root: string): Promise<Vcs> {
  let d = root
  for (let i = 0; i < 12; i++) {
    if (exists(path.join(d, '.git'))) return 'git'
    if (exists(path.join(d, '.svn'))) return 'svn'
    for (const f of [process.env.P4CONFIG, '.p4config', 'p4config.txt']) if (f && exists(path.join(d, f))) return 'p4'
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  const r = await run('p4', ['-d', root, 'where', path.join(root, '...')], { cwd: root, timeout: 4000 })
  if (r.code === 0 && r.out.trim() && !/not in client view|is not under client/i.test(r.out + r.err)) return 'p4'
  return 'none'
}

export async function detect(dir: string, customEngine = ''): Promise<Detection> {
  const empty: EngineInfo = { association: '', dir: '', version: '', source: 'unknown' }
  const base: Detection = {
    ok: false,
    root: dir,
    uproject: '',
    uname: '',
    engine: empty,
    supported: false,
    cpp: false,
    vcs: 'none',
    bridge: '',
    running: [],
  }
  if (!dir || !(await stat(dir).catch(() => null))?.isDirectory())
    return { ...base, error: t('项目目录不存在：{dir}', { dir }) }
  const uproject = await findUproject(dir)
  if (!uproject) return { ...base, error: t('这个目录里没有 .uproject，不是 UE 项目') }
  const root = path.dirname(uproject)
  const desc = await readJson<{ EngineAssociation?: string; Modules?: unknown[] }>(uproject, {})
  const engine = await findEngine(uproject, desc.EngineAssociation ?? '', customEngine)
  const supported = versionOk(engine.version)
  const cpp = exists(path.join(root, 'Source')) || (desc.Modules?.length ?? 0) > 0
  const [vcs, bridge, cards] = await Promise.all([detectVcs(root), bridgeVersionIn(root), liveCards(root)])
  return {
    ok: supported,
    error: supported
      ? undefined
      : engine.version
        ? t('引擎 {v} 不支持：UE 插件要求 5.4 及以上', { v: engine.version })
        : t('没找到这个项目用的引擎（EngineAssociation：{a}），可以在「桥接与权限」里手动指定引擎目录', {
            a: desc.EngineAssociation || '-',
          }),
    root,
    uproject,
    uname: path.basename(uproject, '.uproject'),
    engine,
    supported,
    cpp,
    vcs,
    bridge,
    running: cards.map((c) => ({ pid: c.pid, kind: c.kind })),
  }
}
