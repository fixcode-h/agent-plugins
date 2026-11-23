import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Detection, EngineInfo, Vcs } from './types.ts'
import { exists, readJson, run, t } from './util.ts'
import { bridgeVersionIn, liveCards } from './instances.ts'
import { findEngine, findUproject } from './engine-locate.ts'

// 找 .uproject、找引擎挪到了 engine-locate.ts（独立脚本也要用），原来从这里取的照旧能取
export { findEngine, findUproject }

/** 最低支持的引擎版本（用户 2026-11-10 定：5.4 起） */
export const MIN_ENGINE = [5, 4]

export function versionOk(v: string) {
  const [a, b] = v.split('.').map((x) => parseInt(x, 10))
  if (!Number.isFinite(a)) return false
  return a > MIN_ENGINE[0] || (a === MIN_ENGINE[0] && (b || 0) >= MIN_ENGINE[1])
}

/**
 * 版本管理：往上找 .git / .svn，P4 看配置文件（常见名字 + 环境变量和 p4 set 里的 P4CONFIG）。
 * 不跑 p4 where：要连服务器，慢的时候几秒（用户 2026-11-23：「p4 where 不要用这个」）
 */
export async function detectVcs(root: string): Promise<Vcs> {
  const names = [process.env.P4CONFIG, '.p4config', 'p4config.txt', await p4ConfigName()]
  let d = root
  for (let i = 0; i < 12; i++) {
    if (exists(path.join(d, '.git'))) return 'git'
    if (exists(path.join(d, '.svn'))) return 'svn'
    for (const f of names) if (f && exists(path.join(d, f))) return 'p4'
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  return 'none'
}

let p4Config: Promise<string | undefined> | undefined // 模块状态：缓存，进程里只问一次

/** p4 set 里的 P4CONFIG（只读本机设置，不连服务器）：P4CONFIG=p4config.txt (set) */
function p4ConfigName() {
  p4Config ??= run('p4', ['set', '-q', 'P4CONFIG'], { cwd: process.cwd(), timeout: 3000 })
    .then((r) => /^P4CONFIG=([^\s(]+)/m.exec(r.out.trim())?.[1])
    .catch(() => undefined)
  return p4Config
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
        : t('没找到这个项目用的引擎（EngineAssociation：{a}），可以在「权限与设置」里手动指定引擎目录', {
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
