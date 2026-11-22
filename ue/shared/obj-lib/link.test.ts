// 脚本引用对象库：拷规则 + 记来源、拖进来的 $lib 收掉、和库比出不一样的、同步 / 断开。
// 用法：node --test ue/shared/obj-lib/link.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GmObject } from '../gm/schema.ts'
import type { GtScript } from '../gt-script/types.ts'
import { absorbLibDrops, libDrift, linkObject, syncFromLib, unlinkLib } from './link.ts'

const SHOP: GmObject = { name: '商店', folder: 'UI', ref: { class: 'WBP_Shop_C', in: 'screen' } }
const doc = (o: Partial<GtScript> = {}): GtScript => ({ kind: 'gametest-scenario', schemaVersion: 5, steps: [], ...o })

test('拷进脚本：objects 写规则、objLib 记路径；同一项再拷复用名字，名字被占加数字', () => {
  const a = linkObject(doc(), SHOP)
  assert.equal(a.name, '商店')
  assert.deepEqual(a.doc.objects, { 商店: SHOP.ref })
  assert.deepEqual(a.doc.objLib, { 商店: 'UI/商店' })
  assert.equal(linkObject(a.doc, SHOP).doc, a.doc)
  const b = linkObject(doc({ objects: { 商店: { class: 'X' } } }), SHOP)
  assert.equal(b.name, '商店2')
})

test('拖进来的步骤：$lib 收掉，对象进 objects，obj 换成实际名字；没有 $lib 原样返回', () => {
  const plain = doc({ steps: [{ id: 's1', action: 'click' }] })
  assert.equal(absorbLibDrops(plain), plain)
  const d = doc({
    objects: { 商店: { class: 'Other' } },
    steps: [
      { id: 's1', action: 'obj.call', obj: '商店', function: '', $lib: { name: '商店', path: 'UI/商店', value: SHOP.ref } },
    ],
  })
  const r = absorbLibDrops(d)
  assert.deepEqual(r.steps, [{ id: 's1', action: 'obj.call', obj: '商店2', function: '' }])
  assert.deepEqual((r.objects as Record<string, unknown>).商店2, SHOP.ref)
  assert.deepEqual(r.objLib, { 商店2: 'UI/商店' })
})

test('和库比：规则变了、库里删了；同步按库更新，删了的断开；保留就断开链接', () => {
  const linked = linkObject(doc(), SHOP).doc
  assert.deepEqual(libDrift(linked, [SHOP]), [])
  const changed = { ...SHOP, ref: { class: 'WBP_Shop2_C' } }
  assert.deepEqual(libDrift(linked, [changed]), [{ name: '商店', path: 'UI/商店' }])
  assert.deepEqual(libDrift(linked, []), [{ name: '商店', path: 'UI/商店', gone: true }])
  const synced = syncFromLib(linked, [changed], ['商店'])
  assert.deepEqual((synced.objects as Record<string, unknown>).商店, { class: 'WBP_Shop2_C' })
  assert.deepEqual(syncFromLib(linked, [], ['商店']).objLib, {})
  assert.equal('objLib' in unlinkLib(linked, ['商店']), false)
})

test('对象块选了对象库的一项：值是 {$lib} 时整个换成名字（obj 和对象参数都行）', () => {
  const $lib = { name: '商店', path: 'UI/商店', value: SHOP.ref }
  const r = absorbLibDrops(doc({ steps: [{ id: 'c', action: 'obj.call', obj: { $lib }, args: { Who: { $lib } } }] }))
  assert.deepEqual(r.steps, [{ id: 'c', action: 'obj.call', obj: '商店', args: { Who: '商店' } }])
  assert.deepEqual(r.objLib, { 商店: 'UI/商店' })
})
