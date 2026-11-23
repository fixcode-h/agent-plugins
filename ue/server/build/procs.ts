import path from 'node:path'
import { jobPids } from '../jobs.ts'
import type { BuildProc, UeProject } from '../types.ts'
import { alive, run, t } from '../util.ts'

/**
 * 找这个引擎正在跑的编译进程（Build.bat / Build.sh、UnrealBuildTool）。
 *
 * 为什么要找：Build.bat 带 -WaitMutex，同一个引擎同时只让一个 UBT 编，后来的输出
 * 「Build.bat is already running, waiting for existing script to terminate...」后一直等。
 * 面板升级插件、重启时，之前起的编译可能还在跑却没人跟踪（看不到输出，也取消不了），新的编译就被它挡死；
 * VS、命令行里起的编译也一样会挡。所以编译前、网页上都要看得到这些进程，并能接着看或结束。
 * 引擎按路径认：命令行里带这个引擎目录的才算（别的引擎的 UBT 不挡这个引擎）；没设引擎目录时全算上。
 */

interface Raw {
  pid: number
  ppid: number
  name: string
  cmd: string
}

const SCRIPT = /[\\/](Build|RunUBT)\.(bat|sh)\b/i
const UBT = /UnrealBuildTool/i

const norm = (s: string) => (process.platform === 'win32' ? s.replace(/\//g, '\\').toLowerCase() : s)

function projectOf(cmd: string) {
  const m = /-Project=\s*"?([^"]+?\.uproject)/i.exec(cmd) ?? /"([^"]+?\.uproject)"|(\S+?\.uproject)/i.exec(cmd)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

async function listWin(): Promise<{ list: Raw[]; error?: string }> {
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // 和 procs.ts 一样不用双引号、输出改 UTF-8（中文路径）
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter 'Name=''cmd.exe'' OR Name=''dotnet.exe'' OR Name LIKE ''UnrealBuildTool%''' | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    { timeout: 20000 },
  )
  if (r.code !== 0) return { list: [], error: (r.err || r.out).trim() || `exit ${r.code}` }
  try {
    const parsed = r.out.trim()
      ? (JSON.parse(r.out) as
          | { ProcessId: number; ParentProcessId: number; Name?: string; CommandLine?: string | null }
          | { ProcessId: number; ParentProcessId: number; Name?: string; CommandLine?: string | null }[])
      : []
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return {
      list: arr.map((x) => ({
        pid: x.ProcessId,
        ppid: x.ParentProcessId,
        name: x.Name ?? '',
        cmd: x.CommandLine ?? '',
      })),
    }
  } catch (e) {
    return { list: [], error: (e as Error).message }
  }
}

async function listPosix(): Promise<{ list: Raw[]; error?: string }> {
  const r = await run('ps', ['-eo', 'pid=,ppid=,args='], { timeout: 10000 })
  if (r.code !== 0) return { list: [], error: (r.err || r.out).trim() || `exit ${r.code}` }
  const list: Raw[] = []
  for (const line of r.out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m)
      list.push({ pid: Number(m[1]), ppid: Number(m[2]), name: path.basename(m[3]!.split(' ')[0] ?? ''), cmd: m[3]! })
  }
  return { list }
}

/**
 * 这个引擎的编译进程。job 有值的是面板这次运行里起的、还在跟踪的作业（从进程树往上找到作业的子进程）；
 * 其余的是残留：面板升级插件、重启前起的，或者在 VS、命令行里起的。
 * 查不了（没有 PowerShell、超时）时返回 error，调用方照常编译，把原因写进输出。
 */
export async function buildProcs(p: UeProject): Promise<{ procs: BuildProc[]; error?: string }> {
  const { list, error } = process.platform === 'win32' ? await listWin() : await listPosix()
  if (error) return { procs: [], error }
  // 带上结尾的分隔符：UE_5.4 不能把 UE_5.4X 下的编译也算进来
  const engine = p.engine.dir ? norm(path.resolve(p.engine.dir) + path.sep) : ''
  const mine = norm(p.uproject)
  const hits = list.filter((x) => {
    if (x.pid === process.pid) return false
    const isScript = SCRIPT.test(x.cmd)
    const isUbt = UBT.test(x.cmd) || UBT.test(x.name)
    if (!isScript && !isUbt) return false
    return !engine || norm(x.cmd).includes(engine)
  })
  const byPid = new Map(hits.map((x) => [x.pid, x]))
  const owned = jobPids()
  // 顺着父进程往上找：碰到跑着的作业的子进程就是面板起的（自定义编译命令的 cmd 不一定带 Build.bat，所以也看父 PID）
  const jobOf = (x: Raw) => {
    const seen = new Set<number>()
    for (let cur: Raw | undefined = x; cur && !seen.has(cur.pid); cur = byPid.get(cur.ppid)) {
      seen.add(cur.pid)
      if (owned.has(cur.pid)) return owned.get(cur.pid)
      if (owned.has(cur.ppid)) return owned.get(cur.ppid)
    }
    return undefined
  }
  const procs = hits.map((x): BuildProc => {
    const proj = projectOf(x.cmd)
    const job = jobOf(x)
    return {
      pid: x.pid,
      ppid: x.ppid,
      kind: SCRIPT.test(x.cmd) ? 'script' : 'ubt',
      project: proj,
      same: !!proj && norm(proj) === mine,
      ...(job ? { job } : {}),
      cmd: x.cmd.length > 300 ? `${x.cmd.slice(0, 300)}…` : x.cmd,
    }
  })
  return { procs }
}

/** 挡着这次编译的：除了 except（这次作业自己）以外的都算，包括残留的和面板别的项目正在跟踪的编译（同一个引擎同样排队） */
export const otherProcs = (procs: BuildProc[], except?: string) => procs.filter((x) => !x.job || x.job !== except)

/** 一组进程里的树根：父进程不在这组里的。结束树根连带子进程（Build.bat → dotnet UBT → cl / link / UBA） */
export const rootsOf = (procs: BuildProc[]) => procs.filter((x) => !procs.some((y) => y.pid === x.ppid))

/**
 * 结束编译进程（用户在网页上确认过：旧的编译做到一半的会白做）。
 * Windows 用 taskkill /T /F 结束整棵树；结束后等进程真退出（互斥量才放开）再返回。
 */
export async function killProcs(procs: BuildProc[]): Promise<{ failed: { pid: number; msg: string }[] }> {
  // 结束整棵树并等它真的退出：走面板的外部进程入口（ADR 0076）
  const { stopTree } = await import('@panel/server/exec/tracked')
  const stop = async (list: BuildProc[]) =>
    (await Promise.all(list.map(async (b) => ({ pid: b.pid, r: await stopTree(b.pid) }))))
      .filter((x) => !x.r.ok)
      .map((x) => ({ pid: x.pid, msg: x.r.error ?? '' }))
  const roots = rootsOf(procs)
  const failed = await stop(roots)
  // 树根结束了，子进程在 POSIX 上不一定跟着走：还活着的也结束掉
  failed.push(...(await stop(procs.filter((b) => !roots.includes(b) && alive(b.pid)))))
  return { failed }
}

/** 写进编译输出的进程清单 */
export const procLines = (procs: BuildProc[]) =>
  procs.map((x) =>
    t('{kind} PID {pid}（{project}）', {
      kind: x.kind === 'script' ? 'Build.bat' : 'UnrealBuildTool',
      pid: x.pid,
      project: x.project ? (x.same ? t('本项目') : x.project) : t('项目未知'),
    }),
  )
