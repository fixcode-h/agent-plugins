import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { findEngine, findUproject } from '../engine-locate.ts'

/**
 * 测试步骤「蓝图编译」的脚本（清单 testSteps 的 compile-bp，构建时打成包里的 bin/bp-compile.mjs）：
 *   node "{dir}/bin/bp-compile.mjs" --data "{data}"
 * 在项目根（或 --project 给的目录）找 .uproject，按项目找引擎（--engine > UE 页登记的引擎目录 > EngineAssociation），
 * 用 UnrealEditor-Cmd 跑 CompileAllBlueprints 编译项目里全部蓝图，有编译错误时退出码非 0。
 * 编辑器开着也能跑（另起一个不开窗口的进程，读的是磁盘上已保存的版本）；要几分钟，所以只在改了 .uasset、
 * 又没用 ue_compile 逐个确认过时才跑。完整输出写进项目的 Saved/AgentPanel/bp-compile.log，屏幕上只给错误和结论。
 * 这个脚本独立运行（不在面板进程里），说明文字直接写中文：读的人是 Agent 和看测试输出的用户
 */

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? '') : ''
}

/** 屏幕上最多列这么多行错误，其余看日志文件 */
const MAX_LINES = 60

function fail(msg: string, code = 2): never {
  console.error(msg)
  process.exit(code)
}

/** UE 页登记过这个项目时用登记的引擎（用户手填的引擎目录优先）：插件数据目录 projects/*.json */
async function registeredEngine(data: string, uproject: string) {
  if (!data) return ''
  const dir = path.join(data, 'projects')
  const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!n.endsWith('.json')) continue
    try {
      const p = JSON.parse(await readFile(path.join(dir, n), 'utf8')) as {
        uproject?: string
        engineDir?: string
        engine?: { dir?: string }
      }
      if (!p.uproject || !same(p.uproject, uproject)) continue
      return p.engineDir || p.engine?.dir || ''
    } catch {
      // 坏掉的登记文件：当作没登记，接着按 EngineAssociation 找
    }
  }
  return ''
}

function editorCmd(engineDir: string) {
  const bin = path.join(engineDir, 'Engine', 'Binaries')
  if (process.platform === 'win32') return path.join(bin, 'Win64', 'UnrealEditor-Cmd.exe')
  if (process.platform === 'darwin')
    return path.join(bin, 'Mac', 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor')
  return path.join(bin, 'Linux', 'UnrealEditor')
}

/** 要给人看的行：编译错误、蓝图相关的警告和结尾的汇总；引擎启动时一大片无关的日志不列 */
const ERROR_RE = /: Error: |\[Compiler\].*\berror\b|failed to (?:compile|load)/i
const SUMMARY_RE = /CompileAllBlueprints|Compil(?:ed|ing) .*Blueprint|Blueprints? (?:with|that)/i

async function main() {
  const root = path.resolve(arg('project') || process.cwd())
  const uproject = await findUproject(root)
  if (!uproject) fail(`没在 ${root} 里找到 .uproject：在 UE 项目根目录跑，或者用 --project 指定目录。`)
  const desc = JSON.parse(await readFile(uproject, 'utf8').catch(() => '{}')) as { EngineAssociation?: string }
  const custom = arg('engine') || (await registeredEngine(arg('data'), uproject))
  const engine = await findEngine(uproject, desc.EngineAssociation ?? '', custom)
  if (!engine.dir)
    fail(
      `没找到这个项目用的引擎（EngineAssociation：${desc.EngineAssociation || '-'}）：在面板 UE 页「权限与设置」里手动指定引擎目录，或者用 --engine 指定。`,
    )
  const exe = editorCmd(engine.dir)
  if (!existsSync(exe)) fail(`引擎目录里没有 ${exe}：引擎没编译过编辑器，或者引擎目录不对。`)

  const logDir = path.join(path.dirname(uproject), 'Saved', 'AgentPanel')
  mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, 'bp-compile.log')
  const log = createWriteStream(logFile)
  console.log(`编译 ${path.basename(uproject)} 的全部蓝图（UE ${engine.version || '?'}，要几分钟）…`)

  const shown: string[] = []
  let errors = 0
  const summary: string[] = []
  let rest = ''
  const onData = (buf: Buffer) => {
    log.write(buf)
    const lines = (rest + buf.toString('utf8')).split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) {
      if (ERROR_RE.test(line)) {
        errors++
        if (shown.length < MAX_LINES) shown.push(line.trim())
      } else if (SUMMARY_RE.test(line)) summary.push(line.trim())
    }
  }
  const code = await new Promise<number>((resolve) => {
    const p = spawn(
      exe,
      [
        uproject,
        '-run=CompileAllBlueprints',
        '-unattended',
        '-nopause',
        '-nosplash',
        '-nullrhi',
        '-nosound',
        '-stdout',
        '-FullStdOutLogOutput',
        '-utf8output',
      ],
      { cwd: path.dirname(uproject), windowsHide: true },
    )
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
    p.on('error', (e) => {
      console.error(`起不来 ${exe}：${e.message}`)
      resolve(2)
    })
    p.on('close', (c) => resolve(c ?? 1))
  })
  log.end()

  for (const line of shown) console.log(line)
  if (errors > shown.length) console.log(`……还有 ${errors - shown.length} 行，见日志`)
  for (const line of summary.slice(-6)) console.log(line)
  console.log(`完整输出：${logFile}`)
  // 通过没有只看退出码：CompileAllBlueprints 有加载失败、编译错误时退出码非 0。上面列的错误行只是线索——
  // 项目启动时和蓝图无关的报错（缺资源、插件警告）也会出现在里面，按它判就永远过不了
  if (code !== 0) {
    console.log(`蓝图编译没通过（退出码 ${code}）：按上面的蓝图和错误修，编辑器开着时可以用 ue_compile 逐个确认。`)
    process.exit(code)
  }
  console.log('蓝图编译通过。')
}

main().catch((e: Error) => fail(`蓝图编译脚本出错：${e.message}`))
