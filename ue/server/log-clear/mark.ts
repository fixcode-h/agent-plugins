import path from 'node:path'
import type { Card } from '../instances.ts'
import { c, readJson, writeJson } from '../util.ts'

/**
 * 清空日志的「水位线」：编辑器开着时，桥接只截断了日志文件，进程里的日志缓冲（log.tail 读的就是它）还留着旧行，
 * 网页清空后从游标 0 重取就又把旧行取回来了（用户 2026-11-20 报「清空了又显示出来」）。
 * 所以清空前记下当时的序号，之后读日志只给比它新的行；按进程（PID + 启动时间）存进数据目录，刷新页面、重启面板都还记得，
 * 进程重启序号从头数，换了启动时间的记录自然不再生效。
 */
interface Mark {
  startedAt: string
  seq: number
}
type Marks = Record<string, Mark>

const file = (projectId: string) => path.join(c().dataDir, 'log-clear', `${encodeURIComponent(projectId)}.json`)

export async function readMarks(projectId: string): Promise<Marks> {
  return readJson<Marks>(file(projectId), {})
}

/** 记下这个进程清空时的序号；顺手丢掉已经退出的进程的记录 */
export async function saveMark(projectId: string, card: Card, seq: number, live: Card[]) {
  const alive = new Map(live.map((x) => [String(x.pid), x.startedAt]))
  const next: Marks = {}
  for (const [pid, m] of Object.entries(await readMarks(projectId)))
    if (alive.get(pid) === m.startedAt) next[pid] = m
  next[String(card.pid)] = { startedAt: card.startedAt, seq }
  await writeJson(file(projectId), next)
}

/** 这个进程清空时的序号（没清过、或进程已重启时是 0） */
export function markOf(marks: Marks, card: Card | undefined) {
  const m = card && marks[String(card.pid)]
  return m && m.startedAt === card.startedAt ? m.seq : 0
}
