// AssetForge 配置根、GameTest 场景根跟面板的项目文档根走：提示文件、旧目录搬家、项目设置里指定了就不动。
// 用法：node --test ue/server/uekit/docs-hint.test.ts（不需要 UE、不需要面板）
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { syncDocsHint } from './docs-hint.ts'
import { docsSubDir, hintDocsRoot } from './docs-sub.ts'
import { forgeConfigRoot } from './forge-disk.ts'
import { insideProject } from './gt-paths.ts'
import { scenarioRoot } from './gt-disk.ts'

test('没有提示文件按旧规则；写了提示文件，旧目录复制过去、两个根都换到共用文档根', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ue-docs-hint-'))
  // 分支 Dev 的 UE 项目，旧规则下文档在 Dev/ProjectDoc/docs；各分支共用的文档根在 Main/ProjectDoc/docs
  const root = path.join(base, 'Dev', 'Game')
  const old = path.join(base, 'Dev', 'ProjectDoc', 'docs')
  const shared = path.join(base, 'Main', 'ProjectDoc', 'docs')
  await mkdir(path.join(old, 'AssetForge', 'umg'), { recursive: true })
  await writeFile(path.join(old, 'AssetForge', 'umg', 'WBP_A.json'), '{}')
  await mkdir(path.join(old, 'GameTest'), { recursive: true })
  await writeFile(path.join(old, 'GameTest', 'smoke.json'), '{}')
  await mkdir(root, { recursive: true })
  assert.equal(await forgeConfigRoot(root), path.join(old, 'AssetForge'))
  assert.equal(hintDocsRoot(root), undefined)

  const moved = await syncDocsHint(root, shared)
  assert.equal(moved.length, 2)
  assert.equal((await readFile(path.join(root, 'Saved', 'AgentPanel', 'docs-root.txt'), 'utf8')).trim(), shared)
  assert.equal(hintDocsRoot(root), shared)
  assert.equal(await forgeConfigRoot(root), path.join(shared, 'AssetForge'))
  assert.equal(await scenarioRoot(root), path.join(shared, 'GameTest'))
  assert.ok(existsSync(path.join(shared, 'AssetForge', 'umg', 'WBP_A.json')))
  // 旧的不删
  assert.ok(existsSync(path.join(old, 'GameTest', 'smoke.json')))
  // 共用文档根在项目外，也能读写里面的文件
  assert.equal(
    insideProject(root, path.join(shared, 'GameTest', 'smoke.json')),
    path.join(shared, 'GameTest', 'smoke.json'),
  )
  // 再来一次不重复复制
  assert.deepEqual(await syncDocsHint(root, shared), [])
})

test('新位置还没有、旧位置有时先用旧的；项目设置里指定了场景根就不搬', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ue-docs-hint-'))
  const root = path.join(base, 'Game')
  const shared = path.join(base, 'Shared', 'docs')
  await mkdir(path.join(root, 'docs', 'GameTest'), { recursive: true })
  await mkdir(path.join(root, 'Config'), { recursive: true })
  await writeFile(
    path.join(root, 'Config', 'DefaultGame.ini'),
    '[/Script/GameTest.GameTestSettings]\nScenarioRootDir=Tests/GT\n',
  )
  await mkdir(shared, { recursive: true })
  await mkdir(path.join(root, 'Saved', 'AgentPanel'), { recursive: true })
  await writeFile(path.join(root, 'Saved', 'AgentPanel', 'docs-root.txt'), shared)
  // 还没搬：GameTest 用旧位置，AssetForge 两边都没有就用新位置
  assert.equal(docsSubDir(root, 'GameTest'), path.join(root, 'docs', 'GameTest'))
  assert.equal(docsSubDir(root, 'AssetForge'), path.join(shared, 'AssetForge'))
  assert.deepEqual(await syncDocsHint(root, shared), [])
  assert.ok(!existsSync(path.join(shared, 'GameTest')))
  assert.equal(await scenarioRoot(root), path.join(root, 'Tests', 'GT'))
})

test('别的分支先搬过、新位置已有目录：这个分支旧位置的文件也并进去，同名不覆盖，只并一次', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ue-docs-hint-'))
  const root = path.join(base, 'Dev', 'Game')
  const old = path.join(base, 'Dev', 'ProjectDoc', 'docs', 'GameTest')
  const shared = path.join(base, 'Main', 'ProjectDoc', 'docs')
  await mkdir(old, { recursive: true })
  await writeFile(path.join(old, 'dev-only.json'), '{"from":"dev"}')
  await writeFile(path.join(old, 'same.json'), '{"from":"dev"}')
  await mkdir(path.join(shared, 'GameTest'), { recursive: true })
  await writeFile(path.join(shared, 'GameTest', 'same.json'), '{"from":"main"}')
  await mkdir(root, { recursive: true })
  assert.equal((await syncDocsHint(root, shared)).length, 1)
  assert.ok(existsSync(path.join(shared, 'GameTest', 'dev-only.json')))
  assert.equal(await readFile(path.join(shared, 'GameTest', 'same.json'), 'utf8'), '{"from":"main"}')
  // 用户在新位置删掉的文件不会被再补回来
  await rm(path.join(shared, 'GameTest', 'dev-only.json'))
  assert.deepEqual(await syncDocsHint(root, shared), [])
  assert.ok(!existsSync(path.join(shared, 'GameTest', 'dev-only.json')))
})
