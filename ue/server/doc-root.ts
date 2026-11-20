import { existsSync } from 'node:fs'
import path from 'node:path'
import type { UeProject } from './types.ts'
import { syncDocsHint } from './uekit/docs-hint.ts'
import { legacyDocsRoot } from './uekit/docs-sub.ts'
import { c } from './util.ts'

/**
 * 项目的文档根：用面板算好的那个（面板插件接口 15 的 projects.docRoot，和「文档」角色、模块文档同一个）。
 * 以前插件自己按「.uproject 上一级有 ProjectDoc/docs 就用它」猜，P4 / SVN 项目的文档根是各分支共用的一份
 * （面板 ADR 0052，可能在别的分支目录下、项目设置里还能改），UE 项目又常在面板项目的子目录里，换个分支或子目录就猜错，
 * 只需分析一次的 Lua GM 扫描脚本明明写过，GM 页还提示「还没设置」（用户 2026-11-20 报）。
 *
 * 面板的接口是异步的，这里的调用方多是同步取路径：registry 读项目时先 refreshDocsRoot 存一份，docsRoot 同步读它；
 * 旧面板没有这个接口、或者还没取到时退回旧规则
 */
const cache = new Map<string, { root: string; at: number }>() // 模块状态：缓存，丢了重取
/** 项目设置里改了文档根，一分钟内跟上；每次读项目都问面板太勤（面板那边要读角色列表、判断版本管理） */
const TTL = 60_000
/** 这次进程里已经把哪个文档根写给 UE 了：不必每分钟都读写一遍提示文件 */
const hinted = new Map<string, string>() // 模块状态：缓存，丢了重写

/** 旧规则（项目外层同级的 ProjectDoc/docs 或项目里的 docs）：面板给不出时用，也是旧数据可能在的地方 */
export { legacyDocsRoot }

type P = Pick<UeProject, 'id' | 'root'>

export function docsRoot(p: P) {
  return cache.get(p.id)?.root ?? legacyDocsRoot(p.root)
}

/** 问面板要文档根存起来；面板没有这个接口、项目不在了、出错都不报，退回旧规则 */
export async function refreshDocsRoot(p: P, force = false) {
  const hit = cache.get(p.id)
  if (!force && hit && Date.now() - hit.at < TTL) return
  try {
    const got = await c().projects?.docRoot?.(p.id)
    if (!got) return
    const root = path.resolve(got)
    cache.set(p.id, { root, at: Date.now() })
    // 告诉 UE 里的 AssetForge、GameTest（它们读 Saved/AgentPanel/docs-root.txt），文档根变了才重做
    if (hinted.get(p.id) !== root) {
      const moved = await syncDocsHint(p.root, root)
      hinted.set(p.id, root)
      if (moved.length) c().log?.info('UE：AssetForge / GameTest 旧目录已复制到项目文档根', { project: p.id, moved })
    }
  } catch (e) {
    c().log?.warn('UE：取不到面板的项目文档根，先按旧规则', { project: p.id, error: (e as Error).message })
  }
}

/** 测试用 */
export const setDocsRootForTest = (id: string, root: string | undefined) =>
  root ? cache.set(id, { root, at: Date.now() }) : cache.delete(id)

/**
 * 文档根下 AgentPanel/UE 里的一个文件：写在面板的文档根；读时那里没有、旧规则的位置有（升级前存的），就读旧的。
 * 下次写进新位置，旧文件留着不删（可能已经提交进版本管理，删不删由用户定）
 */
export function ueDocFile(p: P, name: string) {
  const cur = path.join(docsRoot(p), 'AgentPanel', 'UE', name)
  if (existsSync(cur)) return { read: cur, write: cur }
  const old = path.join(legacyDocsRoot(p.root), 'AgentPanel', 'UE', name)
  return { read: existsSync(old) ? old : cur, write: cur }
}
