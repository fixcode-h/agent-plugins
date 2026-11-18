import { t } from '../../util.ts'
import { deleteEntry, deletePlan, createScript, listFolders, makeFolder } from './folders.ts'
import { moveEntry, movePlan } from './move.ts'
import type { LibArgs, LibHandler } from './types.ts'

/**
 * POST ext/gt/library：GameTest 场景库的整理（新建文件夹、新建脚本、拖动移动、改名、删除），设计稿 12.1。
 * 一个动作一个处理函数，加动作只在这张表里登记；全部直接读写磁盘，UE 没连着也能用。
 */
const HANDLERS: Record<string, LibHandler> = {
  list: listFolders,
  mkdir: makeFolder,
  create: createScript,
  deletePlan,
  delete: deleteEntry,
  movePlan,
  move: moveEntry,
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export async function libraryAction(projectRoot: string, b: Record<string, unknown>) {
  const action = String(b.action ?? '')
  const handler = HANDLERS[action]
  if (!handler)
    throw new Error(
      t('不认识的场景库操作：{a}（可用：{list}）', { a: action, list: Object.keys(HANDLERS).join(' / ') }),
    )
  const a: LibArgs = {
    root: String(b.root ?? ''),
    action,
    path: str(b.path),
    dir: str(b.dir),
    toDir: str(b.toDir),
    name: str(b.name),
  }
  return handler(projectRoot, a)
}
