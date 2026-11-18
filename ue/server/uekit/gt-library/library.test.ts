// GameTest 场景库整理：call 路径的找和改（call-refs.ts）、新建 / 移动 / 改名 / 删除（folders.ts、move.ts）。
// 用法：node --test ue/server/uekit/gt-library/library.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../../sdk/server.ts'
import { setCtx } from '../../util.ts'
import { callKey, findCalls, remapCall, remapPath, rewriteCalls } from './call-refs.ts'
import { libraryAction } from './index.ts'

let base = ''
before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-gt-lib-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

const has = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

test('call 路径：比较时忽略 .json、反斜杠、大小写；改写保留原来写不写 .json', () => {
  assert.equal(callKey('.\\Common\\Login.json'), 'common/login')
  const moves = [{ from: 'common', to: 'shared/common', dir: true }]
  assert.equal(remapCall('common/Login', moves), 'shared/common/Login')
  assert.equal(remapCall('Common/Login.json', moves), 'shared/common/Login.json')
  assert.equal(remapCall('commonX/Login', moves), undefined)
  assert.equal(remapCall('daily/a', [{ from: 'daily/a.json', to: 'b.json', dir: false }]), 'b')
  assert.equal(remapPath('Common/x.json', moves), 'shared/common/x.json')
})

test('call 在哪一层都找得到：主流程、块里、守护里、_settings 的全局守护', () => {
  const doc = {
    guards: [{ id: 'g1', do: [{ action: 'call', script: 'common/guide' }] }],
    steps: [
      { action: 'click' },
      {
        action: 'if',
        then: [{ action: 'call', script: 'common/login' }],
        else: [{ action: 'loop', do: [{ action: 'call', script: 'x' }] }],
      },
    ],
  }
  assert.deepEqual(
    findCalls(doc).map((c) => c.at),
    ['guards.0.do.0', 'steps.1.then.0', 'steps.1.else.0.do.0'],
  )
  const changed = rewriteCalls(doc, [{ from: 'common', to: 'lib', dir: true }])
  assert.equal(changed.length, 2)
  assert.equal(doc.steps[1].then![0].script, 'lib/login')
})

/** 一个项目：场景根在项目里的 docs/GameTest（没配 ScenarioRootDir、外层没有 ProjectDoc 时的默认），产物根 Saved/GameTest */
async function makeProject(name: string) {
  const project = path.join(base, name, 'Game')
  const inRoot = path.join(project, 'docs', 'GameTest')
  await mkdir(path.join(inRoot, 'common'), { recursive: true })
  await mkdir(path.join(inRoot, 'daily'), { recursive: true })
  await mkdir(path.join(project, 'Saved', 'GameTest'), { recursive: true })
  return { project, inRoot }
}

test('移动文件夹：call 跟着改（保留缩进），历史换成新路径，整理备份跟着走', async () => {
  const { project, inRoot } = await makeProject('move')
  await writeFile(
    path.join(inRoot, 'common', 'login.json'),
    JSON.stringify({ name: 'login', steps: [{ action: 'wait' }] }, null, '\t'),
  )
  await writeFile(
    path.join(inRoot, 'daily', 'a.json'),
    JSON.stringify({ name: 'a', steps: [{ action: 'call', script: 'common/login' }] }, null, 2),
  )
  await writeFile(
    path.join(inRoot, '_settings.json'),
    JSON.stringify({ guards: [{ do: [{ action: 'call', script: 'common/login.json' }] }] }, null, '\t'),
  )
  await writeFile(
    path.join(project, 'Saved', 'GameTest', 'history.json'),
    JSON.stringify({ scenarios: { 'common/login.json': [{ succeeded: true }] } }),
  )
  const r = { root: inRoot }
  await libraryAction(project, { ...r, action: 'mkdir', dir: '', name: 'shared' })
  const plan = (await libraryAction(project, { ...r, action: 'movePlan', path: 'common', toDir: 'shared' })) as {
    refs: unknown[]
    to: string
  }
  assert.equal(plan.to, 'shared/common')
  assert.equal(plan.refs.length, 2)
  const done = (await libraryAction(project, { ...r, action: 'move', path: 'common', toDir: 'shared' })) as {
    refs: number
    history: number
  }
  assert.equal(done.refs, 2)
  assert.equal(done.history, 1)
  const a = await readFile(path.join(inRoot, 'daily', 'a.json'), 'utf8')
  assert.match(a, /\n {4}\{\n/)
  assert.equal(JSON.parse(a).steps[0].script, 'shared/common/login')
  const s = JSON.parse(await readFile(path.join(inRoot, '_settings.json'), 'utf8'))
  assert.equal(s.guards[0].do[0].script, 'shared/common/login.json')
  const h = JSON.parse(await readFile(path.join(project, 'Saved', 'GameTest', 'history.json'), 'utf8'))
  assert.ok(h.scenarios['shared/common/login.json'])

  // 不能移进自己里面；目标重名不覆盖
  await assert.rejects(libraryAction(project, { ...r, action: 'move', path: 'shared', toDir: 'shared/common' }))
  await libraryAction(project, { ...r, action: 'create', dir: 'daily', name: 'login' })
  await assert.rejects(
    libraryAction(project, { ...r, action: 'move', path: 'daily/login.json', toDir: 'shared/common' }),
  )

  // 改名脚本：文件名、场景里的 name、call 一起改
  await writeFile(path.join(inRoot, 'shared', 'common', 'login.json.bak'), '{}')
  await libraryAction(project, { ...r, action: 'move', path: 'shared/common/login.json', name: '登录' })
  assert.ok(await has(path.join(inRoot, 'shared', 'common', '登录.json.bak')))
  const renamed = JSON.parse(await readFile(path.join(inRoot, 'shared', 'common', '登录.json'), 'utf8'))
  assert.equal(renamed.name, '登录')
  assert.equal(
    JSON.parse(await readFile(path.join(inRoot, 'daily', 'a.json'), 'utf8')).steps[0].script,
    'shared/common/登录',
  )

  // 删除前看影响：删 shared 会让 daily/a 和 _settings 的 call 找不到
  const del = (await libraryAction(project, { ...r, action: 'deletePlan', path: 'shared' })) as {
    scripts: string[]
    callers: { file: string }[]
  }
  assert.deepEqual(del.scripts, ['shared/common/登录.json'])
  assert.deepEqual(del.callers.map((c) => c.file).sort(), ['_settings.json', 'daily/a.json'])
  await libraryAction(project, { ...r, action: 'delete', path: 'shared' })
  assert.equal(await has(path.join(inRoot, 'shared')), false)

  // 空文件夹也列出来
  await libraryAction(project, { ...r, action: 'mkdir', dir: 'daily', name: '空的' })
  const list = (await libraryAction(project, { ...r, action: 'list' })) as { folders: string[] }
  assert.deepEqual(list.folders, ['daily', 'daily/空的'])
})
