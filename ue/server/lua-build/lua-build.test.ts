// Lua 编译的报错认法和改过的文件（设计稿四.3）：用临时目录造脚本目录，跑一个假编译命令。
// 用法：node --test ue/server/lua-build/lua-build.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { OpCtx } from '../ops.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { changedFiles, moduleName } from './changes.ts'
import { compileErrorPattern } from './config.ts'
import { parseErrorLine } from './errors.ts'
import { startLuaBuild, waitBuild } from './run.ts'
import { setToolLauncher, type ToolBrief } from './launch.ts'

let root = ''
let data = ''
const pushed: { event: string; data: unknown }[] = []

const project = (luaBuild: Partial<UeProject['luaBuild']> = {}) =>
  ({
    id: 'p1',
    root,
    vcs: 'none',
    luaBuild: { scriptDir: 'Content/Script', autoReload: false, ...luaBuild },
  }) as unknown as UeProject

// 面板的项目工具（server/custom-tools/host）在单测里换成假的：命令里 {{filelist}} {{files}} 换成值，直接交给 sh
const fakeTools: (ToolBrief & { command: string })[] = []
const noted: { id: string; ok: boolean }[] = []
const brief = (id: string, command: string, params: string[] = [], errorPattern?: string) => ({
  id,
  name: id,
  summary: '',
  version: 1,
  params: params.map((name) => ({ name, label: '', type: 'string', required: false, desc: '' })),
  okExit: [0],
  command,
  ...(errorPattern ? { errorPattern } : {}),
})

before(async () => {
  setToolLauncher({
    list: async () => ({ tools: fakeTools, broken: [] }),
    spawn: async (_p, id, args) => {
      const tool = fakeTools.find((x) => x.id === id)!
      const line = tool.command.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => JSON.stringify(String(args[k] ?? '')))
      const child = spawn('sh', ['-c', line], { cwd: root })
      return { tool, line, cwd: root, checkout: '', child }
    },
    noteRun: (_p, id, r) => void noted.push({ id, ok: r.ok }),
  })
  root = await mkdtemp(path.join(tmpdir(), 'ue-luabuild-'))
  data = await mkdtemp(path.join(tmpdir(), 'ue-luabuild-data-'))
  await mkdir(path.join(root, 'Content/Script/UI'), { recursive: true })
  await writeFile(path.join(root, 'Content/Script/UI/BagPanel.lua'), 'return {}\n')
  await writeFile(path.join(root, 'Content/Script/Main.lua'), 'return {}\n')
  setCtx({
    dataDir: data,
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m)),
    pages: { push: (event: string, d: unknown) => (pushed.push({ event, data: d }), 1) },
    log: { info: () => undefined, warn: () => undefined },
  } as unknown as PluginServerContext)
})

after(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(data, { recursive: true, force: true })
})

test('模板格式：luac 前缀、Windows 盘符、列号', () => {
  const dirs = { root: '/r', cwd: '/r', scriptDir: '/r/Content/Script' }
  const re = compileErrorPattern('{file}:{line}: {message}')
  const e = parseErrorLine(re, "luac: UI/BagPanel.lua:91: 'end' expected near 'local'", dirs)
  assert.equal(e?.line, 91)
  assert.equal(e?.message, "'end' expected near 'local'")
  assert.match(e!.file, /UI\/BagPanel\.lua$/)
  const w = parseErrorLine(re, 'C:\\Proj\\Content\\Script\\a.lua:12: bad', dirs)
  assert.equal(w?.line, 12)
  assert.match(w!.file, /a\.lua$/)
  const col = parseErrorLine(compileErrorPattern('{file}({line},{col}): {message}'), 'x/y.lua(3,7): oops', dirs)
  assert.deepEqual([col?.line, col?.col, col?.message], [3, 7, 'oops'])
  assert.equal(parseErrorLine(re, '[1/3] UI/BagSlot.lua ... ok', dirs), undefined)
})

test('正则格式要有 file 和 line 分组，写错了保存时就报', () => {
  const re = compileErrorPattern('/^ERR (?<file>\\S+) line (?<line>\\d+) (?<message>.*)$/')
  const e = parseErrorLine(re, 'ERR a.lua line 5 boom', { root: '/r', cwd: '/r', scriptDir: '/r' })
  assert.deepEqual([e?.line, e?.message], [5, 'boom'])
  assert.throws(() => compileErrorPattern('/(?<file>x)/'), /file 和 line/)
  assert.throws(() => compileErrorPattern('{message}'), /\{file\}/)
  assert.throws(() => compileErrorPattern('/(/'), /正则写错了/)
})

