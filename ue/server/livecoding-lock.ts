import path from 'node:path'
import type { BuildBlocker, UeProject } from './types.ts'
import { run } from './util.ts'

/**
 * Live Coding 的锁：UBT 判断「Live Coding 开着」只看一个全局互斥量在不在，不看进程。
 *
 * 编辑器启用 Live Coding 时按自己 exe 的完整路径建互斥量 Global\LiveCoding_<路径>（路径里的 / \ : 换成 +，
 * LiveCodingModule.cpp），UBT 编译时按目标的 exe 路径拼同样的名字去打开（HotReload.cs），打开得到就拒绝编译。
 * 互斥量要等所有打开它的句柄都关了才消失，所以「编辑器窗口关了」不等于「锁没了」：
 * 2026-11-11 用户强制关掉编辑器后 UBT 仍报 Live Coding is active，说明还有别的进程拿着这个锁。
 * 因此编译前和强制关掉之后都直接查这个互斥量（和 UBT 看的是同一个东西），并找出加载了 Live Coding 模块的进程。
 */
export function lockName(p: UeProject) {
  // 和 UBT 一样用目标 exe 的完整路径；C++ 项目的编辑器目标默认也输出到引擎的 UnrealEditor.exe
  const exe = path.win32.join(p.engine.dir, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')
  return `Global\\LiveCoding_${exe.replace(/[/\\:]/g, '+')}`
}

/** PowerShell 单引号字符串里单引号写两遍 */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

/** 锁还在不在；查不了返回 undefined（调用方照旧往下走，不当成在） */
export async function lockHeld(p: UeProject): Promise<boolean | undefined> {
  if (process.platform !== 'win32' || !p.engine.dir) return false
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$m=$null; [Threading.Mutex]::TryOpenExisting(${q(lockName(p))}, [ref]$m)`,
    ],
    { timeout: 20000 },
  )
  const out = r.out.trim()
  if (/^True$/im.test(out)) return true
  if (/^False$/im.test(out)) return false
  return undefined
}

interface Holder {
  Id: number
  Name?: string | null
  Path?: string | null
}

/**
 * 可能拿着锁的进程：加载了 Live Coding 模块（*-LiveCoding.dll）的进程，不管 exe 叫什么，再加上 LiveCodingConsole。
 * 管理员权限的进程读不到模块列表，会漏，漏了就靠强制关掉之后再查一次锁来发现。
 * 只留路径在这个引擎下、或读不到路径的。
 */
export async function lockHolders(p: UeProject): Promise<BuildBlocker[]> {
  if (process.platform !== 'win32' || !p.engine.dir) return []
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-Process | Where-Object { $_.Name -eq 'LiveCodingConsole' -or ($(try { $_.Modules | Where-Object { $_.ModuleName -like '*-LiveCoding.dll' } } catch { $null })) } | Select-Object Id,Name,Path) | ConvertTo-Json -Compress",
    ],
    { timeout: 60000 },
  )
  if (r.code !== 0 || !r.out.trim()) return []
  let list: Holder[] = []
  try {
    const parsed = JSON.parse(r.out) as Holder | Holder[]
    list = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
  const bin = path.win32.normalize(path.win32.join(p.engine.dir, 'Engine', 'Binaries')).toLowerCase() + '\\'
  return list
    .filter((x) => x.Id !== process.pid && (!x.Path || path.win32.normalize(x.Path).toLowerCase().startsWith(bin)))
    .map((x) => ({
      pid: x.Id,
      project: '',
      same: false,
      game: false,
      name: x.Path ? path.win32.basename(x.Path) : `${x.Name ?? '?'}.exe`,
      ...(x.Path ? {} : { unknown: true }),
    }))
}

/** 等锁消失（进程结束后句柄关掉要一点时间） */
export async function waitLockFree(p: UeProject, ms = 20000) {
  const until = Date.now() + ms
  for (;;) {
    const held = await lockHeld(p)
    if (held !== true || Date.now() > until) return held
    await new Promise((r) => setTimeout(r, 500))
  }
}
