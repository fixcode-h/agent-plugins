// VS 调试控制：管道客户端（假服务端用 unix socket 代替 Windows 命名管道）、发现文件和解决方案查找、vswhere 输出解析。
// 用法：node --test ue/server/vs-debug/vs-debug.test.ts（Node 22 直接跑 .ts，不需要 VS 和 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { breakMessage, vsBreakNote } from './break-note.ts'
import { pipeCall, pipeOne } from './client.ts'
import { readTimeoutFor, setPipeOverride, vsCall } from './connect.ts'
import { ENDPOINT_REL, findEndpoint, findSolution } from './discover.ts'
import { isKnownOp, type Endpoint } from './protocol.ts'
import { vsDebugState } from './state.ts'
import { parseVswhere } from './vswhere.ts'

let base = ''
const servers: net.Server[] = []

type Handler = (req: { id: string; op: string; token: string; args: Record<string, unknown> }) => unknown

/** 假的 UEToVS：一行一个请求，handler 返回 undefined 时不回（测超时） */
async function fakeVs(name: string, handler: Handler) {
  const file = path.join(base, `${name}.sock`)
  const srv = net.createServer((sock) => {
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', (c: string) => {
      buf += c
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        const res = handler(req)
        if (res !== undefined) sock.write(JSON.stringify({ id: req.id, ...(res as object) }) + '\n')
      }
    })
    sock.on('error', () => {})
  })
  await new Promise<void>((r) => srv.listen(file, r))
  servers.push(srv)
  return file
}

const ep = (pipe: string, extra: Partial<Endpoint> = {}): Endpoint => ({ protocol: 1, pipe, token: 'tok', ...extra })

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-vsdebug-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

after(() => {
  setPipeOverride(undefined)
  for (const s of servers) s.close()
})

test('一个连接上连发两个请求，按 id 对上应答，带令牌和协议版本', async () => {
  const seen: unknown[] = []
  const sock = await fakeVs('two', (req) => {
    seen.push(req)
    return req.op === 'status' ? { ok: true, result: { mode: 'run' } } : { ok: false, error: '没有在调试' }
  })
  const [a, b] = await pipeCall(ep('two'), [{ op: 'status', args: { frames: 5 } }, { op: 'stack' }], { pipePath: sock })
  assert.deepEqual(a, { ok: true, result: { mode: 'run' } })
  assert.deepEqual(b, { ok: false, error: '没有在调试' })
  const first = seen[0] as Record<string, unknown>
  assert.equal(first.v, 1)
  assert.equal(first.token, 'tok')
  assert.deepEqual(first.args, { frames: 5 })
  // 失败的应答 pipeOne 原样抛 VS 的中文原因
  await assert.rejects(pipeOne(ep('two'), 'stack', {}, { pipePath: sock }), /没有在调试/)
})

test('读超时：VS 不回时按 readTimeoutMs 报错，说明去 VS 看一眼', async () => {
  const sock = await fakeVs('silent', () => undefined)
  const t0 = Date.now()
  await assert.rejects(pipeOne(ep('silent'), 'wait', {}, { pipePath: sock, readTimeoutMs: 200 }), (e: Error) => {
    assert.match(e.message, /没有回应（wait）/)
    return true
  })
  assert.ok(Date.now() - t0 < 2000)
})

test('连不上：说明怎么打开（开 VS、装 0.8.0、打开设置），reason=connect-failed', async () => {
  await assert.rejects(pipeOne(ep('none'), 'status', {}, { pipePath: path.join(base, 'nope.sock') }), (e: Error) => {
    assert.equal((e as { reason?: string }).reason, 'connect-failed')
    assert.match(e.message, /UEToVS 0\.8\.0/)
    assert.match(e.message, /允许 Agent 通过 VS 调试 UE/)
    return true
  })
})

test('协议版本不对直接报错，不去连', async () => {
  await assert.rejects(pipeOne(ep('x', { protocol: 2 }), 'status'), (e: Error) => {
    assert.equal((e as { reason?: string }).reason, 'protocol')
    return true
  })
})

