import type { GmObject, GmStore } from './schema.ts'

/**
 * 对象列表的文件夹（用户 2026-11-22：对象列表能建文件夹、新增对象必须选一个文件夹）。
 * 文件夹路径用 / 分层；对象记在自己的 folder 上，空文件夹记在 objFolders 里。这里只做纯数据变换，
 * 页面和 ue_gm 存对象都走这一份
 */

/** Agent 存新对象没写 folder 时放进的文件夹 */
export const AGENT_FOLDER = 'Agent'
/** 「在对象调用里打开」自定义 GM 时，对象列表里没有的对象自动加进的文件夹 */
export const CUSTOM_FOLDER = '来自自定义 GM'

/** 用户输入的文件夹 → 规范路径：去掉首尾和重复的 /、每段去空白；空的返回 '' */
export const normFolder = (s: string) =>
  s
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
    .join('/')

const inside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

/** 全部文件夹（含上级、空的），排好序 */
export function objFolders(g: Pick<GmStore, 'objects' | 'objFolders'>) {
  const out = new Set<string>()
  const add = (f: string) => {
    const parts = f.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  for (const f of g.objFolders) add(f)
  for (const o of g.objects) if (o.folder) add(o.folder)
  return [...out].sort((a, b) => a.localeCompare(b))
}

/** 建文件夹（已经有就不变） */
export function addObjFolder(g: GmStore, folder: string): GmStore {
  const f = normFolder(folder)
  if (!f || objFolders(g).includes(f)) return g
  return { ...g, objFolders: [...g.objFolders, f] }
}

/** 空文件夹只留最深的那几个（上级能推出来），删掉已经有对象的 */
function tidy(g: GmStore): GmStore {
  const used = new Set(g.objects.flatMap((o) => (o.folder ? [o.folder] : [])))
  const keep = [...new Set(g.objFolders)].filter(
    (f) => ![...used].some((u) => inside(u, f)) && !g.objFolders.some((x) => x !== f && x.startsWith(`${f}/`)),
  )
  return { ...g, objFolders: keep }
}

/** 文件夹改路径（改名、拖进别的文件夹）：下面的对象和子文件夹跟着改 */
export function moveObjFolder(g: GmStore, from: string, to: string): GmStore {
  const re = (p: string) => (inside(p, from) ? `${to}${p.slice(from.length)}` : p)
  return tidy({
    ...g,
    objects: g.objects.map((o) => (o.folder && inside(o.folder, from) ? { ...o, folder: re(o.folder) } : o)),
    objFolders: [...g.objFolders.map(re), to],
  })
}

/** 删文件夹：连同里面的对象（调用方先确认）；返回删掉的对象名 */
export function deleteObjFolder(g: GmStore, folder: string): { g: GmStore; removed: string[] } {
  const removed = g.objects.filter((o) => o.folder && inside(o.folder, folder)).map((o) => o.name)
  const gone = new Set(removed)
  return {
    removed,
    g: tidy({
      ...g,
      objects: g.objects.filter((o) => !gone.has(o.name)),
      objFolders: g.objFolders.filter((f) => !inside(f, folder)),
      common: g.common.filter((f) => !(f.key.startsWith('obj:') && gone.has(f.key.slice(4)))),
    }),
  }
}

/** 对象挪到别的文件夹（'' 是最外层） */
export function moveObject(g: GmStore, name: string, folder: string): GmStore {
  const f = normFolder(folder)
  const old = g.objects.find((o) => o.name === name)?.folder
  return tidy({
    ...g,
    objects: g.objects.map((o) => {
      if (o.name !== name) return o
      const { folder: _f, ...rest } = o
      return (f ? { ...rest, folder: f } : rest) as GmObject
    }),
    // 原来的文件夹空了也留着（用户建的文件夹不因为挪走对象就消失）
    objFolders: old ? [...g.objFolders, old] : g.objFolders,
  })
}
