/**
 * 把一个表格文件整个换成给定的字节（切换到某一版、跨项目整文件同步）：
 * 和保存一样先查 Excel / WPS 占用、P4 只读先 p4 edit、备份原文件，再写同目录临时文件改名替换。
 * 内容本来就一样时什么都不写
 */
import path from 'node:path'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import { forgetTable, lockedByOffice } from './files.ts'
import { forgetLists } from './list-index.ts'
import { backup, ensureWritable, type SaveDeps } from './write.ts'
import { HttpError } from './http-error.ts'

/** 返回是否真的写了 */
export async function replaceTableBytes(
  projectId: string,
  rel: string,
  full: string,
  buf: Buffer,
  deps: SaveDeps = {},
): Promise<boolean> {
  const info = await stat(full).catch(() => null)
  if (info && !info.isFile()) throw new HttpError(t('不是文件：{path}', { path: rel }))
  if (info && (await lockedByOffice(full)))
    throw new HttpError(t('文件正在 Excel / WPS 里打开，先在那边关掉再切换（不然那边保存时会把切换的内容盖掉）'), 409)
  if (info && buf.equals(await readFile(full))) return false
  if (info) {
    await ensureWritable(full, deps)
    await backup(projectId, rel, full)
  } else await mkdir(path.dirname(full), { recursive: true })
  // 同目录的临时文件再改名替换：写到一半断电也不会留下半个文件
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.agentpanel-tmp`)
  try {
    await writeFile(tmp, buf)
    await rename(tmp, full)
  } catch (e) {
    await rm(tmp, { force: true })
    throw new HttpError(t('写入失败：{err}', { err: (e as Error).message }), 409)
  }
  forgetTable(full)
  forgetLists(false)
  return true
}