test('模块名', () => {
  assert.equal(moduleName('UI/BagPanel.lua'), 'UI.BagPanel')
})

test('没编过不猜改过的文件；全编译成功后只列之后改的；失败认出 文件:行', async () => {
  const dir = path.join(root, 'Content/Script')
  const p0 = project()
  assert.equal((await changedFiles(p0, dir)).files.length, 0)
  assert.equal((await changedFiles(p0, dir)).baseline, null)

  fakeTools.push(
    brief('lua-full', 'node -e "process.exit(0)"'),
    brief('lua-inc', 'cat {{filelist}}', ['filelist']),
    brief('no-files', 'true'),
    brief(
      'lua-bad',
      'node -e "console.error(\'ERR UI/BagPanel.lua@9 unexpected symbol\'); process.exit(1)"',
      [],
      '^ERR (?<file>\\S+)@(?<line>\\d+) (?<msg>.*)$',
    ),
  )
  const p = project({ fullTool: 'lua-full', incrementalTool: 'lua-inc' })
  const ctx = { project: p, actor: { kind: 'user' } } as unknown as OpCtx
  await assert.rejects(
    startLuaBuild({ project: project(), actor: { kind: 'user' } } as unknown as OpCtx, 'full'),
    /还没选全编译/,
  )
  // 把现有文件的时间调到过去，全编译的时刻就晚于它们
  const old = new Date(Date.now() - 60000)
  for (const f of ['UI/BagPanel.lua', 'Main.lua']) await utimes(path.join(dir, f), old, old)
  const full = await startLuaBuild(ctx, 'full')
  const done = await waitBuild(p.id, full.id, 15000)
  assert.equal(done?.status, 'ok')
  assert.equal(done?.fileCount, 2)
  assert.equal((await changedFiles(p, dir)).files.length, 0)

  const later = new Date(Date.now() + 5000)
  await utimes(path.join(dir, 'UI/BagPanel.lua'), later, later)
  const ch = await changedFiles(p, dir)
  assert.deepEqual(
    ch.files.map((f) => f.path),
    ['UI/BagPanel.lua'],
  )

  const inc = await startLuaBuild(ctx, 'incremental')
  const r = await waitBuild(p.id, inc.id, 15000)
  assert.equal(r?.status, 'ok')
  assert.deepEqual(r?.files, ['UI/BagPanel.lua'])
  assert.equal(r?.tool?.id, 'lua-inc')
  // 列表文件放在 UE 项目的 Saved 下，工具把它 cat 出来
  assert.match(r!.command, /Saved\/AgentPanel\/lua-build\/.+\.files\.txt/)
  assert.match(await readFile(r!.logFile, 'utf8'), /UI\/BagPanel\.lua/)
  assert.equal((await changedFiles(p, dir)).files.length, 0)
  assert.deepEqual(noted.slice(-1), [{ id: 'lua-inc', ok: true }])

  // 增量编译的工具没有 filelist / files 参数：不知道编哪些，起之前就拦下
  await utimes(path.join(dir, 'Main.lua'), later, later)
  const nf = project({ incrementalTool: 'no-files' })
  await assert.rejects(
    startLuaBuild({ project: nf, actor: { kind: 'user' } } as unknown as OpCtx, 'incremental'),
    /没有 filelist 或 files 参数/,
  )
  await assert.rejects(
    startLuaBuild({ project: project({ fullTool: 'gone' }), actor: { kind: 'user' } } as unknown as OpCtx, 'full'),
    /没有 id 为 gone 的工具/,
  )

  // 工具自己写的报错格式（命名分组 msg）
  const bad = project({ fullTool: 'lua-bad' })
  const b = await startLuaBuild({ project: bad, actor: { kind: 'agent' } } as unknown as OpCtx, 'full')
  const br = await waitBuild(bad.id, b.id, 15000)
  assert.equal(br?.status, 'failed')
  assert.equal(br?.errors.length, 1)
  assert.equal(br?.errors[0].file, 'Content/Script/UI/BagPanel.lua')
  assert.equal(br?.errors[0].exists, true)
  assert.equal(br?.errors[0].message, 'unexpected symbol')
  assert.ok(pushed.some((x) => x.event === 'ue-lua-build'))
})
