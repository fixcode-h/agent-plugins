import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
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
const cache = new Map<string, { root: string; p: P }>() // 模块状态：缓存，丢了重取
/** 这次进程里已经把哪个文档根写给 UE 了：不必每次都读写一遍提示文件 */
const hinted = new Map<string, string>() // 模块状态：缓存，丢了重写

/** 旧规则（项目外层同级的 ProjectDoc/docs 或项目里的 docs）：面板给不出时用，也是旧数据可能在的地方 */
export { legacyDocsRoot }

type P = Pick<UeProject, 'id' | 'root'>

export function docsRoot(p: P) {
  return cache.get(p.id)?.root ?? legacyDocsRoot(p.root)
}

/**
 * 问面板要文档根存起来；面板没有这个接口、项目不在了、出错都不报，退回旧规则。
 * 取到一次就一直用：项目设置里改了文档根，面板会发 onDocRootChange（面板 server/docs/root-cache.ts），
 * 这里收到就重取——以前是 60 秒 TTL 加后台重取，改了设置最多一分钟才跟上
 */
export async function refreshDocsRoot(p: P, force = false) {
  follow()
  if (!force && cache.has(p.id)) return
  await askDocsRoot(p)
}

/** 订阅面板的文档根变化（只订一次）；插件停用时 stopDocsRootFollow 退订 */
let off: (() => void) | undefined // 模块状态：运行时
let following = false // 模块状态：运行时
function follow() {
  if (following) return
  following = true
  void import('@panel/server/docs/root-cache').then(
    ({ onDocRootChange }) => {
      off = onDocRootChange((id) => {
        const hit = cache.get(id)
        if (hit) void askDocsRoot(hit.p)
      })
    },
    () => {
      // 旧面板没有这个事件：取到的文档根一直用到插件重新加载
    },
  )
}
export function stopDocsRootFollow() {
  off?.()
  off = undefined
  following = false
}

async function askDocsRoot(p: P) {
  try {
    const got = await c().projects?.docRoot?.(p.id)
    if (!got) return
    const root = path.resolve(got)
    cache.set(p.id, { root, p: { id: p.id, root: p.root } })
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
  root ? cache.set(id, { root, p: { id, root } }) : cache.delete(id)

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

/** 以前设置里选「项目里 .agent-panel/ue」时写在那里的共用文件（gm.json 另有自己的设置，不在这里） */
const PROJECT_STORE_FILES = ['favorites.json', 'lua-snippets.json', 'lua-gm.json', 'lua-gm-scan.mjs']

/**
 * 以前「收藏存哪」选了项目 .agent-panel/ue 的项目：那里的文件才是一直在用的那份，复制到文档根（盖掉文档根里可能留着的旧份）。
 * 2026-11-21 用户定这些都统一存文档根、去掉这个选项。旧文件不删（可能已经提交进版本管理，删不删由用户定）
 */
export async function adoptProjectStore(p: P) {
  const from = path.join(p.root, '.agent-panel', 'ue')
  const to = path.join(docsRoot(p), 'AgentPanel', 'UE')
  if (path.resolve(from) === path.resolve(to)) return
  for (const name of PROJECT_STORE_FILES) {
    if (!existsSync(path.join(from, name))) continue
    await mkdir(to, { recursive: true })
    await copyFile(path.join(from, name), path.join(to, name))
  }
}
