import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  findSections,
  HEAD,
  sectionIdsOf,
  orderSections,
  parseLocated,
  replaceSection,
  resolveInclude,
  sectionText,
} from '../../shared/forge-doc/index.ts'
import { forgeConfigRoot } from './forge-disk.ts'

/**
 * ue_forge action=describe 带 section（设计稿 4.3.3）：只读或只写配置的某一段，Agent 不用每次读写几千行。
 * 直接读写配置根里的文件，不经 UE（和 forge-disk.ts 同一个配置根）。
 * - 读：回这一段的原文（`"animations": [ … ]` 带字段名）、所在文件和行号；太长按行分页（offset = 从第几行接着读）。
 * - 写（给 text）：只把这一段换成 text，其他段一个字节不动，再按段的顺序排好顶层字段。
 * - 这一段是 `{ "include": "…" }`（段 include，4.3.4）：读回片段文件里的内容，写回也落到片段文件，主文件不动。
 *   段里面的节点 include 原样留着（写回时也原样交回，展开后的节点去改它的片段文件）。
 * 出错抛普通 Error：工具层把 message 交给 Agent。
 */

/** 一次回的段原文最多这么多字（读结构的上限，ADR 0067），多的按行分页 */
const MAX_TEXT = 12000

const slash = (p: string) => p.replace(/\\/g, '/')

/** 相对配置根的路径 → 绝对路径；出了配置根或不是 .json 抛错 */
function inRoot(rootAbs: string, rel: string) {
  const abs = path.resolve(rootAbs, rel)
  const back = path.relative(rootAbs, abs)
  if (!back || back.startsWith('..') || path.isAbsolute(back) || !/\.json$/i.test(abs))
    throw new Error(`只能读写配置根里的 .json 配置：${rel}`)
  return abs
}

async function readText(abs: string, rel: string) {
  const text = await readFile(abs, 'utf8').catch(() => undefined)
  if (text === undefined) throw new Error(`配置不存在：${rel}（路径相对配置根，ue_forge status 看配置根）`)
  return text
}

export async function forgeSection(projectRoot: string, a: Record<string, unknown>) {
  const config = slash(String(a.config ?? '')).replace(/^\//, '')
  if (!config) throw new Error('section 要和 config（相对配置根的配置路径）一起给')
  const id = String(a.section ?? '')
  const rootAbs = await forgeConfigRoot(projectRoot)
  const mainAbs = inRoot(rootAbs, config)
  const mainText = await readText(mainAbs, config)
  const ids = sectionIdsOf(mainText)
  const all = findSections(mainText, ids)
  const want = id === 'head' || id === 'header' ? HEAD : id
  const here = all.find((s) => s.id === want)
  const list = all.map((s) => `${s.id}（${s.startLine}-${s.endLine} 行${s.include ? `，include ${s.include}` : ''}）`)

  // 段 include：真正的内容在片段文件里；片段的这一段还可以再 include 同一段的片段，一直跟到真正的内容
  let file = config
  let abs = mainAbs
  let text = mainText
  let inc = want !== HEAD ? here?.include : undefined
  const seen = [config]
  while (inc) {
    const frag = resolveInclude(file, inc)
    if (!frag) throw new Error(`${file} 的 ${want} 段 include 的 ${inc} 出了配置根`)
    if (seen.includes(frag)) throw new Error(`include 成环：${[...seen, frag].join(' → ')}`)
    seen.push(frag)
    file = frag
    abs = inRoot(rootAbs, frag)
    text = await readText(abs, frag)
    inc = findSections(text, [want]).find((x) => x.id === want)?.include
  }

  if (typeof a.text === 'string') {
    if (!a.text.trim()) throw new Error('text 是空的：要交这一段的完整原文，例如 "animations": [ … ]')
    let next = replaceSection(text, want, a.text, file === config ? ids : [want])
    try {
      parseLocated(next)
    } catch (e) {
      throw new Error(`换上这一段后配置读不懂了，没有写：${(e as Error).message}`)
    }
    // 主文件写回时按段排好（设计稿 4.3.1）；片段文件只有 fragment 和这一段，不用排
    if (file === config) next = orderSections(next, ids)
    if (next !== text) await writeFile(abs, next, 'utf8')
    const after = findSections(next, file === config ? ids : [want]).find((s) => s.id === want)
    return {
      config,
      section: id,
      written: next !== text,
      ...(file !== config && { fragment: file }),
      ...(after && { lines: [after.startLine, after.endLine] }),
      next: '改完用 plan 演练看会改什么',
    }
  }

  const s = file === config ? here : findSections(text, [want]).find((x) => x.id === want)
  if (!s) return { config, error: `${config} 里没有 ${id} 段`, sections: list }
  const body = sectionText(text, want, file === config ? ids : [want]) ?? ''
  // 按行分页：offset 是这一段里从第几行（从 0 数）接着读
  const lines = body.split('\n')
  const from = Math.max(0, Math.min(lines.length, Number(a.offset) || 0))
  let end = from
  let size = 0
  while (end < lines.length && (end === from || size + lines[end].length + 1 <= MAX_TEXT))
    size += lines[end++].length + 1
  return {
    config,
    section: id,
    ...(file !== config && { fragment: file }),
    lines: [s.startLine, s.endLine],
    text: lines.slice(from, end).join('\n'),
    ...(end < lines.length && { truncated: true, nextOffset: end, totalLines: lines.length }),
    ...(from === 0 && { sections: list }),
  }
}
