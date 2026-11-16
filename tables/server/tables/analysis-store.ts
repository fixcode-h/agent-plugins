/**
 * AI 分析表格风格的结果存进结构文件目录的 analysis.json（格式见 shared/tables-assist.ts 的 SavedAnalysis）。
 * 结构文件目录默认在项目里（.agentpanel/tables/），提交后别的分支、别的同事打开就能直接应用，不用重新分析
 */
import path from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { SavedAnalysis } from '../../shared/tables-assist.ts'

const FILE = 'analysis.json'

export async function readAnalysis(dir: string): Promise<SavedAnalysis | null> {
  const text = await readFile(path.join(dir, FILE), 'utf8').catch(() => '')
  if (!text) return null
  try {
    const p = SavedAnalysis.safeParse(JSON.parse(text))
    return p.success ? p.data : null
  } catch {
    // 手改坏了当没有
    return null
  }
}

/** 比存着的新才写（同一条回复再写一次也算，内容可能是重新解析的）；返回现在存着的那份 */
export async function writeAnalysis(dir: string, next: SavedAnalysis): Promise<SavedAnalysis> {
  const old = await readAnalysis(dir)
  if (old && old.at > next.at) return old
  const file = path.join(dir, FILE)
  const text = `${JSON.stringify(next, null, 2)}\n`
  // 内容没变不写：每次打开分析窗口都会交一次，P4 这类只读文件不该因此被要求 checkout
  if ((await readFile(file, 'utf8').catch(() => '')) === text) return next
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
  return next
}
