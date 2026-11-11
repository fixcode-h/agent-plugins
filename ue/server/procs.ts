import path from 'node:path'
import type { BuildBlocker, UeProject } from './types.ts'
import { alive, run, t } from './util.ts'

/**
 * 编译前查有没有开着的编辑器（只在 Windows 查）。
 *
 * 为什么要查：编辑器开着且启用了 Live Coding 时，UnrealBuildTool 看到 Live Coding 的互斥量就直接拒绝编译，
 * 只报一句 "Unable to build while Live Coding is active"。这个互斥量按编辑器可执行文件的路径命名，
 * 所以同一个引擎的任何编辑器（哪怕开的是别的项目、或者 -game 跑游戏）都会挡住；
 * 关掉 Live Coding 硬编也不行，编辑器占着模块的 DLL，链接会写不进去。
 * Live Coding 只有 Windows 有，其他平台不查。
 */
export const LIVE_CODING_BLOCK = /Unable to build while Live Coding is active/i

interface Proc {
  ProcessId: number
  Name?: string | null
  ExecutablePath?: string | null
  CommandLine?: string | null
}

const norm = (p: string) => path.win32.normalize(p).toLowerCase()

/** 命令行里的 .uproject：双击 .uproject 或从启动器打开时都带着 */
function projectOf(cmd: string) {
  const m = /"([^"]+?\.uproject)"|(\S+?\.uproject)/i.exec(cmd)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

/** 命令行第一段就是可执行文件（拿不到 ExecutablePath 时用，比如别的用户或提权起的进程） */
function exeOf(cmd: string) {
  const m = /^\s*(?:"([^"]+)"|(\S+))/.exec(cmd)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

/**
 * 这个引擎的编辑器进程：UnrealEditor.exe 和 DebugGame 等配置的 UnrealEditor-Win64-*.exe，
 * 不含 -Cmd 的命令行版（它不开 Live Coding）。
 * 路径和命令行都读不到的（编辑器用管理员权限打开、面板没有时，系统不给读）也算上，标成 unknown：
 * 看不出是不是这个引擎的，宁可多挡一次（网页有「不检查，仍然编译」），也别放过去让 Build.bat 失败。
 * others 是路径能读到、但不在这个引擎下的编辑器，只用来写诊断（预检没认出来时看得出为什么）。
 * 查不了（没有 PowerShell、超时）时返回 error，调用方照常编译，把原因写进输出。
 */
export async function editorBlockers(
  p: UeProject,
): Promise<{ list: BuildBlocker[]; others: string[]; error?: string }> {
  if (process.platform !== 'win32' || !p.engine.dir) return { list: [], others: [] }
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // 不用双引号（经过 Windows 命令行转义容易被 PowerShell 拆坏）；输出改 UTF-8，免得中文路径在 GBK 控制台下乱码对不上
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter 'Name LIKE ''UnrealEditor%.exe''' | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ],
    { timeout: 20000 },
  )
  if (r.code !== 0) return { list: [], others: [], error: (r.err || r.out).trim() || `exit ${r.code}` }
  let procs: Proc[] = []
  try {
    const parsed = r.out.trim() ? (JSON.parse(r.out) as Proc | Proc[]) : []
    procs = Array.isArray(parsed) ? parsed : [parsed]
  } catch (e) {
    return { list: [], others: [], error: (e as Error).message }
  }
  const bin = norm(path.win32.join(p.engine.dir, 'Engine', 'Binaries')) + '\\'
  const mine = norm(p.uproject)
  const list: BuildBlocker[] = []
  const others: string[] = []
  for (const x of procs) {
    if (/-Cmd(\.exe)?$/i.test(x.Name ?? '')) continue
    const exe = x.ExecutablePath || exeOf(x.CommandLine ?? '')
    if (exe && !norm(exe).startsWith(bin)) {
      others.push(`PID ${x.ProcessId} ${exe}`)
      continue
    }
    const proj = projectOf(x.CommandLine ?? '')
    list.push({
      pid: x.ProcessId,
      project: proj,
      same: !!proj && norm(proj) === mine,
      game: /(^|\s)-game\b/i.test(x.CommandLine ?? ''),
      ...(exe ? {} : { unknown: true }),
    })
  }
  return { list, others }
}

/**
 * 强制结束挡住编译的编辑器（网页「强制关掉编辑器并编译」，用户确认过未保存的改动会丢）。
 * 用 taskkill /T：Live Coding 控制台是编辑器的子进程，一起结束；结束后等进程真退出（DLL 才放开）再返回。
 * 编辑器是管理员权限打开、面板不是时 taskkill 会被拒绝，原样把系统的报错交给调用方。
 */
export async function killBlockers(list: BuildBlocker[]): Promise<{ failed: { pid: number; msg: string }[] }> {
  const failed: { pid: number; msg: string }[] = []
  for (const b of list) {
    const r = await run('taskkill.exe', ['/PID', String(b.pid), '/T', '/F'], { timeout: 15000 })
    // 进程已经自己退出了也算成功
    if (r.code !== 0 && alive(b.pid)) failed.push({ pid: b.pid, msg: (r.err || r.out).trim() || `exit ${r.code}` })
  }
  const wait = list.filter((b) => !failed.some((f) => f.pid === b.pid)).map((b) => b.pid)
  const until = Date.now() + 20000
  while (wait.some(alive) && Date.now() < until) await new Promise((r) => setTimeout(r, 300))
  for (const pid of wait.filter(alive)) failed.push({ pid, msg: t('结束后 20 秒还没退出') })
  return { failed }
}

/** 写进编译输出的说明：哪些进程挡着、怎么办 */
export function blockerLines(list: BuildBlocker[]) {
  const who = list
    .map((b) =>
      t('{kind} PID {pid}（{project}）', {
        kind: b.name ?? (b.game ? t('游戏') : t('编辑器')),
        pid: b.pid,
        project: b.unknown
          ? t('读不到路径，可能是管理员权限打开的')
          : b.project
            ? b.same
              ? t('本项目')
              : b.project
            : t('项目未知'),
      }),
    )
    .join('、')
  return [
    t('这个引擎的编辑器还开着：{who}', { who: who || t('未知进程') }),
    t('编辑器启用 Live Coding 时引擎拒绝在外面编译，就算关了 Live Coding，编辑器也占着插件的 DLL，编出来写不进去。'),
    t('先保存并关掉编辑器再编译；只改了已加载模块的代码时，也可以在编辑器里按 Ctrl+Alt+F11 用 Live Coding 编。'),
  ]
}
