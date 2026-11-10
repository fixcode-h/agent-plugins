import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { HistoryItem } from './types.ts'
import { c, now, uid } from './util.ts'

/**
 * 操作记录（设计文档 6）：你和每个对话做过的修改，一个项目一个 JSONL 文件（插件数据目录 history/<项目>.jsonl）。
 * 运行时修改记下改前值，可撤回；超过保留天数的在读的时候清掉。
 */
const file = (project: string) => path.join(c().dataDir, 'history', `${encodeURIComponent(project)}.jsonl`)

export async function readHistory(project: string): Promise<HistoryItem[]> {
  const txt = await readFile(file(project), 'utf8').catch(() => '')
  const days = Number(c().config().historyDays) || 30
  const cutoff = Date.now() - days * 86400000
  const items: HistoryItem[] = []
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue
    try {
      const it = JSON.parse(line) as HistoryItem
      if (Date.parse(it.at) >= cutoff) items.push(it)
    } catch {
      // 写到一半的行跳过
    }
  }
  return items
}

async function rewrite(project: string, items: HistoryItem[]) {
  await mkdir(path.dirname(file(project)), { recursive: true })
  await writeFile(file(project), items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''))
}

/** 最多留多少条：Agent 循环调 ue_set 时记录涨得很快，超过就在下次写时裁掉旧的（追加是常态，裁剪很少发生） */
const MAX_ITEMS = 5000
const appended = new Map<string, number>()

export async function record(project: string, item: Omit<HistoryItem, 'id' | 'at'>) {
  const full: HistoryItem = { id: uid(), at: now(), ...item }
  await mkdir(path.dirname(file(project)), { recursive: true })
  await appendFile(file(project), JSON.stringify(full) + '\n')
  const n = (appended.get(project) ?? 0) + 1
  appended.set(project, n)
  if (n % 500 === 0) {
    const items = await readHistory(project)
    if (items.length > MAX_ITEMS) await rewrite(project, items.slice(-MAX_ITEMS))
  }
  return full
}

export async function markUndone(project: string, id: string, by: string) {
  const items = await readHistory(project)
  const it = items.find((i) => i.id === id)
  if (it) it.undone = `${now()} ${by}`
  await rewrite(project, items)
}

export async function clearHistory(project: string) {
  await rewrite(project, [])
}
