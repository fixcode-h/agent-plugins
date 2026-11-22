import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dropPreset, movePresets, presetsOf, renamePreset, savePreset } from './presets.ts'

test('参数预设：存、同名覆盖、改名撞名不改、删空去掉键、跟着条目搬', () => {
  let g = { argPresets: {} as Record<string, { name: string; args: string[] | Record<string, unknown> }[]> }
  g = savePreset(g, 'lua:AddItem', '一把剑', ['1001', '1'])
  g = savePreset(g, 'lua:AddItem', '一堆药', ['2001', '99'])
  g = savePreset(g, 'lua:AddItem', '一把剑', ['1002', '1'])
  assert.deepEqual(
    presetsOf(g, 'lua:AddItem').map((p) => `${p.name}:${(p.args as string[]).join(',')}`),
    ['一把剑:1002,1', '一堆药:2001,99'],
  )
  assert.equal(renamePreset(g, 'lua:AddItem', '一把剑', '一堆药'), g)
  g = renamePreset(g, 'lua:AddItem', '一把剑', '好剑')
  assert.equal(presetsOf(g, 'lua:AddItem')[0].name, '好剑')
  g = movePresets(g, 'lua:AddItem', 'lua:GiveItem')
  assert.equal(presetsOf(g, 'lua:AddItem').length, 0)
  g = dropPreset(dropPreset(g, 'lua:GiveItem', '好剑'), 'lua:GiveItem', '一堆药')
  assert.deepEqual(g.argPresets, {})
})
