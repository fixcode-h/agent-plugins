import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyGm, type GmCustom, type GmStore } from './schema.ts'
import { importShare, shareMacro, shareObject } from './share.ts'

const custom = (id: string, name: string, module = 'mod1'): GmCustom =>
  ({
    id,
    name,
    module,
    kind: 'call',
    obj: '主角',
    objects: { 主角: { src: '@pawn' } },
    function: 'AddGold',
    args: {},
    editable: [],
    many: 'error',
  }) as GmCustom

const src: GmStore = {
  ...emptyGm(),
  modules: [{ id: 'mod1', name: '经济' }],
  custom: [custom('c1', '加金币')],
  objects: [{ name: '主角', src: '@pawn' }],
  macros: [{ id: 'm1', name: '开局', steps: [{ custom: 'c1' }, { wait: 1 }] }],
}

test('复制宏带上它调的自定义 GM 和模块，导进空的 gm.json 全加进来', () => {
  const text = shareMacro(src, 'm1')!
  const r = importShare(emptyGm(), text)
  assert.deepEqual(r.g.modules, [{ id: 'mod1', name: '经济' }])
  assert.equal(r.g.custom[0].name, '加金币')
  assert.equal(r.g.macros[0].steps[0].custom, r.g.custom[0].id)
  assert.equal(r.renamed.length, 0)
})

test('导进已有的：一样的跳过，同名不同的另存，模块按名字合并，id 撞了宏跟着换', () => {
  const mine: GmStore = {
    ...emptyGm(),
    modules: [{ id: 'x', name: '经济' }],
    custom: [custom('c1', '别的', 'x')],
    objects: [{ name: '主角', src: '@sub.Hero' }],
    macros: [{ id: 'm1', name: '开局', steps: [] }],
  }
  const r = importShare(mine, shareMacro(src, 'm1')!)
  const added = r.g.custom.find((c) => c.name === '加金币')!
  assert.equal(added.module, 'x')
  assert.notEqual(added.id, 'c1')
  const m = r.g.macros.find((x) => x.name === '开局（导入）')!
  assert.equal(m.steps[0].custom, added.id)
  assert.notEqual(m.id, 'm1')
  const o = importShare(mine, shareObject(src.objects[0]))
  assert.deepEqual(o.renamed, [['主角', '主角（导入）']])
  assert.deepEqual(importShare(src, shareObject(src.objects[0])).same, ['对象「主角」'])
})

test('不是 GM 的 JSON 报错', () => {
  assert.throws(() => importShare(emptyGm(), 'hello'), /不是 JSON/)
  assert.throws(() => importShare(emptyGm(), '{"a":1}'), /不是 GM 页复制出来的/)
})
