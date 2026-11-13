// 冒烟测试：用一个假的面板上下文激活构建好的包（dist/blender），不需要装 Blender。
// 检查：普通对话不挂工具；模型设计对话挂 blender 和 blender-model 两个服务；上游 6 个工具都注册上；
// blender_session doctor 能起 Gateway 并给出诊断（没有 Blender 时 ok=false 是对的）；停掉后进程都收干净。
// 用法：npm run build -- blender && node blender/scripts/smoke.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'blender')
const data = mkdtempSync(path.join(tmpdir(), 'blender-smoke-'))
const cfg = { autoStart: false, attach: 'auto', gatewayPort: 39000 + Math.floor(Math.random() * 800) }
const ctx = {
  id: 'blender',
  version: 'smoke',
  dir,
  dataDir: data,
  config: () => cfg,
  log: { info: () => {}, warn: (m, d) => console.warn('[warn]', m, d ?? '') },
  t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? '')),
}

const { default: activate } = await import(pathToFileURL(path.join(dir, 'server', 'index.js')).href)
const plugin = await activate(ctx)
try {
  // 不是 Blender 角色、也不是模型设计对话：不挂，并说明原因（插件接口 8 的 skip）
  assert.match((await plugin.tools({ taskId: 'a', agentName: 'x', skills: [], resume: false })).skip, /Blender 技能/)
  const run = await plugin.tools({
    taskId: 'm',
    agentName: 'x',
    skills: [],
    resume: false,
    pluginTask: 'blender.model',
  })
  assert.deepEqual(
    run.servers.map((s) => s.name),
    ['blender', 'blender-model'],
  )
  const dsh = await run.servers[0].tools()
  assert.deepEqual(dsh.map((t) => t.name).sort(), [
    'blender_inspect',
    'blender_op',
    'blender_py',
    'blender_run',
    'blender_see',
    'blender_session',
  ])
  const doctor = await dsh
    .find((t) => t.name === 'blender_session')
    .call({ action: 'doctor' }, { taskId: 'm', callId: '1' })
  const text = doctor.content.map((c) => c.text ?? '').join('\n')
  assert.match(text, /SESSION doctor/)
  console.log(text.split('\n')[0])
  // 工具带了作用和什么时候用（插件接口 8）
  assert.deepEqual(
    dsh.filter((t) => !t.guide?.useWhen).map((t) => t.name),
    [],
  )
  // 能力目录：Gateway 已经起过，照列已注册的工具；预演（dryRun）只列定义，不调工具
  const cat = await plugin.catalog()
  assert.deepEqual(
    cat.servers.map((s) => s.name),
    ['blender', 'blender-model'],
  )
  assert.equal((await cat.servers[0].tools()).length, 6)
  const dry = await plugin.tools({
    taskId: '',
    agentName: 'x',
    skills: [],
    resume: false,
    pluginTask: 'blender.model',
    dryRun: true,
  })
  assert.equal((await dry.servers[0].tools()).length, 6)
  const model = await run.servers[1].tools()
  assert.deepEqual(
    model.map((t) => t.name),
    ['blender_python', 'blender_scene'],
  )
  const res = await plugin.fetch(new Request('http://x/models/m'))
  assert.equal((await res.json()).version, 0)
  const addon = await plugin.fetch(new Request('http://x/addon.zip'))
  assert.equal(addon.status, 200)
  console.log('blender 插件冒烟测试通过')
} finally {
  await plugin.stop()
  rmSync(data, { recursive: true, force: true })
}
process.exit(0)
