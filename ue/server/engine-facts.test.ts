// 新会话开头给 Agent 的引擎事实：版本、源码目录、没找到时怎么办，纯蓝图项目不给。
// 用法：node --test ue/server/engine-facts.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import { engineFacts } from './engine-facts.ts'
import type { UeProject } from './types.ts'

let base = ''
let engine = ''
const proj = (over: Partial<UeProject>) =>
  ({
    id: 'p',
    root: path.join(base, 'Game'),
    uproject: path.join(base, 'Game', 'Game.uproject'),
    cpp: true,
    engineDir: '',
    engine: { association: '5.4', dir: engine, version: '5.4.4', source: 'launcher' },
    ...over,
  }) as UeProject

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-facts-'))
  engine = path.join(base, 'UE_5.4')
  await mkdir(path.join(engine, 'Engine', 'Source'), { recursive: true })
  await mkdir(path.join(base, 'Game'), { recursive: true })
  await writeFile(path.join(base, 'Game', 'Game.uproject'), '{}')
})

test('C++ 项目：写明版本、源码目录和先查后写的技能', async () => {
  const s = await engineFacts(proj({}))
  assert.match(s, /## UE C\+\+ 引擎/)
  assert.match(s, /5\.4\.4，Launcher 安装/)
  assert.ok(s.includes(path.join(engine, 'Engine', 'Source')))
  assert.match(s, /ue-cpp-engine-api/)
  assert.match(s, /get_members/)
})

test('纯蓝图项目不给；登记后加了 Source 的按 C++ 项目给', async () => {
  assert.equal(await engineFacts(proj({ cpp: false })), '')
  const root = path.join(base, 'Later')
  await mkdir(path.join(root, 'Source'), { recursive: true })
  await writeFile(path.join(root, 'Later.uproject'), '{"EngineAssociation":"5.4"}')
  assert.match(
    await engineFacts(proj({ cpp: false, root, uproject: path.join(root, 'Later.uproject') })),
    /UE C\+\+ 引擎/,
  )
})

test('登记后项目换了引擎版本：按 .uproject 现在的 EngineAssociation 重新找，不用存下的旧引擎', async () => {
  const root = path.join(base, 'Upgraded')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'Upgraded.uproject'), '{"EngineAssociation":"9.9"}')
  const s = await engineFacts(proj({ root, uproject: path.join(root, 'Upgraded.uproject') }))
  assert.ok(!s.includes(path.join(engine, 'Engine', 'Source')), '不再指向登记时的旧引擎')
  assert.match(s, /没找到这个项目用的引擎目录/)
})

test('没找到引擎目录：说清楚请用户指定或贴声明，不凭记忆写', async () => {
  const s = await engineFacts(proj({ engine: { association: '{GUID}', dir: '', version: '', source: 'unknown' } }))
  assert.match(s, /没找到这个项目用的引擎目录/)
  assert.match(s, /权限与设置/)
})

test('引擎里没有 Source：提示查不到时请用户贴声明', async () => {
  const bare = path.join(base, 'UE_bare')
  await mkdir(path.join(bare, 'Engine'), { recursive: true })
  const s = await engineFacts(proj({ engine: { association: '5.8', dir: bare, version: '5.8.0', source: 'custom' } }))
  assert.match(s, /没有 Engine\/Source/)
  assert.match(s, /手动指定/)
})