test('会阻塞的 op 读超时 = 等待时间 + 5 秒；dump 给 2 分钟；其余 15 秒', () => {
  assert.equal(readTimeoutFor('wait', {}), 35000)
  assert.equal(readTimeoutFor('wait', { timeoutMs: 60000 }), 65000)
  assert.equal(readTimeoutFor('wait', { timeoutMs: 999999 }), 125000)
  assert.equal(readTimeoutFor('step', {}), 15000)
  assert.equal(readTimeoutFor('continue', { waitMs: 20000 }), 25000)
  assert.equal(readTimeoutFor('status', {}), 15000)
  assert.equal(readTimeoutFor('dump', { full: true }), 120000)
  assert.ok(isKnownOp('bp.add') && isKnownOp('dump') && !isKnownOp('subscribe') && !isKnownOp('rm'))
})

/** 项目在 <base>/<name>/Game，外层 <base>/<name> 也可能放 .sln */
async function project(name: string) {
  const outer = path.join(base, name)
  const root = path.join(outer, 'Game')
  await mkdir(root, { recursive: true })
  return {
    id: name,
    root,
    uproject: path.join(root, 'Game.uproject'),
    uname: 'Game',
    engineDir: '',
    engine: { dir: '' },
  } as unknown as UeProject
}

async function writeEndpoint(dir: string, e: Partial<Endpoint>) {
  await mkdir(path.join(dir, path.dirname(ENDPOINT_REL)), { recursive: true })
  await writeFile(path.join(dir, ENDPOINT_REL), JSON.stringify({ protocol: 1, token: 'tok', ...e }))
}

test('解决方案：项目目录里同名的优先，项目目录没有再找外层', async () => {
  const p = await project('sln')
  assert.equal(await findSolution(p), undefined)
  await writeFile(path.join(path.dirname(p.root), 'All.sln'), '')
  assert.equal(await findSolution(p), path.join(path.dirname(p.root), 'All.sln'))
  await writeFile(path.join(p.root, 'Aaa.sln'), '')
  await writeFile(path.join(p.root, 'Game.sln'), '')
  assert.equal(await findSolution(p), path.join(p.root, 'Game.sln'))
})

test('发现文件：写着这个 .uproject 的优先，缺字段的不算', async () => {
  const p = await project('ep')
  assert.equal(await findEndpoint(p), undefined)
  await writeEndpoint(p.root, { pipe: 'inner' })
  await writeEndpoint(path.dirname(p.root), { pipe: 'outer', project: p.uproject })
  assert.equal((await findEndpoint(p))?.endpoint.pipe, 'outer')
  await writeEndpoint(path.dirname(p.root), { project: p.uproject })
  assert.equal((await findEndpoint(p))?.endpoint.pipe, 'inner')
})

test('按项目调用、网页状态和「停在断点」的提示', async () => {
  const p = await project('state')
  await writeFile(path.join(p.root, 'Game.sln'), '')
  setPipeOverride((pipe) => path.join(base, `${pipe}.sock`))
  // 没有发现文件：卡片显示 VS 没开，带上找到的 .sln
  let s = await vsDebugState(p)
  assert.equal(s?.available, false)
  assert.equal(s?.reason, 'no-vs')
  assert.equal(s?.solution, path.join(p.root, 'Game.sln'))
  await assert.rejects(vsCall(p, 'status'), /调试控制没开/)

  const status = {
    mode: 'break',
    building: false,
    location: { function: 'AHero::Jump', file: 'D:\\Proj\\Source\\Hero.cpp', line: 42 },
  }
  await fakeVs('state-vs', (req) =>
    req.op === 'bp.list'
      ? { ok: true, result: { items: [{ i: 1, file: 'Hero.cpp', line: 42, enabled: true }] } }
      : { ok: true, result: status },
  )
  await writeEndpoint(p.root, { pipe: 'state-vs', project: p.uproject })
  s = await vsDebugState(p)
  assert.equal(s?.available, true)
  assert.equal(s?.status?.mode, 'break')
  assert.equal(s?.breakpoints?.[0].line, 42)
  assert.deepEqual(await vsCall(p, 'status'), status)
  assert.equal(
    await vsBreakNote(p.root, p.uproject),
    'UE 停在 VS 断点 Hero.cpp:42（AHero::Jump），先 ue_vs_debug action=continue 继续',
  )
  assert.equal(breakMessage({ mode: 'run' }), undefined)
  setPipeOverride(undefined)
})

