import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * 审计日志（设计稿 4.6）：每次飞书调用一行，按天一个文件 audit/YYYY-MM-DD.jsonl。
 * 只记谁、什么时候、对哪篇文档做了什么、怎么放行的，**不记文档内容**；设置页可以查、可以清空
 */

/** 怎么放行的：auto 在范围内直接放行（decision 里写原因）、once / always 卡片上点的、denied 拒绝、error 出错 */
export type AuditResult = 'auto' | 'once' | 'always' | 'denied' | 'error'

export interface AuditEntry {
  at: string
  taskId: string
  tool: string
  action: string
  /** 给人看的动作名 */
  label: string
  level: string
  /** 目标：规范 token 和标题（搜索类没有目标时是搜索词） */
  target?: string
  title?: string
  result: AuditResult
  /** 放行或拒绝的原因（link 你贴过的链接、card 卡片、trusted 信任范围……），出错时是错误信息 */
  detail?: string
  ms?: number
}

/** 留多少天 */
const KEEP_DAYS = 90

export class AuditLog {
  constructor(private dir: string) {}

  async add(e: AuditEntry) {
    await mkdir(this.dir, { recursive: true })
    await appendFile(path.join(this.dir, `${e.at.slice(0, 10)}.jsonl`), JSON.stringify(e) + '\n')
  }

  /** 最近的记录（新的在前）；按对话或关键字（标题、token、动作名）筛 */
  async list(o: { limit?: number; taskId?: string; q?: string } = {}): Promise<AuditEntry[]> {
    if (!existsSync(this.dir)) return []
    const limit = Math.min(Math.max(o.limit ?? 200, 1), 2000)
    const q = (o.q ?? '').trim().toLowerCase()
    const files = (await readdir(this.dir))
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse()
    const out: AuditEntry[] = []
    for (const f of files) {
      const lines = (await readFile(path.join(this.dir, f), 'utf8')).split('\n').filter(Boolean).reverse()
      for (const l of lines) {
        let e: AuditEntry
        try {
          e = JSON.parse(l) as AuditEntry
        } catch {
          continue
        }
        if (o.taskId && e.taskId !== o.taskId) continue
        if (q && ![e.title, e.target, e.label, e.taskId].some((x) => x?.toLowerCase().includes(q))) continue
        out.push(e)
        if (out.length >= limit) return out
      }
    }
    return out
  }

  async clear() {
    await rm(this.dir, { recursive: true, force: true })
  }

  /** 删掉 KEEP_DAYS 天以前的文件（插件启动时跑一次） */
  async sweep() {
    if (!existsSync(this.dir)) return
    const cut = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
    for (const f of await readdir(this.dir))
      if (f.endsWith('.jsonl') && f.slice(0, 10) < cut) await rm(path.join(this.dir, f), { force: true })
  }
}
