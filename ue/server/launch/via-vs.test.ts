// 「启动编辑器」经 VS 启动：探 VS、F5 参数、启动后问 VS 状态认编译 / 起来 / 退出。
// 用法：node --test ue/server/launch/via-vs.test.ts（假 UEToVS 用 unix socket 代替命名管道，不需要 VS 和 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { UeProject, VsDebugStatus } from '../types.ts'
import { setCtx } from '../util.ts'
import { setPipeOverride } from '../vs-debug/connect.ts'
import { ENDPOINT_REL } from '../vs-debug/discover.ts'
import { startViaVs, vsLaunchable, vsStartArgs } from './via-vs.ts'

let base = ''
let config: Record<string, unknown> = {}
const servers: net.Server[] = []
/** 假 VS 每次 status 回的状态（按顺序取，取完停在最后一个） */
let statuses: Partial<VsDebugStatus>[] = []
const started: unknown[] = []

async function fakeVs(file: string) {
  const srv = net.createServer((sock) => {
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', (c: string) => {
      buf += c
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        let result: unknown
        if (req.op === 'start') {
          started.push(req.args)
          result = { started: true }
        } else result = statuses.length > 1 ? statuses.shift() : statuses[0]
        sock.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n')
      }
    })
    sock.on('error', () => {})
  })
  await new Promise<void>((r) => srv.listen(file, r))
  servers.push(srv)
}

async function project(name: string, endpointProject?: string): Promise<UeProject> {
  const root = path.join(base, name)
  await mkdir(path.join(root, path.dirname(ENDPOINT_REL)), { recursive: true })
  const uproject = path.join(root, `${name}.uproject`)
  await writeFile(
    path.join(root, ENDPOINT_REL),
    JSON.stringify({ protocol: 1, pipe: name, token: 'tok', project: endpointProject ?? uproject }),
  )
  await fakeVs(path.join(base, `${name}.sock`))
  return { id: name, name, root, uproject, uname: name, engine: { dir: path.join(base, 'engine') } } as UeProject
}

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-viavs-'))
  setPipeOverride((pipe) => path.join(base, `${pipe}.sock`))
  setCtx({
    dataDir: path.join(base, 'data'),
    config: () => config,
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

after(() => {
  setPipeOverride(undefined)
  for (const s of servers) s.close()
})

test('F5 参数：不是编辑器配置、启动项目不对时改对，对的不动', () => {
  const p = { uname: 'Game' } as UeProject
  assert.deepEqual(
    vsStartArgs(p, {
      mode: 'design',
      building: false,
      configuration: 'Development Editor|Win64',
      startupProject: 'Game',
    }),
    {},
  )
  assert.deepEqual(
    vsStartArgs(p, { mode: 'design', building: false, configuration: 'Shipping|Win64', startupProject: 'UE5' }),
    {
      configuration: 'Development Editor',
      project: 'Game',
    },
  )
})

test('VS 开着本项目且空闲才经 VS 启动；在编译、在调试时报错；设置成直接启动、开的是别的项目时不经 VS', async () => {
  const p = await project('Probe')
  statuses = [{ mode: 'design', building: false }]
  assert.equal((await vsLaunchable(p))?.mode, 'design')
  statuses = [{ mode: 'design', building: true }]
  await assert.rejects(vsLaunchable(p), /VS 正在编译/)
  statuses = [{ mode: 'run', building: false, processes: [{ pid: 42, name: 'UnrealEditor.exe' }] }]
  await assert.rejects(vsLaunchable(p), /PID 42/)
  config = { launchVia: 'direct' }
  statuses = [{ mode: 'design', building: false }]
  assert.equal(await vsLaunchable(p), undefined)
  config = {}
  const other = await project('Other', path.join(base, 'Else', 'Else.uproject'))
  assert.equal(await vsLaunchable(other), undefined)
  // 没有发现文件（没装 UEToVS / VS 没开）
  assert.equal(await vsLaunchable({ ...p, root: path.join(base, 'nothing') }), undefined)
})

test('启动后：编译中 → 起了编辑器带 PID → VS 回到空闲算编辑器退出', async () => {
  const p = await project('Run')
  statuses = [{ mode: 'design', building: false, configuration: 'Development Editor|Win64', startupProject: 'Run' }]
  const src = await startViaVs(p, statuses[0] as VsDebugStatus)
  assert.equal(src.via, 'vs')
  assert.deepEqual(started.at(-1), {})
  statuses = [
    { mode: 'design', building: true },
    { mode: 'design', building: false, launchPending: true },
    { mode: 'run', building: false, processes: [{ pid: 7, name: 'UnrealEditor.exe' }] },
    { mode: 'design', building: false },
  ]
  assert.deepEqual(await src.poll!(), { building: true })
  assert.deepEqual(await src.poll!(), { pid: undefined })
  assert.deepEqual(await src.poll!(), { pid: 7 })
  assert.deepEqual(await src.poll!(), {})
  assert.deepEqual(await src.poll!(), {})
  assert.match((await src.poll!()).failed ?? '', /退出了（PID 7）/)
})

test('编译失败、VS 没起编辑器时报编译失败', async () => {
  const p = await project('Fail')
  const src = await startViaVs(p, { mode: 'design', building: false })
  statuses = [
    { mode: 'design', building: true },
    { mode: 'design', building: false, lastBuildFailed: true },
  ]
  await src.poll!()
  await src.poll!()
  await src.poll!()
  assert.match((await src.poll!()).failed ?? '', /编译失败/)
})
