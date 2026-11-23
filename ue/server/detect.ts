import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Detection, EngineInfo, Vcs } from './types.ts'
import { exists, readJson, t } from './util.ts'
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
 * 版本管理：用面板的那一套判断（面板开放模块 server/vcs/detect，ADR 0073）。以前这里自己写了一份，
 * P4 配置文件名、往上找的层数、svn / p4 的先后都和面板不一样，同一个目录两边可能判断成不同的版本管理
 */
export async function detectVcs(root: string): Promise<Vcs> {
  const { detectVcs: panelDetect } = await import('@panel/server/vcs/detect')
  return (await panelDetect(root)).vcs
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