test('网页状态 1.5 秒内拿不到就返回不可用，不拖慢刷新', async () => {
  const p = await project('slow')
  await writeFile(path.join(p.root, 'Game.sln'), '')
  setPipeOverride((pipe) => path.join(base, `${pipe}.sock`))
  await fakeVs('slow-vs', () => undefined)
  await writeEndpoint(p.root, { pipe: 'slow-vs' })
  const t0 = Date.now()
  const s = await vsDebugState(p)
  assert.ok(Date.now() - t0 < 2500)
  assert.equal(s?.available, false)
  assert.ok(s?.message)
  // 没回应后先别追着问：10 秒内直接说 VS 正忙，不再连管道（免得请求在 VS 里越积越多）
  const t1 = Date.now()
  const again = await vsDebugState(p)
  assert.ok(Date.now() - t1 < 500)
  assert.match(again?.message ?? '', /VS 正忙/)
  // 停在断点的提示只是补充：VS 不回时返回空，不另报错
  assert.equal(await vsBreakNote(p.root), undefined)
  setPipeOverride(undefined)
})

test('vswhere 输出：取第一个 devenv.exe，没有返回空', () => {
  assert.equal(
    parseVswhere(
      '\r\nC:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe\r\nD:\\VS\\devenv.exe\r\n',
    ),
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe',
  )
  assert.equal(parseVswhere(''), undefined)
  assert.equal(parseVswhere('C:\\BuildTools\\MSBuild.exe'), undefined)
})

test('运行中改了断点：下一次刷新重取列表，总数 0 时不再挂着旧列表', async () => {
  const p = await project('running-bp')
  await writeFile(path.join(p.root, 'Game.sln'), '')
  setPipeOverride((pipe) => path.join(base, `${pipe}.sock`))
  let items = [
    { i: 1, file: 'A.cpp', line: 1, enabled: true, byAgent: true },
    { i: 2, file: 'B.cpp', line: 2, enabled: true, byAgent: true },
  ]
  const ops: string[] = []
  await fakeVs('running-vs', (req) => {
    ops.push(req.op)
    if (req.op === 'bp.list') return { ok: true, result: { items } }
    if (req.op === 'bp.clear') {
      items = []
      return { ok: true, result: { removed: 2 } }
    }
    return { ok: true, result: { mode: 'run', building: false, breakpoints: items.length } }
  })
  await writeEndpoint(p.root, { pipe: 'running-vs', project: p.uproject })
  // 第一次刷新拿到列表；之后在跑，只问 status
  assert.equal((await vsDebugState(p))?.breakpoints?.length, 2)
  ops.length = 0
  assert.equal((await vsDebugState(p))?.breakpoints?.length, 2)
  assert.deepEqual(ops, ['status'])
  // 网页点「清掉 Agent 下的」：下一次刷新哪怕在跑也重取列表
  await vsCall(p, 'bp.clear', { scope: 'agent' })
  ops.length = 0
  assert.deepEqual((await vsDebugState(p))?.breakpoints, [])
  assert.deepEqual(ops, ['status', 'bp.list'])
  setPipeOverride(undefined)
})

test('运行中在 VS 里删了断点：status 总数为 0 直接清空缓存的列表', async () => {
  const p = await project('running-bp-vs')
  await writeFile(path.join(p.root, 'Game.sln'), '')
  setPipeOverride((pipe) => path.join(base, `${pipe}.sock`))
  let items = [{ i: 1, file: 'A.cpp', line: 1, enabled: true }]
  let first = true
  await fakeVs('running-vs2', (req) => {
    if (req.op === 'bp.list') return { ok: true, result: { items } }
    const r = { ok: true, result: { mode: 'run', building: false, breakpoints: first ? 1 : 0 } }
    first = false
    return r
  })
  await writeEndpoint(p.root, { pipe: 'running-vs2', project: p.uproject })
  assert.equal((await vsDebugState(p))?.breakpoints?.length, 1)
  items = []
  assert.deepEqual((await vsDebugState(p))?.breakpoints, [])
  setPipeOverride(undefined)
})
