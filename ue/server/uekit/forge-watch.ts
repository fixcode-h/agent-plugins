import { stat } from 'node:fs/promises'
import path from 'node:path'
import { c, t } from '../util.ts'

/**
 * AssetForge 页「配置保存后右栏自动刷新计划和差异」（设计稿 UELink 小项）：盯着右栏正选中的那份配置，
 * 被编辑器或 Agent 存盘了就经面板的推送通道（ctx.pages）告诉这个页面，页面重拉差异、重新演练。不轮询。
 *
 * - 一个页面连接只盯一份（右栏只显示一份）；换了选中项整份替换，取消选中就不盯了。连接断了面板回调 onClose，一起清掉。
 * - 监听走面板共用的 server/watch/files（面板 ADR 0074）：盯所在目录（改名替换保存不丢）、停手后比修改时间，同一次保存只推一次。
 * - 配置 include 了片段文件（设计稿 4.3.4）时页面把片段一起报上来（extra）：片段存盘也算这份配置变了，推的还是主文件的路径。
 */
/** 同时最多盯这么多个页面连接 */
const MAX_CONNS = 64
/** 一份配置最多连带盯这么多个片段文件 */
const MAX_EXTRA = 50

/** 推给一个页面连接（api-ext.ts 给：走扩展事件同一个事件名，页面的 useExtEvents 收） */
export type PushTo = (data: Record<string, unknown>, conn: string) => void

interface Sub {
  project: string
  push: PushTo
  /** 页面登记时用的路径（相对配置根），推回去时页面按它对上选中项 */
  rel: string
  /** 主文件和 include 的片段文件（绝对路径），第一个是主文件 */
  files: string[]
  close: () => void
}

const subs = new Map<string, Sub>()
let closeHooked = false

function stop(conn: string) {
  const s = subs.get(conn)
  if (!s) return
  subs.delete(conn)
  s.close()
}

/** 主文件或片段任何一个变了：推主文件现在的修改时间 */
async function changed(conn: string, s: Sub) {
  if (subs.get(conn) !== s) return
  const st = await stat(s.files[0]).catch(() => undefined)
  const mtime = st?.isFile() ? st.mtime.toISOString() : ''
  s.push({ project: s.project, event: 'forge.file', path: s.rel, ...(mtime ? { mtime } : { missing: true }) }, conn)
}

/**
 * 页面登记要盯的配置：rootAbs 是配置根（forge.health 的 configRoot，调用方已核对在项目或 ProjectDoc 里），
 * b.path 相对它；path 为空 = 不盯了。只认配置根里的 .json（和右键菜单的本机动作同一条规矩）
 */
export async function forgeWatch(project: string, rootAbs: string, b: Record<string, unknown>, push: PushTo) {
  const conn = String(b.conn ?? '')
  if (!conn || !c().pages.open(conn)) return { watching: false }
  if (!closeHooked) {
    closeHooked = true
    c().pages.onClose(stop)
  }
  const rel = String(b.path ?? '').replace(/\\/g, '/')
  if (!rel) {
    // 只取消这个项目的：页面换项目时取消旧的和登记新的两个请求先后不定，不能把新项目的登记冲掉
    if (subs.get(conn)?.project === project) stop(conn)
    return { watching: false }
  }
  const inRoot = (r: string) => {
    const full = path.resolve(rootAbs, r)
    const back = path.relative(rootAbs, full)
    return back.startsWith('..') || path.isAbsolute(back) || !/\.json$/i.test(full) ? undefined : full
  }
  const full = inRoot(rel)
  if (!full) throw new Error(t('只能盯配置根里的 .json：{p}', { p: rel }))
  // 片段文件出了配置根的不盯（include 本来就不许出配置根），不报错
  const extra = (Array.isArray(b.extra) ? b.extra : [])
    .slice(0, MAX_EXTRA)
    .map((x) => inRoot(String(x).replace(/\\/g, '/')))
    .filter((x): x is string => !!x && x !== full)
  const files = [full, ...new Set(extra)]

  const cur = subs.get(conn)
  if (cur && cur.project === project && cur.files.join('\n') === files.join('\n')) return { watching: true }
  stop(conn)
  if (subs.size >= MAX_CONNS) return { watching: false }

  const { watchFiles } = await import('@panel/server/watch/files')
  // 等加载的时候同一个连接可能又登记了别的
  if (subs.has(conn)) stop(conn)
  const sub: Sub = { project, push, rel, files, close: () => {} }
  const w = watchFiles(files, () => void changed(conn, sub))
  // 盯不了（目录不存在、网络盘、权限）：主文件的目录盯不了就不盯，页面照旧能手动刷新；片段的目录盯不了跳过
  if (w.unwatched.includes(full)) {
    w.close()
    return { watching: false }
  }
  sub.close = w.close
  subs.set(conn, sub)
  return { watching: true }
}

/** 插件停掉时关掉所有 watcher */
export function stopForgeWatches() {
  for (const conn of [...subs.keys()]) stop(conn)
}
