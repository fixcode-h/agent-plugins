import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addCommonGroup,
  commonGroups,
  consoleFavs,
  deleteCommonGroup,
  dropCommon,
  inCommon,
  moveCommon,
  renameCommonGroup,
  renameCommonKey,
  toggleCommon,
} from './common.ts'

import type { GmFav } from './schema.ts'

const g0 = { common: [] as GmFav[], commonGroups: [] as string[] }

test('常用：加、去掉；空参数不存 args，同键不同参数算两条', () => {
  let g = toggleCommon(g0, { key: 'lua:AddItem', args: ['1001', '99'] }, '日常')
  g = toggleCommon(g, { key: 'lua:AddItem', args: ['1001', '1'] })
  g = toggleCommon(g, { key: 'console:stat fps', args: [''] })
  assert.deepEqual(g.common[2], { key: 'console:stat fps' })
  assert.equal(g.common[0].group, '日常')
  assert.ok(inCommon(g, { key: 'lua:AddItem', args: ['1001', '1'] }))
  g = toggleCommon(g, { key: 'lua:AddItem', args: ['1001', '99'] })
  assert.equal(g.common.length, 2)
  assert.deepEqual(consoleFavs(g), ['stat fps'])
})

test('常用：拖动换位置、拖进分组', () => {
  let g = { ...g0, common: [{ key: 'a' }, { key: 'b' }, { key: 'c', group: 'x' }] }
  g = moveCommon(g, 0, 2, 'x')
  assert.deepEqual(
    g.common.map((f) => `${f.key}${f.group ? `@${f.group}` : ''}`),
    ['b', 'c@x', 'a@x'],
  )
  g = moveCommon(g, 2, 0)
  assert.equal(g.common[0].group, undefined)
})

test('常用分组：新建、含上层、改名、删了条目挪到上一层', () => {
  let g = addCommonGroup(g0, ' 战斗 / Boss ')
  g = {
    ...g,
    common: [
      { key: 'a', group: '战斗/Boss' },
      { key: 'b', group: '日常' },
    ],
  }
  assert.deepEqual(commonGroups(g), ['日常', '战斗', '战斗/Boss'])
  g = renameCommonGroup(g, '战斗', '打怪')
  assert.equal(g.common[0].group, '打怪/Boss')
  g = deleteCommonGroup(g, '打怪/Boss')
  assert.equal(g.common[0].group, '打怪')
  g = deleteCommonGroup(g, '日常')
  assert.equal('group' in g.common[1], false)
})

test('常用：改键、删键', () => {
  let g = { ...g0, common: [{ key: 'obj:商店' }, { key: 'macro:m1' }] }
  g = renameCommonKey(g, 'obj:商店', 'obj:商店界面')
  assert.equal(g.common[0].key, 'obj:商店界面')
  assert.deepEqual(dropCommon(g, ['macro:m1']).common, [{ key: 'obj:商店界面' }])
})
