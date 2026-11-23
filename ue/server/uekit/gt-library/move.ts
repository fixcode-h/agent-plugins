import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../../util.ts'
import { within } from '../gt-paths.ts'
import { outputRoot } from '../gt-disk.ts'
import { remapCall, remapPath, rewriteCalls, type PathMove } from './call-refs.ts'
import { exists, isDir, libPath, readJsonFile, slash, stemOf, walkJson, writeJsonFile } from './files.ts'
import { scanCalls } from './scan.ts'
import { touchIndexed } from '../../file-index.ts'
import type { LibArgs } from './types.ts'

/**
 * 场景库的移动和改名（拖动、右键改名）：脚本、文件夹都一样。动之前 movePlan 列出哪些 call 路径要跟着改，
 * 网页确认后 move 一起做：挪文件 → 改所有 call → history.json 里这几个场景的记录换成新路径（报告和历史跟过去）。
 * 设计稿 12.1；call 的写法见 call-refs.ts。
 */

interface Resolved {
  rootAbs: string
  from: { abs: string; rel: string }
  to: { abs: string; rel: string }
  dir: boolean
  /** 改名脚本时场景里的 name 跟着改 */
  name?: string
  moves: PathMove[]
}

async function resolveMove(projectRoot: string, a: LibArgs): Promise<Resolved> {
  const from = libPath(projectRoot, a.root, a.path ?? '')
  if (!from.rel) throw new Error(t('不能移动场景根本身'))
  const dir = await isDir(from.abs)
  if (!dir && !(await exists(from.abs)))
    throw new Error(t('{p} 不存在（可能刚被移走或删掉，刷新一下）', { p: from.rel }))
  if (!dir && !/\.json$/i.test(from.abs)) throw new Error(t('只能移动文件夹和 .json 脚本：{p}', { p: from.rel }))
  let toAbs: string
  let name: string | undefined
  if (a.name !== undefined) {
    name = a.name.trim()
    const stem = stemOf(name)
    toAbs = path.join(path.dirname(from.abs), dir ? stem : `${stem}.json`)
  } else {
    const parent = libPath(projectRoot, a.root, a.toDir ?? '')
    if (parent.abs !== parent.rootAbs && !(await isDir(parent.abs)))
      throw new Error(t('目标文件夹不存在：{p}', { p: parent.rel }))
    if (dir && (parent.abs === from.abs || within(from.abs, parent.abs)))
      throw new Error(t('不能把文件夹移进它自己里面'))
    toAbs = path.join(parent.abs, path.basename(from.abs))
  }
  const to = { abs: toAbs, rel: slash(path.relative(from.rootAbs, toAbs)) }
  // 只改大小写时目标「已存在」的就是它自己（Windows 不分大小写），照样能改
  if (to.abs.toLowerCase() !== from.abs.toLowerCase() && (await exists(to.abs)))
    throw new Error(t('{p} 已经存在，换个名字或位置', { p: to.rel }))
  return {
    rootAbs: from.rootAbs,
    from,
    to,
    dir,
    name: dir ? undefined : name,
    moves: [{ from: from.rel, to: to.rel, dir }],
  }
}

/** 没有任何变化（拖回原来的文件夹、改成同一个名字） */
const same = (r: Resolved) => r.from.abs === r.to.abs && (r.name === undefined || r.dir)

/** movePlan：要挪的脚本和要跟着改的 call（按文件列，旧 → 新），不动磁盘 */
export async function movePlan(projectRoot: string, a: LibArgs) {
  const r = await resolveMove(projectRoot, a)
  const scripts = r.dir
    ? (await walkJson(r.from.abs))
        .map((f) => slash(path.relative(r.rootAbs, f)))
        .filter((x) => !/(^|\/)_[^/]*$/.test(x))
    : [r.from.rel]
  const refs: { file: string; at: string; from: string; to: string }[] = []
  for (const s of await scanCalls(r.rootAbs))
    for (const c of s.calls) {
      const next = remapCall(c.script, r.moves)
      if (next !== undefined && next !== c.script) refs.push({ file: s.file, at: c.at, from: c.script, to: next })
    }
  return { path: r.from.rel, to: r.to.rel, dir: r.dir, same: same(r), scripts: scripts.length, refs }
}

/** history.json（Saved/<输出目录>/history.json）里按场景路径记的历史换成新路径；没有这个文件就算了 */
async function moveHistory(projectRoot: string, moves: PathMove[]) {
  const file = path.join(await outputRoot(projectRoot), 'history.json')
  const f = await readJsonFile(file)
  const all = (f?.doc as { scenarios?: unknown } | undefined)?.scenarios
  if (!f || !all || typeof all !== 'object' || Array.isArray(all)) return 0
  // 历史的键是带 .json 的相对路径，和 moves 的写法一样，直接按它换
  let n = 0
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(all as Record<string, unknown>)) {
    const nk = remapPath(k, moves)
    if (nk !== k) {
      n++
      // 新路径以前就有记录（删过又建了同名的）时，挪过来的这份为准
      next[nk] = v
    } else if (!(nk in next)) next[nk] = v
  }
  if (!n) return 0
  ;(f.doc as { scenarios: unknown }).scenarios = next
  await writeJsonFile(file, f)
  return n
}

/** move：挪文件 / 文件夹、改所有 call、改历史；返回新路径和改了几处 */
export async function moveEntry(projectRoot: string, a: LibArgs) {
  const r = await resolveMove(projectRoot, a)
  if (same(r)) return { path: r.to.rel, refs: 0, files: 0, history: 0 }
  if (r.from.abs !== r.to.abs) {
    await mkdir(path.dirname(r.to.abs), { recursive: true })
    await rename(r.from.abs, r.to.abs).catch((e: Error) => {
      throw new Error(t('移动失败：{p}（{e}）', { p: r.from.rel, e: e.message }))
    })
    // 「AI 整理」留的原录制备份（<文件>.json.bak）跟着脚本走；文件夹里的本来就一起挪了
    if (!r.dir && (await exists(`${r.from.abs}.bak`)) && !(await exists(`${r.to.abs}.bak`)))
      await rename(`${r.from.abs}.bak`, `${r.to.abs}.bak`).catch(() => undefined)
    touchIndexed([r.from.abs, r.to.abs])
  }
  if (r.name !== undefined) {
    const f = await readJsonFile(r.to.abs)
    if (f && f.doc && typeof f.doc === 'object' && !Array.isArray(f.doc)) {
      ;(f.doc as Record<string, unknown>).name = r.name
      await writeJsonFile(r.to.abs, f)
    }
  }
  let refs = 0
  let files = 0
  for (const abs of await walkJson(r.rootAbs)) {
    const f = await readJsonFile(abs)
    if (!f) continue
    const changed = rewriteCalls(f.doc, r.moves)
    if (!changed.length) continue
    await writeJsonFile(abs, f)
    refs += changed.length
    files++
  }
  const history = await moveHistory(projectRoot, r.moves).catch(() => 0)
  return { path: r.to.rel, refs, files, history }
}
