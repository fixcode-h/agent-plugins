import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../../util.ts'
import { callHits, fileKey } from './call-refs.ts'
import { exists, isDir, libPath, slash, stemOf, walkDirs, walkJson } from './files.ts'
import { scanCalls } from './scan.ts'
import type { LibArgs } from './types.ts'

/**
 * 场景库的文件夹：列出（空的也列）、新建文件夹、新建空白脚本、删除前看影响、删除。
 * 都直接读写磁盘，UE 没连着也能整理（设计稿 12.1）；GameTest 不用为它加操作。
 */

/** list：场景根下全部文件夹，按路径排；场景根还不存在时是空的 */
export async function listFolders(projectRoot: string, a: LibArgs) {
  const { rootAbs } = libPath(projectRoot, a.root, '')
  const folders = (await walkDirs(rootAbs)).sort((x, y) => x.localeCompare(y))
  return { folders }
}

/** 在 dir（相对场景根，空表示根）里放一个新名字：同名（不分大小写）已存在就报错，不覆盖 */
async function freshTarget(projectRoot: string, a: LibArgs, file: string) {
  const parent = libPath(projectRoot, a.root, a.dir ?? '')
  const abs = path.join(parent.abs, file)
  if (await exists(abs)) throw new Error(t('{p} 已经存在，换个名字', { p: slash(path.relative(parent.rootAbs, abs)) }))
  return { abs, rel: slash(path.relative(parent.rootAbs, abs)) }
}

/** mkdir：新建文件夹（上级不存在一起建，场景根还没有时也一样） */
export async function makeFolder(projectRoot: string, a: LibArgs) {
  const to = await freshTarget(projectRoot, a, stemOf(a.name ?? ''))
  await mkdir(to.abs, { recursive: true })
  return { path: to.rel }
}

/**
 * create：新建一个空白脚本（「新建脚本（编写）」）。GameTest 要求 steps 非空，先放一步「等 1 秒」占位，
 * 打开后在步骤列表里插入、改掉；schemaVersion 写 2（1.x 都认），以后由编辑器存盘时升到 3
 */
export async function createScript(projectRoot: string, a: LibArgs) {
  const name = (a.name ?? '').trim()
  const to = await freshTarget(projectRoot, a, `${stemOf(name)}.json`)
  await mkdir(path.dirname(to.abs), { recursive: true })
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 2,
    name,
    tags: [],
    steps: [{ action: 'wait', until: 'seconds', seconds: 1, note: '占位：换成真正的步骤' }],
  }
  await writeFile(to.abs, JSON.stringify(doc, null, '\t') + '\n', 'utf8')
  return { path: to.rel }
}

/** 要删掉的脚本（文件夹时是下面全部 .json，单个脚本就是它自己）；_ 开头的配置文件不算脚本 */
async function scriptsUnder(abs: string, rootAbs: string) {
  const files = (await isDir(abs)) ? await walkJson(abs) : (await exists(abs)) ? [abs] : []
  return files
    .map((f) => slash(path.relative(rootAbs, f)))
    .filter((r) => !path.basename(r).startsWith('_'))
    .sort((x, y) => x.localeCompare(y))
}

/**
 * deletePlan：删之前看影响——会删哪些脚本、删掉的以外还有谁在 call 它们（删了以后那些 call 会找不到）。
 * path 可以是文件夹，也可以是单个脚本
 */
export async function deletePlan(projectRoot: string, a: LibArgs) {
  const f = libPath(projectRoot, a.root, a.path ?? '')
  if (!f.rel) throw new Error(t('不能删场景根本身'))
  const dir = await isDir(f.abs)
  if (!dir && !(await exists(f.abs))) throw new Error(t('{p} 不存在（可能刚被移走或删掉，刷新一下）', { p: f.rel }))
  const scripts = await scriptsUnder(f.abs, f.rootAbs)
  const gone = new Set(scripts.map(fileKey))
  const inside = (rel: string) =>
    dir ? fileKey(rel).startsWith(`${fileKey(f.rel)}/`) : fileKey(rel) === fileKey(f.rel)
  const callers: { file: string; at: string; script: string }[] = []
  for (const s of await scanCalls(f.rootAbs)) {
    if (inside(s.file)) continue
    for (const c of s.calls)
      if (dir ? callHits(c.script, f.rel, true) : gone.has(fileKey(c.script)))
        callers.push({ file: s.file, at: c.at, script: c.script })
  }
  return { path: f.rel, dir, scripts, callers }
}

/** delete：删文件夹（连同里面的全部）或单个脚本；网页先用 deletePlan 弹过确认 */
export async function deleteEntry(projectRoot: string, a: LibArgs) {
  const f = libPath(projectRoot, a.root, a.path ?? '')
  if (!f.rel) throw new Error(t('不能删场景根本身'))
  const dir = await isDir(f.abs)
  if (!dir && !/\.json$/i.test(f.abs)) throw new Error(t('只能删文件夹和 .json 脚本：{p}', { p: f.rel }))
  await rm(f.abs, { recursive: dir }).catch(() => {
    throw new Error(t('删不掉 {p}：不存在或被占用', { p: f.rel }))
  })
  // 整理过的脚本留着的原录制备份（gt-tidy.ts 的 <文件>.json.bak）跟着删，不留孤儿
  if (!dir) await rm(`${f.abs}.bak`, { force: true })
  return { path: f.rel }
}
