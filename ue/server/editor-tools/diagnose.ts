import { readdir, readFile, stat } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import { editorBlockers } from '../procs.ts'
import { bridgeVersionIn, liveCards, olderVersion, type Card } from '../instances.ts'
import { availableVersion } from '../uelink.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'

/**
 * 连接诊断（设计稿「UE 插件优化与扩展」UELink 小项）：连不上 UE 时一页说清卡在哪一步。
 * 按连接的顺序查：装没装 → .uproject 有没有关掉 → 编译过没有 → 进程写没写名片 → HTTP 端口通不通、令牌对不对 → 版本差几个 → 推送通道。
 * 每项一行，不正常的给怎么修；action 是网页上能直接点的按钮（安装、编译、启动编辑器）。纯面板，不需要新的 C++。
 */
export type DiagState = 'ok' | 'warn' | 'fail' | 'skip'
export interface DiagItem {
  id: string
  title: string
  state: DiagState
  detail: string
  fix?: string
  action?: 'install' | 'build' | 'launch'
}

const item = (id: string, title: string, state: DiagState, detail: string, fix?: string, action?: DiagItem['action']) =>
  ({ id, title, state, detail, ...(fix && { fix }), ...(action && { action }) }) satisfies DiagItem

/** 目录下最新的文件修改时间（源码改了没重编时，源码比 DLL 新） */
async function newest(dir: string): Promise<number> {
  let best = 0
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) best = Math.max(best, await newest(f))
    else best = Math.max(best, (await stat(f).catch(() => undefined))?.mtimeMs ?? 0)
  }
  return best
}

/** 编辑器用的 UELink 模块 DLL（Development 叫 UnrealEditor-UELinkCore.dll，DebugGame 带后缀），取最新的一个 */
async function builtDll(root: string) {
  const dir = path.join(root, 'Plugins', 'UELink', 'Binaries', 'Win64')
  let best: { file: string; mtime: number } | undefined
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!/^UnrealEditor-UELinkCore.*\.dll$/i.test(n)) continue
    const s = await stat(path.join(dir, n)).catch(() => undefined)
    if (s && (!best || s.mtimeMs > best.mtime)) best = { file: path.join(dir, n), mtime: s.mtimeMs }
  }
  return best
}

/** .uproject 里明确写了 UELink Enabled: false */
async function disabledInUproject(p: UeProject) {
  try {
    const u = JSON.parse((await readFile(p.uproject, 'utf8')).replace(/^﻿/, '')) as {
      Plugins?: { Name?: string; Enabled?: boolean }[]
    }
    return (u.Plugins ?? []).some((x) => x.Name === 'UELink' && x.Enabled === false)
  } catch {
    return false
  }
}

