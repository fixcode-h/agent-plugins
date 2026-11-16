import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { c, t } from '../util.ts'

/**
 * AssetForge 页「配置保存后右栏自动刷新计划和差异」（设计稿 UELink 小项）：盯着右栏正选中的那份配置，
 * 被编辑器或 Agent 存盘了就经面板的推送通道（ctx.pages）告诉这个页面，页面重拉差异、重新演练。不轮询。
 *
 * - 一个页面连接只盯一份（右栏只显示一份）；换了选中项整份替换，取消选中就不盯了。连接断了面板回调 onClose，一起清掉。
 * - 盯所在目录而不是文件本身：VS Code、Excel 一类编辑器保存是先写临时文件再改名替换，盯文件的话改名后就盯丢了。
 * - 保存时会连着来好几下事件：等它停 SETTLE_MS 再看修改时间，和上次推过的不一样才推，同一次保存只推一次。
 */
const SETTLE_MS = 300
/** 同时最多盯这么多个页面连接：每个占一个系统句柄 */
const MAX_CONNS = 64

/** 推给一个页面连接（api-ext.ts 给：走扩展事件同一个事件名，页面的 useExtEvents 收） */
export type PushTo = (data: Record<string, unknown>, conn: string) => void

interface Sub {
  project: string
  push: PushTo
  /** 页面登记时用的路径（相对配置根），推回去时页面按它对上选中项 */
  rel: string
  full: string
  mtime: string
  watcher: FSWatcher
  timer?: ReturnType<typeof setTimeout>
}

const subs = new Map<string, Sub>()
let closeHooked = false

function stop(conn: string) {
  const s = subs.get(conn)
  if (!s) return
  subs.delete(conn)
  if (s.timer) clearTimeout(s.timer)
  try {
    s.watcher.close()
  } catch {
    // 已经关了
  }
}

async function mtimeOf(full: string) {
  const st = await stat(full).catch(() => undefined)
  return st?.isFile() ? st.mtime.toISOString() : ''
}

async function check(conn: string, s: Sub) {
  s.timer = undefined
  const mtime = await mtimeOf(s.full)
  if (subs.get(conn) !== s || mtime === s.mtime) return
  s.mtime = mtime
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
  const full = path.resolve(rootAbs, rel)
  const back = path.relative(rootAbs, full)
  if (back.startsWith('..') || path.isAbsolute(back) || !/\.json$/i.test(full))
    throw new Error(t('只能盯配置根里的 .json：{p}', { p: rel }))

  const cur = subs.get(conn)
  if (cur && cur.full === full && cur.project === project) return { watching: true }
  stop(conn)
  if (subs.size >= MAX_CONNS) return { watching: false }

  const dir = path.dirname(full)
  const name = path.basename(full).toLowerCase()
  let watcher: FSWatcher
  try {
    watcher = watch(dir, { persistent: false }, (_e, f) => {
      const s = subs.get(conn)
      if (!s || s.watcher !== watcher) return
      // 有的系统不给文件名：当成可能是它，修改时间没变的不会推
      if (f && path.basename(String(f)).toLowerCase() !== name) return
      if (s.timer) clearTimeout(s.timer)
      s.timer = setTimeout(() => void check(conn, s), SETTLE_MS)
    })
  } catch {
    // 盯不了（目录不存在、网络盘、权限）：不报错，页面照旧能手动刷新
    return { watching: false }
  }
  watcher.on('error', () => {
    if (subs.get(conn)?.watcher === watcher) stop(conn)
  })
  subs.set(conn, { project, push, rel, full, mtime: await mtimeOf(full), watcher })
  return { watching: true }
}

/** 插件停掉时关掉所有 watcher */
export function stopForgeWatches() {
  for (const conn of [...subs.keys()]) stop(conn)
}
