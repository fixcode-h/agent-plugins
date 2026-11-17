import path from 'node:path'
import { access, mkdir, writeFile } from 'node:fs/promises'
import type { DesignProject } from '../shared/design.ts'

/**
 * UI 项目归到面板项目（UI 设计 1.4.0 起按项目启用，面板插件接口 9 的 activation = project）：
 * 以前的 UI 项目没有 owner，升级后只做一次——
 * 1. id 和某个面板项目一样（第一版的设计挂在 Agent 项目下，迁成 UI 项目时沿用了项目 id）就归它；
 * 2. 目录一样、或一个在另一个里面，归目录最接近的那个；
 * 3. 面板只有一个项目时都归它；
 * 4. 都不行的留空，UI 设计页的「其他 UI 项目」里由用户点一下归到当前项目。
 * 归上了的面板项目顺手打开 UI 设计，升级后从项目工具还能找到原来的设计。
 */

interface PanelProject {
  id: string
  path: string
}

const norm = (p: string, win: boolean) => {
  const s = path.resolve(p).replace(/[\\/]+$/, '')
  // Windows 的盘符和目录名不分大小写
  return win ? s.toLowerCase() : s
}

/** 一个 UI 项目该归哪个面板项目；归不上返回 '' */
export function pickOwner(
  p: Pick<DesignProject, 'id' | 'path'>,
  panel: PanelProject[],
  win = process.platform === 'win32',
) {
  if (panel.some((x) => x.id === p.id)) return p.id
  if (p.path.trim()) {
    const me = norm(p.path, win)
    const inside = (a: string, b: string) => a === b || a.startsWith(b + path.sep) || a.startsWith(b + '/')
    const hits = panel
      .filter((x) => x.path.trim())
      .map((x) => ({ id: x.id, at: norm(x.path, win) }))
      .filter((x) => inside(me, x.at) || inside(x.at, me))
      // 目录完全一样的最先，其次路径最长（离得最近）的
      .sort((a, b) => Number(b.at === me) - Number(a.at === me) || b.at.length - a.at.length)
    if (hits[0]) return hits[0].id
  }
  return panel.length === 1 ? panel[0].id : ''
}

/**
 * 只做一次：插件数据目录里记一个标记（不只看 previousVersion——链接本机目录装的没有 previousVersion）。
 * 改了 list 里的 owner 返回 true，调用方存盘
 */
export async function adoptOwnersOnce(
  list: DesignProject[],
  o: {
    dataDir: string
    panel: () => Promise<PanelProject[]>
    enable: (projectId: string) => Promise<void>
    log: (msg: string, data?: Record<string, unknown>) => void
  },
) {
  const mark = path.join(o.dataDir, 'project-owner-migrated')
  if (
    await access(mark).then(
      () => true,
      () => false,
    )
  )
    return false
  const panel = await o.panel()
  // 面板还没有项目（新装、数据目录刚换）时先不记标记：等有了项目再归
  if (!panel.length) return false
  let changed = false
  for (const p of list) {
    if (p.owner) continue
    const owner = pickOwner(p, panel)
    if (!owner) continue
    p.owner = owner
    changed = true
  }
  const owners = [...new Set(list.map((p) => p.owner).filter((id) => panel.some((x) => x.id === id)))]
  for (const id of owners) await o.enable(id)
  await mkdir(o.dataDir, { recursive: true })
  await writeFile(mark, `${new Date().toISOString()}\n`)
  if (list.length)
    o.log('UI 设计：已把 UI 项目归到面板项目', {
      projects: list.length,
      adopted: list.filter((p) => p.owner).length,
      enabled: owners.length,
    })
  return changed
}
