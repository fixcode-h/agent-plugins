/**
 * 面板文件弹窗来问「这个表格文件归不归表格页」（面板插件网页 SDK 的 SheetClaimer）：
 * 和表格页的文件列表同一套规则——在设置的表格目录里、命中「包含」、没被「排除」（目录也算），跳过 .git 这类目录。
 * 认领后给出表格页用的路径：项目目录里的是相对路径，项目目录外的表格目录里的是正斜杠的绝对路径。
 * 对话在独立分支（worktree）里时，弹窗看的是分支里的副本：按它在分支里的相对路径认（表头设置照样适用），
 * 但 same 为 false，表格页打开的是项目目录里那一份，所以面板不给「在表格页打开」
 */
import path from 'node:path'
import { globHit, globList, TABLE_EXCLUDE, tableKind, tablesOn, type TablesConfig } from '../../shared/tables.ts'
import { resolvePath } from '../fs.ts'
import { absPath, tableRoot } from './files.ts'

/** 和 files.ts 列目录时跳过的一样 */
const SKIP_DIRS = new Set(['.git', '.svn', '.p4', 'node_modules', '.agentpanel'])

const norm = (p: string) => p.replace(/\\/g, '/')

/** child 在不在 parent 里（Windows 上 path.relative 不分大小写） */
function inside(parent: string, child: string) {
  const r = path.relative(parent, child)
  return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r))
}

export interface SheetClaimAnswer {
  /** 表格页用的文件路径（结构文件里也按它记表头）；不归表格页时为 null */
  rel: string | null
  /** 弹窗里的就是表格页会打开的那个文件（不是独立分支里的副本） */
  same: boolean
}

export function claimTableFile(dir: string, cfg: TablesConfig, file: string, root?: string): SheetClaimAnswer {
  const none = { rel: null, same: false }
  if (!tablesOn(cfg) || !file || !absPath(file) || !tableKind(file)) return none
  const full = path.resolve(resolvePath(file))
  const roots = cfg.dirs.map((d) => tableRoot(dir, d))
  let rel: string | null = null
  let same = true
  if (inside(dir, full)) rel = norm(path.relative(dir, full))
  else {
    const out = roots.find((r) => absPath(r.key) && inside(r.full, full))
    if (out) rel = norm(full)
    else if (root && absPath(root) && inside(path.resolve(resolvePath(root)), full)) {
      rel = norm(path.relative(path.resolve(resolvePath(root)), full))
      same = false
    }
  }
  if (!rel) return none
  const r = rel
  // 在哪个表格目录里；项目目录本身当表格目录时 key 是空串
  const under = roots.find((x) => x.key === '' || r === x.key || r.startsWith(x.key.replace(/\/+$/, '') + '/'))
  if (!under) return none
  const include = globList(cfg.include)
  const exclude = globList(cfg.exclude || TABLE_EXCLUDE)
  // 列目录时被排除的目录整个不进去：沿途每一层目录都查一遍
  const parts = r.split('/')
  for (let i = 1; i < parts.length; i++) {
    const sub = parts.slice(0, i).join('/')
    if (SKIP_DIRS.has(parts[i - 1]) || globHit(sub, exclude)) return none
  }
  if (!globHit(r, include) || globHit(r, exclude)) return none
  return { rel: r, same }
}
