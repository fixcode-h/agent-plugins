import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DesignProject } from '../shared/design.ts'
import { adoptOwnersOnce, pickOwner } from './design-owners.ts'

const root = path.resolve('/work')
const panel = [
  { id: 'game', path: path.join(root, 'game') },
  { id: 'client', path: path.join(root, 'game', 'client') },
  { id: 'web', path: path.join(root, 'site') },
]

test('UI 项目归属：同 id 优先，其次目录一样或包含（最近的），只有一个面板项目时归它，归不上留空', () => {
  assert.equal(pickOwner({ id: 'web', path: '' }, panel), 'web')
  assert.equal(pickOwner({ id: 'x', path: path.join(root, 'game', 'client', 'ui') }, panel), 'client')
  assert.equal(pickOwner({ id: 'x', path: path.join(root, 'game') + path.sep }, panel), 'game')
  // UI 目录是面板项目的上一层
  assert.equal(pickOwner({ id: 'x', path: root }, [panel[2]]), 'web')
  assert.equal(pickOwner({ id: 'x', path: path.join(root, 'other') }, panel), '')
  assert.equal(pickOwner({ id: 'x', path: '' }, [panel[0]]), 'game')
  // 名字只是前缀相同的目录不算包含
  assert.equal(pickOwner({ id: 'x', path: path.join(root, 'gamekit') }, panel), '')
  // Windows 不分大小写
  assert.equal(
    pickOwner({ id: 'x', path: 'C:\\Proj\\Game' }, [{ id: 'g', path: 'c:\\proj\\game' }, panel[2]], true),
    'g',
  )
})

test('UI 项目归属只做一次，归上的面板项目打开插件', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ud-owner-'))
  try {
    const at = '2026-01-01T00:00:00.000Z'
    const mk = (id: string, p: string, owner = ''): DesignProject => ({
      id,
      name: id,
      path: p,
      owner,
      prompts: [],
      createdAt: at,
      updatedAt: at,
    })
    const list = [mk('game', ''), mk('a', path.join(root, 'site', 'ui')), mk('b', '/nowhere'), mk('c', '', 'gone')]
    const enabled: string[] = []
    const o = {
      dataDir: dir,
      panel: async () => panel,
      enable: async (id: string) => void enabled.push(id),
      log: () => {},
    }
    assert.equal(await adoptOwnersOnce(list, o), true)
    assert.deepEqual(
      list.map((p) => p.owner),
      ['game', 'web', '', 'gone'],
    )
    // 删掉了的面板项目不去打开
    assert.deepEqual(enabled.sort(), ['game', 'web'])
    list[2].owner = ''
    assert.equal(await adoptOwnersOnce(list, o), false)
    assert.equal(enabled.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
