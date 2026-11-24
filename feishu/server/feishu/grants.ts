import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 每个对话一张授权表（设计稿 4.2），存在插件数据目录 grants/<对话 id>.json：面板重启后同一个对话仍有效。
 *
 * - read：这个对话里可以读的文档（规范 token → 怎么来的）。用户贴过的链接、卡片上选了「这个对话里一直允许」的、
 *   这个对话新建的都在这里；只点了「允许」的那一次不记。
 * - write：可以写的文档，只有卡片上允许过的和这个对话新建的（问题 Q3：子对话不继承写）。
 * - refs：读过的文档里引用了谁（原样 token → 出处），弹卡时写明「从《A》里引用」。
 * - parent：父对话 id，子对话继承父对话的读权限（问题 Q3）。
 * 「一次允许」不记、拒绝不记：下次照样问
 */

export type GrantBy = 'link' | 'card' | 'created' | 'inherited' | 'trusted'

export interface DocGrant {
  title: string
  kind: string
  by: GrantBy
  at: string
}

export interface GrantFile {
  v: 1
  parent?: string
  read: Record<string, DocGrant>
  write: Record<string, DocGrant>
  refs: Record<string, { from: string; fromTitle: string }>
  /** 用户贴的链接（原样 token）解开后的规范 token：每个链接只问 lark-cli 一次 */
  seeds: Record<string, string>
  /** 最后用到的时间：清理老文件用 */
  at: string
}

const empty = (): GrantFile => ({ v: 1, read: {}, write: {}, refs: {}, seeds: {}, at: new Date().toISOString() })

/** 授权表多少天没用就删（对话早就结束了；删除对话时面板不通知插件） */
const KEEP_DAYS = 30

export class GrantStore {
  // 模块状态：缓存，对话 id → 授权表；改了马上落盘
  private mem = new Map<string, GrantFile>()
  constructor(private dir: string) {}

  private file(taskId: string) {
    return path.join(this.dir, `${taskId.replace(/[^\w.-]/g, '_')}.json`)
  }

  async get(taskId: string): Promise<GrantFile> {
    const hit = this.mem.get(taskId)
    if (hit) return hit
    let g = empty()
    try {
      const f = this.file(taskId)
      if (existsSync(f)) g = { ...empty(), ...(JSON.parse(await readFile(f, 'utf8')) as Partial<GrantFile>) }
    } catch {
      // 坏文件按空表算：最多是多问几次，不会多放行
    }
    this.mem.set(taskId, g)
    return g
  }

  async save(taskId: string) {
    const g = this.mem.get(taskId)
    if (!g) return
    g.at = new Date().toISOString()
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.file(taskId), JSON.stringify(g, null, 1))
  }

  /** 记下父对话（每轮开始时，子对话才有） */
  async setParent(taskId: string, parent: string | undefined) {
    if (!parent) return
    const g = await this.get(taskId)
    if (g.parent === parent) return
    g.parent = parent
    await this.save(taskId)
  }

  /** 能不能读：自己的读名单，再往上找父对话的（最多 5 层，防环） */
  async readable(taskId: string, token: string): Promise<DocGrant | undefined> {
    let id: string | undefined = taskId
    for (let depth = 0; id && depth < 5; depth++) {
      const g: GrantFile = await this.get(id)
      const hit = g.read[token]
      if (hit) return depth ? { ...hit, by: 'inherited' } : hit
      id = g.parent
    }
    return undefined
  }

  async writable(taskId: string, token: string) {
    return (await this.get(taskId)).write[token]
  }

  async grant(taskId: string, kind: 'read' | 'write', token: string, v: Omit<DocGrant, 'at'>) {
    const g = await this.get(taskId)
    g[kind][token] = { ...v, at: new Date().toISOString() }
    await this.save(taskId)
  }

  /** 记下引用：已经记过的不覆盖（第一次看到它的出处最有意义） */
  async noteRefs(taskId: string, tokens: string[], from: { token: string; title: string }) {
    const g = await this.get(taskId)
    let changed = false
    for (const tk of tokens)
      if (tk !== from.token && !g.refs[tk]) {
        g.refs[tk] = { from: from.token, fromTitle: from.title }
        changed = true
      }
    if (changed) await this.save(taskId)
  }

  /** 清掉 KEEP_DAYS 天没用过的授权表（插件启动时跑一次） */
  async sweep() {
    if (!existsSync(this.dir)) return
    const cut = Date.now() - KEEP_DAYS * 86_400_000
    for (const f of await readdir(this.dir)) {
      const p = path.join(this.dir, f)
      try {
        if ((await stat(p)).mtimeMs < cut) await rm(p, { force: true })
      } catch {
        // 删不掉下次再删
      }
    }
  }
}
