// 「用 VS 打开这个项目」：分清 VS 没开 / 开着别的项目 / 开着这个项目但没调试控制，在别的 VS 里换解决方案后自动连上。
// 用法：node --test ue/server/vs-debug/open-vs.test.ts（Node 22 直接跑 .ts，假 VS 用 unix socket 代替命名管道）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { endpointOf, setPipeOverride } from './connect.ts'
import { ENDPOINT_REL, findEndpoint } from './discover.ts'
import { listVsInstances, parseTasklist, setRegistryDir, titleIsSolution } from './instances.ts'
import { openVs } from './open-vs.ts'
import type { Endpoint } from './protocol.ts'
import { vsDebugState } from './state.ts'

let base = ''
let registry = ''
const servers: net.Server[] = []
/** 一个肯定不在的 PID（最大 PID 远小于它） */
const DEAD_PID = 2 ** 30

async function fakeVs(name: string, handler: (req: { op: string; args: Record<string, unknown> }) => unknown) {
  const file = path.join(base, `${name}.sock`)
  const srv = net.createServer((sock) => {
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', async (c: string) => {
      buf += c
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        const res = await handler(req)
        sock.write(JSON.stringify({ id: req.id, ...(res as object) }) + '\n')
      }
    })
    sock.on('error', () => {})
  })
  await new Promise<void>((r) => srv.listen(file, r))
  servers.push(srv)
}

async function project(name: string) {
  const root = path.join(base, name, 'Game')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'Game.sln'), '')
  return {
    id: name,
    root,
    uproject: path.join(root, 'Game.uproject'),
    uname: 'Game',
    engineDir: '',
    engine: { dir: '' },
  } as unknown as UeProject
}

const endpointJson = (e: Partial<Endpoint>) => JSON.stringify({ protocol: 1, token: 'tok', ...e })

async function writeEndpoint(dir: string, e: Partial<Endpoint>) {
  await mkdir(path.join(dir, path.dirname(ENDPOINT_REL)), { recursive: true })
  await writeFile(path.join(dir, ENDPOINT_REL), endpointJson(e))
}

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-openvs-'))
  registry = path.join(base, 'instances')
  await mkdir(registry, { recursive: true })
  setRegistryDir(registry)
  setPipeOverride((pipe) => path.join(base, `${pipe}.sock`))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

after(() => {
  setPipeOverride(undefined)
  setRegistryDir(undefined)
  for (const s of servers) s.close()
})

test('tasklist 的 CSV：按位置取 PID 和窗口标题，别的进程、没有标题的不算', () => {
  const text = [
    '"devenv.exe","18244","Console","1","812,004 K","Running","PC\\me","0:01:02","Tools - Microsoft Visual Studio"',
    '"devenv.exe","20000","Console","1","10,004 K","Unknown","PC\\me","0:00:01","N/A"',
    '"notepad.exe","1","Console","1","1 K","Running","PC\\me","0:00:00","Game - Microsoft Visual Studio"',
  ].join('\r\n')
  assert.deepEqual(parseTasklist(text), [{ pid: 18244, title: 'Tools - Microsoft Visual Studio' }])
})

test('窗口标题认解决方案：允许「(管理员)」之类的括号，名字要整段对上', () => {
  assert.ok(titleIsSolution('Game - Microsoft Visual Studio', 'D:\\P\\Game.sln'))
  assert.ok(titleIsSolution('Game (Administrator) - Microsoft Visual Studio', 'D:/P/Game.sln'))
  assert.ok(!titleIsSolution('GameTools - Microsoft Visual Studio', 'D:/P/Game.sln'))
  assert.ok(!titleIsSolution('Microsoft Visual Studio', 'D:/P/Game.sln'))
})

test('PID 已经不在的发现文件不算：卡片不再报「连不上管道」，而是 VS 没开', async () => {
  const p = await project('stale')
  await writeEndpoint(p.root, { pipe: 'stale-vs', pid: DEAD_PID, project: p.uproject })
  assert.equal(await findEndpoint(p), undefined)
  const s = await vsDebugState(p)
  assert.equal(s?.reason, 'no-vs')
  assert.equal(s?.message, 'VS 没打开这个项目（Game.sln）')
  assert.equal(s?.others, undefined)
})

test('外层目录的发现文件是别的项目的 VS：不拿它调试这个项目', async () => {
  const p = await project('outer')
  await writeEndpoint(path.dirname(p.root), {
    pipe: 'outer-vs',
    project: path.join(base, 'Other', 'Other.uproject'),
    solution: path.join(base, 'Other', 'Other.sln'),
  })
  await assert.rejects(endpointOf(p), /VS 开着的是别的项目/)
})

test('VS 开着别的项目：状态里列出来，选在那个 VS 里打开，换完自动连上', async () => {
  const p = await project('switch')
  const solution = path.join(p.root, 'Game.sln')
  const seen: { op: string; args: Record<string, unknown> }[] = []
  // 我们自己（process.pid）当作开着 Tools.sln 的 VS：收到 solution.open 后由「新解决方案」写出发现文件
  await fakeVs('tools-vs', async (req) => {
    seen.push(req)
    if (req.op !== 'solution.open') return { ok: false, error: '没有这个操作' }
    await writeEndpoint(p.root, { pipe: 'game-vs', pid: process.pid, project: p.uproject, solution })
    return { ok: true, result: { switching: true } }
  })
  await fakeVs('game-vs', () => ({ ok: true, result: { mode: 'design', building: false } }))
  const tools = path.join(base, 'Tools', 'Tools.sln')
  await writeFile(
    path.join(registry, `${process.pid}.json`),
    endpointJson({ pipe: 'tools-vs', pid: process.pid, solution: tools }),
  )
  await writeFile(
    path.join(registry, `${DEAD_PID}.json`),
    endpointJson({ pipe: 'dead', pid: DEAD_PID, solution: tools }),
  )
  assert.deepEqual(
    (await listVsInstances()).map((i) => i.pid),
    [process.pid],
  )

  let s = await vsDebugState(p)
  assert.equal(s?.reason, 'no-vs')
  assert.equal(s?.message, 'VS 没打开这个项目（Game.sln），开着的 VS 里是别的项目')
  assert.deepEqual(s?.others, [{ pid: process.pid, solution: tools }])

  const r = await openVs(p, { into: process.pid })
  assert.equal(r.opened, true)
  assert.deepEqual(seen[0], { ...seen[0], op: 'solution.open', args: { path: solution } })
  s = await vsDebugState(p)
  assert.equal(s?.available, true)
})

test('在别的 VS 里打开时那个 VS 已经关了：说清楚，让用户重选', async () => {
  const p = await project('gone')
  await assert.rejects(openVs(p, { into: DEAD_PID }), /那个 VS 已经关了/)
})
