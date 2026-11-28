import path from 'node:path'
import {
  LuaFnStore as LuaFnSchema,
  parseLuaFnStore,
  type LuaFnStore,
} from '../../../shared/gt-script/luafn/schema.ts'
import { luaFnIssues } from '../../../shared/gt-script/luafn/check.ts'
import { docsRoot } from '../../doc-root.ts'
import { GM_EVENT } from '../../store.ts'
import type { UeProject } from '../../types.ts'
import { c, readJson, writeJson } from '../../util.ts'

/**
 * GameTest 的 Lua 函数库（shared/gt-script/luafn/schema.ts）：和 gm.json、objects.json 放在一起（用户 2026-11-28：
 * 函数库要有专门的地方，不放场景根），默认在文档根的 AgentPanel/UE/gametest-lua.json，能提交、团队共用；
 * 项目设置 GM「只在本机」时跟着放插件数据目录。改了推 gm 事件（和 GM 库同一个，gm-custom/watch.ts 也盯这个文件）
 */
type P = Pick<UeProject, 'id' | 'root' | 'gmStore'>

export const luaFnFile = (p: P) =>
  p.gmStore === 'local'
    ? path.join(c().dataDir, 'gm', `${encodeURIComponent(p.id)}.gametest-lua.json`)
    : path.join(docsRoot(p), 'AgentPanel', 'UE', 'gametest-lua.json')

/** 读函数库：文件没有时是空的；格式不对时给空的 + error（编辑页、校验显示出来，不悄悄当没有） */
export async function readLuaFns(p: P): Promise<{ store: LuaFnStore; file: string; error?: string }> {
  const file = luaFnFile(p)
  const raw = await readJson<unknown>(file, null)
  return { ...parseLuaFnStore(raw), file }
}

/** 整份写回：按契约校验，函数名不许重复、不许有类结构（一处不对整份不写，原因写清楚） */
export async function writeLuaFns(p: P, data: unknown) {
  const next = LuaFnSchema.parse(data)
  const seen = new Set<string>()
  const bad: string[] = []
  for (const f of next.fns) {
    if (seen.has(f.name)) bad.push(`${f.name}：函数名重复`)
    seen.add(f.name)
    for (const why of luaFnIssues(f)) bad.push(`${f.name}：${why}`)
  }
  if (bad.length) throw new Error(`函数库没存：${bad.join('；')}`)
  next.fns.sort((a, b) => a.name.localeCompare(b.name))
  await writeJson(luaFnFile(p), next)
  c().pages?.push(GM_EVENT, { project: p.id })
  return next
}
