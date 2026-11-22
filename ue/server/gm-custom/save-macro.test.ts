import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyGm } from '../../shared/gm/schema.ts'
import type { OpCtx } from '../ops.ts'
import { saveMacro } from './save-macro.ts'

const ctx = {} as OpCtx
const g = {
  ...emptyGm(),
  custom: [{ id: 'c1', name: '加金币' } as never],
  macros: [{ id: 'm1', name: '进图', steps: [] }],
}

test('存宏：自定义 GM 写名字换成 id，同名改原来那个', async () => {
  const r = await saveMacro(
    ctx,
    g,
    {
      name: '进图',
      steps: [{ console: 'slomo 2' }, { wait: 1.5 }, { custom: '加金币', args: { n: 99 } }],
      onFail: 'skip',
    },
    true,
  )
  assert.equal('updated' in r && r.updated, true)
  const m = (r as { def: { id: string; onFail: string; steps: { custom?: string }[] } }).def
  assert.equal(m.id, 'm1')
  assert.equal(m.onFail, 'skip')
  assert.equal(m.steps[2].custom, 'c1')
})

test('存宏：一步写了两种、自定义 GM 不存在、等太久都报错', async () => {
  await assert.rejects(saveMacro(ctx, g, { name: 'x', steps: [{ gm: 'God', console: 'a' }] }, true), /只写/)
  await assert.rejects(saveMacro(ctx, g, { name: 'x', steps: [{ custom: '没有' }] }, true), /不存在/)
  await assert.rejects(saveMacro(ctx, g, { name: 'x', steps: [{ wait: 9999 }] }, true), /宏的写法/)
})
