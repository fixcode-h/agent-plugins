import net from 'node:net'
import { liveCards, type Card } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { c } from '../util.ts'

/**
 * 扩展的实时事件（UEKit docs/protocol.md 第 3、6 节）：连编辑器的推送通道（TCP，一行一个 JSON）订阅
 * forge.* / gt.* 主题，收到就用面板的推送（ctx.pages.push）转给打开着 AssetForge / GameTest 页的网页，网页不轮询。
 * 一个项目一条连接，有页面在看才连；页面都关了就断开。编辑器重启了（名片换了）页面再登记一次时重连。
 */
// uelink.outliner：UELink 自己的大纲变化事件（Actor 页的世界大纲据此重读）
export const EXT_TOPICS = ['forge.job', 'forge.changed', 'forge.reveal', 'gt.job', 'gt.record', 'uelink.outliner']

/** 推给网页的事件名：网页按 project 字段分项目 */
export const EXT_EVENT = 'uekit'

interface Link {
  conns: Set<string>
  sock?: net.Socket
  pid?: number
  retry?: ReturnType<typeof setTimeout>
}

const links = new Map<string, Link>()
let closeHooked = false

function hookClose() {
  if (closeHooked) return
  closeHooked = true
  c().pages.onClose((conn) => {
    for (const [id, l] of links) {
      l.conns.delete(conn)
      if (!l.conns.size) drop(id)
    }
  })
}

function drop(id: string) {
  const l = links.get(id)
  if (!l) return
  if (l.retry) clearTimeout(l.retry)
  l.sock?.destroy()
  links.delete(id)
}

/** 推给登记了这个项目的网页；follow.ts 也用它转后台编辑器里作业的进度 */
export const pushExt = (id: string, data: Record<string, unknown>) => {
  const l = links.get(id)
  if (l?.conns.size) c().pages.push(EXT_EVENT, { project: id, ...data }, l.conns)
}

/** 同一项目开着几个编辑器时连最新启动的那个（协议第 1 节） */
async function streamCard(root: string): Promise<Card | undefined> {
  const cards = (await liveCards(root)).filter((x) => x.kind === 'editor' && x.stream)
  return cards.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]
}

async function connect(p: UeProject) {
  const l = links.get(p.id)
  if (!l || l.sock) return
  const card = await streamCard(p.root)
  if (!card) {
    pushExt(p.id, { event: 'link', connected: false })
    return
  }
  const sock = net.createConnection({ host: '127.0.0.1', port: card.stream! })
  l.sock = sock
  l.pid = card.pid
  let buf = ''
  let first = true
  sock.setEncoding('utf8')
  sock.on('connect', () => {
    sock.write(`${JSON.stringify({ cmd: 'subscribe', protocol: 2, topics: EXT_TOPICS, token: card.token })}\n`)
  })
  sock.on('data', (chunk: string) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (first) {
        first = false
        if (msg.ok === false) {
          pushExt(p.id, { event: 'link', connected: false, error: String(msg.message ?? 'subscribe failed') })
          sock.destroy()
          return
        }
        pushExt(p.id, { event: 'link', connected: true, pid: card.pid })
        continue
      }
      if (typeof msg.event === 'string' && EXT_TOPICS.includes(msg.event)) pushExt(p.id, msg)
    }
  })
  const onEnd = () => {
    if (links.get(p.id)?.sock !== sock) return
    l.sock = undefined
    pushExt(p.id, { event: 'link', connected: false })
    // 编辑器关了或重启：页面还开着就过一会儿再找一次名片
    if (l.conns.size && !l.retry)
      l.retry = setTimeout(() => {
        l.retry = undefined
        void connect(p)
      }, 5000)
  }
  sock.on('error', onEnd)
  sock.on('close', onEnd)
}

/**
 * 页面登记要看这个项目的扩展事件（每次连上面板推送都要登记一次）。返回现在连没连上，
 * 编辑器换了（pid 不同）就重连
 */
export async function watch(p: UeProject, conn: string) {
  hookClose()
  if (!conn || !c().pages.open(conn)) return { connected: false }
  let l = links.get(p.id)
  if (!l) {
    l = { conns: new Set() }
    links.set(p.id, l)
  }
  l.conns.add(conn)
  const card = await streamCard(p.root)
  if (l.sock && card?.pid !== l.pid) {
    l.sock.destroy()
    l.sock = undefined
  }
  if (!l.sock) await connect(p)
  return { connected: !!l.sock, pid: l.pid }
}

export function stopAllStreams() {
  for (const id of [...links.keys()]) drop(id)
}
