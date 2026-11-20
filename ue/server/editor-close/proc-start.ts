import { run } from '../util.ts'

/**
 * 名片上的 PID 还是不是当初那个 UE 进程。
 *
 * 为什么要查：UE 崩溃或被强杀时来不及删名片，liveCards 只按「PID 还活着」清名片；
 * Windows 回收 PID 很快，这个 PID 一旦被别的程序拿到，旧名片就一直留着，目标下拉里多出一个
 * 没有世界、永远「暂时没有回应」的编辑器（用户 2026-11-20：怎么有两个编辑器）。关编辑器时更危险：
 * 按旧名片的 PID 去结束，结束的是不相干的程序。
 *
 * 判断办法：进程的创建时间比名片的 startedAt 还晚，名片就不可能是它写的（UELink 在进程起来后才写名片）。
 * 只在 Windows 查（其他平台 PID 回收慢，UE 也基本只在 Windows 上跑）；一个 PID + startedAt 只查一次，
 * 查不了（没有 PowerShell、超时）就当没换过，照旧显示，一分钟内不再试。
 */
const SLACK_MS = 5000
const known = new Map<string, boolean>()
const pending = new Map<string, Promise<boolean>>()
let failedAt = 0

const keyOf = (pid: number, startedAt: string) => `${pid}:${startedAt}`

/** 已经查过、确定是被别的进程顶替了的名片（liveCards 用：查结果没出来前先不拦） */
export function knownReused(pid: number, startedAt: string | undefined) {
  return !!startedAt && known.get(keyOf(pid, startedAt)) === true
}

/** 进程创建时间（UTC 毫秒）；进程刚好退出了是 NaN（不算查不了）；PowerShell 跑不起来返回 undefined */
async function createdAt(pid: number): Promise<number | undefined> {
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // 不用双引号：经过 Windows 命令行转义容易被 PowerShell 拆坏（同 procs.ts）
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CreationDate.ToUniversalTime().ToString('o')`,
    ],
    { timeout: 15000 },
  )
  if (r.code !== 0) return undefined
  return Date.parse(r.out.trim())
}

/**
 * 查这张名片的 PID 是不是被别的进程顶替了。结果缓存；查不了返回 false（宁可多显示一个，也不误删真名片）
 */
export function checkReused(pid: number, startedAt: string | undefined): Promise<boolean> {
  const card = Date.parse(startedAt ?? '')
  if (process.platform !== 'win32' || !startedAt || !Number.isFinite(card)) return Promise.resolve(false)
  const key = keyOf(pid, startedAt)
  const hit = known.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  if (Date.now() - failedAt < 60000) return Promise.resolve(false)
  let p = pending.get(key)
  if (!p) {
    p = createdAt(pid)
      .then((at) => {
        if (at === undefined) {
          failedAt = Date.now()
          return false
        }
        // 读不到创建时间（进程刚退出、权限不够）：不下结论，下次再查
        if (!Number.isFinite(at)) return false
        const reused = at > card + SLACK_MS
        known.set(key, reused)
        return reused
      })
      .finally(() => pending.delete(key))
    pending.set(key, p)
  }
  return p
}
