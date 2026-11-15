import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { t } from '../shared/i18n.ts'
import { tablesOf, tablesOn } from '../shared/tables.ts'
import { resolvePath } from './fs.ts'

/**
 * 表格作为项目能力（面板插件接口 9，清单 activation = project）：新建项目时按目录推荐（detect），
 * 打开了但没设表格目录时说还缺什么（ready）。只读目录，不改文件
 */

const SKIP = new Set(['.git', '.svn', '.p4', 'node_modules', '.agentpanel', 'Binaries', 'Intermediate', 'Saved'])
const TABLE_EXT = /\.(xlsx|xlsm|xls|csv)$/i
/** 推荐只是看一眼：最多往下三层、最多看这么多个目录，大仓库也不会卡住新建项目 */
const MAX_DEPTH = 3
const MAX_DIRS = 400

/** 在项目目录里找表格文件：返回第一个找到的所在目录（相对项目）和数到的个数（数到 MAX_DIRS 个目录为止） */
export async function findTables(root: string) {
  let dirs = 0
  let count = 0
  let first = ''
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  while (queue.length && dirs < MAX_DIRS) {
    const { dir, depth } = queue.shift()!
    dirs++
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.isFile() && TABLE_EXT.test(e.name) && !e.name.startsWith('~$')) {
        count++
        if (!first) first = path.relative(root, dir) || '.'
      } else if (e.isDirectory() && depth < MAX_DEPTH && !SKIP.has(e.name) && !e.name.startsWith('.'))
        queue.push({ dir: path.join(dir, e.name), depth: depth + 1 })
    }
  }
  return { count, first }
}

export async function detectTables(project: { path: string }) {
  if (!project.path) return undefined
  const { count, first } = await findTables(resolvePath(project.path))
  if (!count) return undefined
  return first === '.'
    ? t('找到 {n} 个表格文件', { n: count })
    : t('在 {dir} 等目录找到 {n} 个表格文件', { dir: first, n: count })
}

export function tablesReady(project: { plugins?: Record<string, unknown> }) {
  return tablesOn(tablesOf(project)) ? undefined : t('还要选表格目录')
}