/** HTTP：GET /info 带令牌。分清端口不通、令牌不对、其他错误 */
export async function probeHttp(card: Card): Promise<{ state: 'ok' | 'port' | 'token' | 'error'; msg: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${card.port}/info`, {
      headers: { 'X-AgentPanel-Token': card.token },
      signal: AbortSignal.timeout(3000),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (res.status === 401 || res.status === 403 || /令牌|token/i.test(body?.error ?? ''))
      return { state: 'token', msg: body?.error || `HTTP ${res.status}` }
    if (!body?.ok) return { state: 'error', msg: body?.error || `HTTP ${res.status}` }
    return { state: 'ok', msg: '' }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    if (err.name === 'TimeoutError') return { state: 'error', msg: t('3 秒内没有回应（可能卡在断点、加载或长帧里）') }
    return { state: 'port', msg: err.cause?.code || err.message }
  }
}

/** 推送通道：连上后发 ping（带令牌），读回一行 */
export function probeStream(card: Card): Promise<{ ok: boolean; msg: string; features?: string[] }> {
  return new Promise((resolve) => {
    if (!card.stream) return resolve({ ok: false, msg: t('名片里没有推送通道端口') })
    const sock = connect({ host: '127.0.0.1', port: card.stream })
    let buf = ''
    const done = (r: { ok: boolean; msg: string; features?: string[] }) => {
      sock.destroy()
      resolve(r)
    }
    sock.setTimeout(3000, () => done({ ok: false, msg: t('3 秒内没有回应') }))
    sock.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, msg: e.code || e.message }))
    sock.on('connect', () => sock.write(`${JSON.stringify({ cmd: 'ping', protocol: 2, token: card.token })}\n`))
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      try {
        const r = JSON.parse(buf.slice(0, nl)) as { ok?: boolean; message?: string; features?: string[] }
        done(r.ok ? { ok: true, msg: '', features: r.features } : { ok: false, msg: r.message || 'ok=false' })
      } catch (e) {
        done({ ok: false, msg: (e as Error).message })
      }
    })
  })
}

const kindName = (k: string) =>
  ({ editor: t('编辑器'), game: t('游戏'), server: t('专用服务器'), background: t('后台编辑器') })[k] ?? k

export async function diagnose(p: UeProject): Promise<{ items: DiagItem[]; at: string }> {
  const items: DiagItem[] = []
  const [installed, latest, cards] = await Promise.all([bridgeVersionIn(p.root), availableVersion(), liveCards(p.root)])

  // 1. 装没装、是不是最新
  if (!installed) {
    items.push(
      item('installed', t('插件已安装'), 'fail', t('Plugins/UELink 里没有 UELink'), t('点「安装」装进项目，再编译'), 'install'),
    )
  } else if (latest && olderVersion(installed, latest)) {
    items.push(
      item(
        'installed',
        t('插件已安装'),
        'warn',
        t('装的是 {v}，有新版 {latest}', { v: installed, latest }),
        t('点「升级」换成新版，再编译'),
        'install',
      ),
    )
  } else items.push(item('installed', t('插件已安装'), 'ok', installed))

  // 2. .uproject 里关掉了
  if (installed && (await disabledInUproject(p)))
    items.push(
      item(
        'enabled',
        t('项目里启用了插件'),
        'fail',
        t('{file} 的 Plugins 里 UELink 是 Enabled: false', { file: path.basename(p.uproject) }),
        t('在编辑器「插件」窗口里勾上 UELink，或把 .uproject 里那一项改成 true，重启编辑器'),
      ),
    )

  // 3. 编译过没有：Windows 上看 DLL 在不在、比源码新不新（纯蓝图项目没装 VS 时最常卡在这里）
  if (installed) {
    const dll = await builtDll(p.root)
    const src = await newest(path.join(p.root, 'Plugins', 'UELink', 'Source'))
    if (!dll)
      items.push(
        item(
          'built',
          t('插件编译过'),
          process.platform === 'win32' ? 'fail' : 'skip',
          t('Plugins/UELink/Binaries/Win64 里没有编辑器用的 UELinkCore 模块'),
          t('点「编译」；纯蓝图项目要本机装 Visual Studio 的 C++ 工作负载'),
          'build',
        ),
      )
    else if (src > dll.mtime + 1000)
      items.push(
        item(
          'built',
          t('插件编译过'),
          'warn',
          t('源码比编好的模块新（{when}）：装了新版还没重新编译', { when: new Date(dll.mtime).toLocaleString() }),
          t('关掉编辑器后点「编译」（Live Coding 不够，要完整编译）'),
          'build',
        ),
      )
    else items.push(item('built', t('插件编译过'), 'ok', path.basename(dll.file)))
  }

  // 4. 进程写没写名片：编辑器开着却没有名片，说明 UELink 没加载
  const editors = await editorBlockers(p).catch(() => ({ list: [] as { pid: number; same: boolean }[] }))
  const orphans = editors.list.filter((e) => e.same && !cards.some((c) => c.pid === e.pid))
  if (orphans.length)
    items.push(
      item(
        'card',
        t('进程写了名片'),
        'fail',
        t('编辑器 PID {pids} 在运行，但 Saved/UELink/instances 里没有它的名片', {
          pids: orphans.map((o) => o.pid).join('、'),
        }),
        t('UELink 没加载：看编辑器「插件」窗口里有没有启用、输出日志里有没有 LogAgentPanelBridge；命令行带了 -NoAgentPanel 时不起服务'),
      ),
    )
  else if (!cards.length)
    items.push(
      item(
        'card',
        t('进程写了名片'),
        'skip',
        t('没有在运行的 UE 进程'),
        t('启动编辑器后再诊断一次'),
        installed ? 'launch' : undefined,
      ),
    )
  else
    items.push(
      item(
        'card',
        t('进程写了名片'),
        'ok',
        cards.map((c) => `${kindName(c.kind)} ${c.pid} · ${t('端口')} ${c.port}`).join('；'),
      ),
    )

  // 5–7. 每个进程：端口、令牌、版本、推送通道
  for (const card of cards) {
    const who = `${kindName(card.kind)} ${card.pid}`
    const http = await probeHttp(card)
    if (http.state === 'port')
      items.push(
        item(
          `port-${card.pid}`,
          t('{who} · 端口能连上', { who }),
          'fail',
          t('连不上 127.0.0.1:{port}（{msg}）', { port: card.port, msg: http.msg }),
          t('名片可能是上次崩溃留下的、或端口被防火墙 / 代理软件拦了：重启编辑器；还不行在命令行加 -AgentPanelPort=空闲端口'),
        ),
      )
    else if (http.state === 'token')
      items.push(
        item(
          `token-${card.pid}`,
          t('{who} · 令牌对得上', { who }),
          'fail',
          t('端口通了但令牌不对（{msg}）', { msg: http.msg }),
          t('同一个端口上是另一个进程（多开、崩溃后端口被占）：关掉多余的编辑器，删掉 Saved/UELink/instances 里的旧名片后重启'),
        ),
      )
    else if (http.state === 'error')
      items.push(item(`port-${card.pid}`, t('{who} · 端口能连上', { who }), 'warn', http.msg, t('等编辑器加载完再试')))
    else items.push(item(`port-${card.pid}`, t('{who} · 端口和令牌', { who }), 'ok', `127.0.0.1:${card.port}`))

    if (installed && card.bridge && card.bridge !== installed)
      items.push(
        item(
          `version-${card.pid}`,
          t('{who} · 加载的是装好的版本', { who }),
          'warn',
          t('进程里是 {run}，磁盘上装的是 {disk}', { run: card.bridge, disk: installed }),
          t('装了新版还没重启：关掉编辑器，完整编译后再打开'),
          'build',
        ),
      )
    else if (card.bridge) items.push(item(`version-${card.pid}`, t('{who} · 版本', { who }), 'ok', card.bridge))

    // 推送通道只有编辑器有；HTTP 不通时它多半也不通，不重复报
    if (card.kind === 'editor' && http.state === 'ok') {
      const s = await probeStream(card)
      items.push(
        s.ok
          ? item(`stream-${card.pid}`, t('{who} · 推送通道', { who }), 'ok', `127.0.0.1:${card.stream}`)
          : item(
              `stream-${card.pid}`,
              t('{who} · 推送通道', { who }),
              'warn',
              t('推送通道不通（{msg}）：大纲、日志、作业进度不会实时更新', { msg: s.msg }),
              t('重启编辑器；还不行看输出日志里 LogUELinkStream 的报错'),
            ),
      )
    }
  }
  return { items, at: new Date().toISOString() }
}
