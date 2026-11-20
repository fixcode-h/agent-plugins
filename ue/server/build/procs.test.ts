// 编译进程：认出这个引擎的 Build 脚本、分出面板跟踪的和残留的、结束、接着看（读 UBT 日志，进程退出后作业结束）。
// 用 node 起一个命令行里带引擎 Build.sh 路径的假进程代替 Build.bat（ps 查得到），只在非 Windows 上跑。
// 用法：node --test ue/server/build/procs.test.ts
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { getJob, newJob, spawnJob } from '../jobs.ts'
import type { UeProject } from '../types.ts'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { alive, setCtx } from '../util.ts'
import { buildProcs, killProcs, otherProcs } from './procs.ts'
import { watchBuild } from './watch.ts'

const skip = process.platform === 'win32'
setCtx({
  t: (zh: string, vars?: Record<string, string | number>) =>
    zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
} as unknown as PluginServerContext)

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ue-build-'))
  const engine = path.join(dir, 'UE_5.4')
  const script = path.join(engine, 'Engine', 'Build', 'BatchFiles', 'Linux', 'Build.sh')
  await mkdir(path.dirname(script), { recursive: true })
  const uproject = path.join(dir, 'Game', 'Game.uproject')
  await mkdir(path.dirname(uproject), { recursive: true })
  const p = {
    id: `t${Date.now()}`,
    root: path.dirname(uproject),
    uproject,
    engine: { dir: engine },
  } as unknown as UeProject
  return { dir, engine, script, uproject, p }
}

const fake = (script: string, uproject: string) =>
  spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)', script, 'GameEditor', `-Project=${uproject}`], {
    stdio: 'ignore',
  })

test('认出残留的编译，结束后就没了', { skip }, async () => {
  const { script, uproject, p, engine } = await setup()
  const child = fake(script, uproject)
  const other = fake(path.join(engine + 'X', 'Build.sh'), uproject) // 别的引擎，不算
  try {
    await new Promise((r) => setTimeout(r, 300))
    const { procs, error } = await buildProcs(p)
    assert.equal(error, undefined)
    assert.equal(procs.length, 1)
    assert.equal(procs[0]!.pid, child.pid)
    assert.equal(procs[0]!.kind, 'script')
    assert.equal(procs[0]!.same, true)
    assert.equal(procs[0]!.job, undefined)
    const { failed } = await killProcs(procs)
    assert.deepEqual(failed, [])
    assert.equal(alive(child.pid!), false)
  } finally {
    child.kill()
    other.kill()
  }
})

test('面板作业起的编译带上作业 id，不算挡着自己', { skip }, async () => {
  const { script, uproject, p } = await setup()
  const job = newJob(p.id, 'build', 'test')
  const done = spawnJob(
    job,
    process.execPath,
    ['-e', 'setTimeout(()=>{},60000)', script, `-Project=${uproject}`],
    p.root,
  )
  await new Promise((r) => setTimeout(r, 300))
  const { procs } = await buildProcs(p)
  assert.equal(procs.length, 1)
  assert.equal(procs[0]!.job, job.id)
  assert.equal(otherProcs(procs, job.id).length, 0)
  assert.equal(otherProcs(procs, 'other').length, 1)
  await killProcs(procs)
  await done
})

test('接着看：读 UBT 日志新增的部分，进程退出后按结果结束', { skip }, async () => {
  const { dir, script, uproject, p, engine } = await setup()
  const log = path.join(engine, 'Engine', 'Programs', 'UnrealBuildTool', 'Log.txt')
  await mkdir(path.dirname(log), { recursive: true })
  await writeFile(log, 'old line\n')
  const home = process.env.HOME
  process.env.HOME = dir // 别读到真的用户目录里的日志
  const child = fake(script, uproject)
  try {
    await new Promise((r) => setTimeout(r, 300))
    const { procs } = await buildProcs(p)
    const job = await watchBuild(p, procs)
    assert.equal(job.status, 'running')
    await appendFile(log, 'Compiling Foo.cpp\nResult: Succeeded\n')
    await new Promise((r) => setTimeout(r, 1500))
    child.kill()
    await new Promise((r) => setTimeout(r, 1800))
    const j = getJob(job.id)!
    assert.equal(j.status, 'done')
    assert.ok(j.log.includes('Compiling Foo.cpp'))
    assert.ok(!j.log.includes('old line'))
  } finally {
    child.kill()
    process.env.HOME = home
  }
})
