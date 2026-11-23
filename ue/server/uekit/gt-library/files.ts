import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../../util.ts'
import { indexedDirs, indexedTree } from '../../file-index.ts'
import { insideProject, within } from '../gt-paths.ts'

/**
 * 场景库（GameTest 页左栏）整理用的磁盘工具：场景根里的路径核对、列目录、读写 JSON（照原文件的缩进写回）。
 * 出错抛普通 Error（消息原样显示给用户）：不 import 桥接，单测不用拉上面板模块。
 */

export const slash = (p: string) => p.replace(/\\/g, '/')

export const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

export const isDir = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  )

/** 场景根和其中一项（文件或文件夹）：rel 为空表示场景根本身。出了场景根直接拒绝 */
export function libPath(projectRoot: string, scenarioRoot: string, rel: string) {
  if (!scenarioRoot) throw new Error(t('不知道场景根在哪：先刷新 GameTest 页'))
  const rootAbs = insideProject(projectRoot, scenarioRoot)
  const clean = slash(rel ?? '')
    .replace(/^\/+|\/+$/g, '')
    .trim()
  const abs = path.resolve(rootAbs, clean)
  if (abs !== rootAbs && !within(rootAbs, abs)) throw new Error(t('只能整理场景根里的文件：{p}', { p: rel }))
  return { rootAbs, abs, rel: slash(path.relative(rootAbs, abs)) }
}

/** 名字落成文件名 / 文件夹名：去掉不能用的字符和首尾的点、空格；空的、只剩点的不行 */
export function stemOf(name: string) {
  const stem = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  if (!stem) throw new Error(t('名字不能是空的'))
  return stem
}

/** 场景根下全部 .json（含 _settings.json 这类配置：它们的守护里也可能 call 脚本）；. 开头的目录（.git）不进 */
export async function walkJson(dir: string, out: string[] = []) {
  // 面板有项目文件索引、场景根在索引里时直接取（. 开头的目录照样不进）
  const listed = await indexedTree(dir, /\.json$/i)
  if (listed) {
    for (const r of listed) if (!r.split('/').some((s) => s.startsWith('.'))) out.push(path.join(dir, ...r.split('/')))
    return out
  }
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) await walkJson(abs, out)
    else if (e.isFile() && /\.json$/i.test(e.name)) out.push(abs)
  }
  return out
}

/** 场景根下全部文件夹（相对路径，空的也算）：场景库里空文件夹也要显示 */
export async function walkDirs(rootAbs: string, dir = rootAbs, out: string[] = []) {
  if (dir === rootAbs) {
    const listed = await indexedDirs(rootAbs)
    if (listed) {
      out.push(...listed.filter((d) => !d.split('/').some((s) => s.startsWith('.'))))
      return out
    }
  }
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const abs = path.join(dir, e.name)
    out.push(slash(path.relative(rootAbs, abs)))
    await walkDirs(rootAbs, abs, out)
  }
  return out
}

/** 读出的 JSON 和它的写法（缩进、结尾换行），写回时照原样，diff 只有改了的那几行 */
export interface JsonFile {
  doc: unknown
  indent: string
  eol: string
}

export async function readJsonFile(abs: string): Promise<JsonFile | undefined> {
  const text = await readFile(abs, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const body = text.replace(/^﻿/, '')
    // 第一处缩进是什么就照什么写（UE 写的是 tab，手写的多是两个空格）；没有缩进的单行 JSON 也按 tab 写开
    const indent = /\n([ \t]+)\S/.exec(body)?.[1] ?? '\t'
    return { doc: JSON.parse(body), indent, eol: /\r\n/.test(body) ? '\r\n' : '\n' }
  } catch {
    return undefined
  }
}

export async function writeJsonFile(abs: string, f: JsonFile) {
  const text = JSON.stringify(f.doc, null, f.indent) + '\n'
  await writeFile(abs, f.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8')
}
