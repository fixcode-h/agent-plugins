import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { UeProject } from '../types.ts'
import { c, t } from '../util.ts'
import { adoptOld, configFile, matchFiles, readConfig, scriptFile, storeDir } from './config.ts'
import type { LuaGmItem, LuaGmParam, LuaGmScan } from './types.ts'

/** 推给打开着 GM 页的网页：扫描结果变了（文件改了自动重扫、手动重扫），网页收到再取，不轮询 */
export const LUA_GM_EVENT = 'lua-gm'

const MAX_ITEMS = 5000
const TIMEOUT = 20000

/**
 * 子进程里跑扫描脚本：脚本是 AI 写的，放在面板进程里跑，死循环会卡住整个面板，抛错也可能带崩。
 * 读文件由这里做，脚本只拿到 { path, text } 列表，输出 GM 列表
 */
const RUNNER = `
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
let input = ''
for await (const chunk of process.stdin) input += chunk
const { script, root, files } = JSON.parse(input)
const mod = await import(pathToFileURL(script).href)
const scan = mod.default ?? mod.scan
if (typeof scan !== 'function') throw new Error('扫描脚本要 export default 一个函数：scan(files) => GM 列表')
const list = files.map((f) => ({ path: f, text: readFileSync(path.resolve(root, f), 'utf8').replace(/^\\uFEFF/, '') }))
const out = await scan(list, { root })
process.stdout.write('\\n@@LUA_GM@@' + JSON.stringify(out ?? null))
`

function runScript(root: string, script: string, files: string[]) {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', RUNNER], {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(t('扫描脚本 {s} 秒没跑完，已经停掉：脚本里可能有死循环', { s: TIMEOUT / 1000 })))
    }, TIMEOUT)
    child.stdout.on('data', (d: Buffer) => {
      if (out.length < 20_000_000) out += d
    })
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 20000) err += d
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const i = out.lastIndexOf('@@LUA_GM@@')
      if (code !== 0 || i < 0) {
        // 只留报错的关键几行：Node 的报错带一长串内部调用栈
        const msg = err.trim().split('\n').slice(0, 12).join('\n') || t('退出码 {code}', { code: String(code) })
        return reject(new Error(t('扫描脚本出错：{msg}', { msg })))
      }
      try {
        resolve(JSON.parse(out.slice(i + 10)))
      } catch (e) {
        reject(new Error(t('扫描脚本的输出不是 JSON：{msg}', { msg: (e as Error).message })))
      }
    })
    child.stdin.end(JSON.stringify({ script, root, files }))
  })
}

const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

/** 校验并整理脚本输出：整体不对直接报错；个别条目不对丢掉并记一句，页面上照样显示 */
export function normalize(raw: unknown, files: string[]) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (raw as { items?: unknown }).items
      : undefined
  if (!Array.isArray(list))
    throw new Error(t('扫描脚本要返回 GM 数组（或 { items: [...] }），实际返回的是 {type}', { type: typeof raw }))
  const items: LuaGmItem[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const bad = (i: number, why: string) => warnings.length < 20 && warnings.push(`#${i + 1} ${why}`)
  for (const [i, x] of list.slice(0, MAX_ITEMS).entries()) {
    if (!x || typeof x !== 'object') {
      bad(i, t('不是对象'))
      continue
    }
    const o = x as Record<string, unknown>
    const name = s(o.name).trim()
    if (!name) {
      bad(i, t('没有 name'))
      continue
    }
    if (seen.has(name)) {
      bad(i, t('{name} 重复，只留第一个', { name }))
      continue
    }
    seen.add(name)
    const params: LuaGmParam[] = []
    for (const p of Array.isArray(o.params) ? o.params : []) {
      const q = (typeof p === 'string' ? { name: p } : p) as Record<string, unknown>
      const pn = s(q?.name).trim()
      if (!pn) continue
      params.push({
        name: pn,
        type: s(q.type).trim() || 'any',
        ...(q.default !== undefined && q.default !== null && s(q.default) !== '' ? { default: s(q.default) } : {}),
        ...(s(q.desc).trim() ? { desc: s(q.desc).trim() } : {}),
        ...(s(q.table).trim() ? { table: s(q.table).trim() } : {}),
      })
    }
    const file = s(o.file).replaceAll('\\', '/')
    items.push({
      name,
      group: s(o.group).trim(),
      desc: s(o.desc).trim(),
      params,
      file: file || files[0] || '',
      line: Math.max(0, Math.floor(Number(o.line) || 0)),
      ...(s(o.call).trim() ? { call: s(o.call).trim() } : {}),
    })
  }
  if (list.length > MAX_ITEMS) warnings.push(t('超过 {n} 条，后面的没列', { n: MAX_ITEMS }))
  return { items, warnings }
}

