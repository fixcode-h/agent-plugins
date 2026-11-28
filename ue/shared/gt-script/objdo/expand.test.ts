import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandObjDo, objDoRun, propPath } from './expand.ts'

test('对象调用按 ops 展开成调函数、读字段、改字段', () => {
  const run = objDoRun({
    id: 'do1',
    action: 'obj.do',
    obj: 'bag',
    ops: [
      { kind: 'call', function: 'AddItem', args: { Id: '$itemId', Count: 3 }, saveAs: 'ok' },
      { kind: 'get', prop: 'Count', saveAs: 'n' },
      { kind: 'set', prop: '@.bDirty', value: false },
    ],
  })
  assert.deepEqual(run, [
    { id: 'do1_1', action: 'obj.call', obj: 'bag', function: 'AddItem', args: { Id: '$itemId', Count: 3 }, saveAs: 'ok' },
    { id: 'do1_2', action: 'set', var: 'n', value: '=prop(bag, "@.Count")' },
    { id: 'do1_3', action: 'obj.set', obj: 'bag', prop: '@.bDirty', value: false },
  ])
})

test('部件上的字段路径、来源对象读不了字段', () => {
  assert.equal(propPath('IsChecked', 'ChkAuto'), '@/ChkAuto.IsChecked')
  assert.equal(propPath('@#hp', 'X'), '@#hp')
  assert.throws(() => objDoRun({ action: 'obj.do', obj: '@sub.UBag', ops: [{ kind: 'get', prop: 'N', saveAs: 'n' }] }))
})

test('整个脚本：块里的也展开，没变时返回同一个对象，展开不了记 issue', () => {
  const doc = {
    steps: [
      { action: 'if', cond: { all: [] }, then: [{ id: 'd', action: 'obj.do', obj: '$b', ops: [{ kind: 'call', function: 'F' }] }] },
      { id: 'e', action: 'obj.do', obj: 'x', ops: [] },
    ],
  }
  const r = expandObjDo(doc)
  const inner = (r.doc.steps as unknown as { then: { run: unknown }[] }[])[0].then[0]
  assert.deepEqual(inner.run, [{ id: 'd_1', action: 'obj.call', obj: '$b', function: 'F', args: {} }])
  assert.equal(r.issues.length, 1)
  assert.equal(expandObjDo(r.doc).doc, r.doc)
})
