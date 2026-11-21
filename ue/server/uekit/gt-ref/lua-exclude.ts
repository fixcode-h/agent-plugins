import { ueDocFile } from '../../doc-root.ts'
import type { UeProject } from '../../types.ts'
import { readJson, t, writeJson } from '../../util.ts'

/**
 * 选对象面板 Lua 类树里排除的目录（用户 2026-11-21：右键文件夹排除，排除的放在树最下面「排除」分类里、不参与搜索）。
 * 存项目文档根的 AgentPanel/UE/lua-class-exclude.json，团队共用、可以提交。目录用 / 连（和 gt.classes 的 dir 一致）
 */
type P = Pick<UeProject, 'id' | 'root'>

const MAX = 200
const norm = (d: unknown) =>
  String(d ?? '')
    .replace(/\./g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
const clean = (list: unknown) =>
  Array.isArray(list) ? [...new Set(list.map(norm).filter(Boolean))].sort().slice(0, MAX) : []

export async function readLuaExclude(p: P): Promise<{ dirs: string[]; file: string }> {
  const { read, write: file } = ueDocFile(p, 'lua-class-exclude.json')
  return { dirs: clean((await readJson<{ dirs?: unknown }>(read, {})).dirs), file }
}

/** 按动作改（add / remove），不整份覆盖：文件是团队共用的 */
export async function editLuaExclude(p: P, b: { action?: unknown; dir?: unknown }) {
  const { dirs, file } = await readLuaExclude(p)
  const dir = norm(b.dir)
  if (!dir) throw new Error(t('没给目录'))
  if (b.action !== 'add' && b.action !== 'remove') throw new Error(t('不认识的操作：{a}', { a: String(b.action) }))
  const next = clean(b.action === 'add' ? [...dirs, dir] : dirs.filter((x) => x !== dir))
  await writeJson(file, { dirs: next })
  return { dirs: next, file }
}