const cache = new Map<string, LuaGmScan>()
const running = new Map<string, Promise<LuaGmScan>>()

/** 扫一遍：脚本、GM 文件不在时给说明而不是报错（还没设置），脚本出错时 error 原样带上、items 为空 */
export function scan(p: UeProject): Promise<LuaGmScan> {
  const busy = running.get(p.id)
  if (busy) return busy
  const job = doScan(p).finally(() => running.delete(p.id))
  running.set(p.id, job)
  return job
}

/** 停掉后（插件关掉、重启）还没跑完的扫描不再盯目录 */
let gen = 0

async function doScan(p: UeProject): Promise<LuaGmScan> {
  const t0 = Date.now()
  const my = gen
  // 复制失败（文档根没权限、只读）不挡扫描：旧位置照样读得到
  await adoptOld(p).catch((e: Error) => c().log?.warn('UE：Lua GM 脚本搬到项目文档根失败', { error: e.message }))
  const cfg = await readConfig(p)
  const script = scriptFile(p)
  const { files, dirs } = await matchFiles(p.root, cfg.files)
  const res: LuaGmScan = {
    items: [],
    files,
    script,
    hasScript: existsSync(script),
    config: configFile(p),
    warnings: [],
    scannedAt: new Date().toISOString(),
    ms: 0,
  }
  if (cfg.files.length && !files.length)
    res.error = t('GM 文件设置里的路径一个文件也没找到：{files}', { files: cfg.files.join('、') })
  else if (res.hasScript && files.length) {
    try {
      Object.assign(res, normalize(await runScript(p.root, script, files), files))
    } catch (e) {
      res.error = (e as Error).message
    }
  }
  res.ms = Date.now() - t0
  if (my !== gen) return res
  cache.set(p.id, res)
  void follow(p, [...dirs, storeDir(p), path.dirname(script)]).catch(() => undefined)
  return res
}

/** 网页用：有缓存给缓存（毫秒级的事也不必每次切页都起进程），没有就扫 */
export async function current(p: UeProject, fresh = false) {
  return (!fresh && cache.get(p.id)) || scan(p)
}

/**
 * 文件变了自动重扫：逐个目录盯（Linux 上 Node 22 的递归 watch 按文件盯，编辑器保存时改名替换会丢事件，表格枚举扫描踩过）。
 * 只盯扫描时走过的目录、脚本和设置所在目录；最多 300 个目录，GM 文件不会散在比这更多的地方。
 * 目录监听走面板共用的 server/watch/dir（面板 ADR 0074）：和文件索引、GM 文件监听盯同一个目录时共用句柄
 */
interface Follow {
  dirs: string
  list: { close(): void }[]
  timer?: ReturnType<typeof setTimeout>
}
const watchers = new Map<string, Follow>() // 模块状态：运行时，丢了下次扫描时重盯

async function follow(p: UeProject, dirs: string[]) {
  const uniq = [...new Set(dirs.map((d) => path.resolve(d)))].filter((d) => existsSync(d)).slice(0, 300)
  const sig = uniq.join('|')
  const cur = watchers.get(p.id)
  if (cur?.dirs === sig) return
  unfollow(p.id)
  const w: Follow = { dirs: sig, list: [] }
  watchers.set(p.id, w)
  const kick = (name: string | null) => {
    // 只认 Lua、扫描脚本和设置文件；新建子目录也重扫一次（模式里有 ** 时新目录要盯上）
    if (name && !/\.(lua|mjs|json)$/i.test(name) && path.extname(name)) return
    clearTimeout(w.timer)
    w.timer = setTimeout(() => {
      void scan(p).then(
        (r) => c().pages?.push(LUA_GM_EVENT, { project: p.id, scannedAt: r.scannedAt, error: r.error ?? '' }),
        () => undefined,
      )
    }, 400)
    w.timer.unref?.()
  }
  const { watchDir } = await import('@panel/server/watch/dir')
  // 等加载的时候又换了一组目录：这一组作废
  if (watchers.get(p.id) !== w) return
  for (const d of uniq) {
    // 目录刚被删、没权限：少盯一个，手动「重新扫描」照样能用
    const fw = watchDir(d, kick)
    if (fw) w.list.push(fw)
  }
}

function unfollow(id: string) {
  const w = watchers.get(id)
  if (!w) return
  clearTimeout(w.timer)
  for (const fw of w.list) fw.close()
  watchers.delete(id)
}

export function stopLuaGmWatch() {
  gen++
  for (const id of [...watchers.keys()]) unfollow(id)
  cache.clear()
}
