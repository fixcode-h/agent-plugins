import assert from 'node:assert/strict'
import { test } from 'node:test'
import { narrowMany, narrowRef } from './pick.ts'
import type { GmRef } from './schema.ts'

const ref = { class: 'BP_Npc_C', ident: [{ prop: '@.Id', op: 'gt', value: 0 }] } as unknown as GmRef

test('挑实例：一个用 eq，几个用 any 组，接在原来的条件后面', () => {
  assert.equal(narrowRef(ref, []), ref)
  assert.deepEqual((narrowRef(ref, ['Npc_1']) as unknown as { ident: unknown[] }).ident[1], {
    prop: '@:name',
    op: 'eq',
    value: 'Npc_1',
  })
  const two = narrowRef(ref, ['A', 'B']) as unknown as { ident: { any?: unknown[] }[] }
  assert.equal(two.ident[1].any?.length, 2)
  assert.equal((ref as unknown as { ident: unknown[] }).ident.length, 1)
  assert.equal(narrowMany(['A', 'B'], 'error'), 'each')
  assert.equal(narrowMany(['A'], 'first'), 'first')
})
