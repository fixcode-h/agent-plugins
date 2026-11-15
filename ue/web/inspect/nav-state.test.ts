// 导航历史的纯逻辑单测：node --test ue/web/inspect/nav-state.test.ts（Node 22 自带去类型，不用装东西）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY,
  NAV_MAX,
  RECENT_MAX,
  back,
  canBack,
  canForward,
  chain,
  clear,
  current,
  forward,
  jump,
  push,
  recent,
  setComp,
  splitSub,
  sync,
  type NavEntry,
  type NavState,
} from './nav-state.ts'

const o = (path: string, extra: Partial<NavEntry> = {}): NavEntry => ({ page: 'objects', path, ...extra })
const paths = (s: NavState) => s.items.map((e) => e.path)

test('push 接在后面，同一个对象只更新组件', () => {
  let s = push(EMPTY, o('A', { from: 'outline' }))
  s = push(s, o('B', { via: 'Mesh' }))
  assert.deepEqual(paths(s), ['A', 'B'])
  assert.equal(s.index, 1)
  s = push(s, o('B', { comp: 'B.C' }))
  assert.deepEqual(paths(s), ['A', 'B'])
  assert.equal(current(s)?.comp, 'B.C')
})

test('后退、前进，到头不动', () => {
  let s = [o('A'), o('B'), o('C')].reduce(push, EMPTY)
  assert.equal(canForward(s), false)
  s = back(back(s))
  assert.equal(current(s)?.path, 'A')
  assert.equal(canBack(s), false)
  assert.equal(back(s), s)
  s = forward(s)
  assert.equal(current(s)?.path, 'B')
  assert.equal(canForward(s), true)
})

test('后退后再 push 丢掉前进的部分', () => {
  let s = [o('A'), o('B'), o('C')].reduce(push, EMPTY)
  s = push(back(s), o('D'))
  assert.deepEqual(paths(s), ['A', 'B', 'D'])
  assert.equal(canForward(s), false)
})

test('最多留 50 条', () => {
  let s = EMPTY
  for (let i = 0; i < NAV_MAX + 7; i++) s = push(s, o(`P${i}`))
  assert.equal(s.items.length, NAV_MAX)
  assert.equal(s.items[0].path, 'P7')
  assert.equal(s.index, NAV_MAX - 1)
})

test('jump 和 clear', () => {
  let s = [o('A'), o('B', { via: 'x' }), o('C')].reduce(push, EMPTY)
  s = jump(s, 0)
  assert.equal(current(s)?.path, 'A')
  assert.equal(jump(s, 9), s)
  s = clear(jump(s, 1))
  assert.deepEqual(paths(s), ['B'])
  assert.equal(s.index, 0)
  assert.equal(current(s)?.via, undefined)
  assert.equal(clear(EMPTY), EMPTY)
})

test('setComp 只改当前这条', () => {
  const s = [o('A'), o('B')].reduce(push, EMPTY)
  const n = setComp(s, 'B.Root')
  assert.equal(n.items[1].comp, 'B.Root')
  assert.equal(n.items[0].comp, undefined)
  assert.equal(setComp(n, 'B.Root'), n)
})

test('sync：地址是当前这条只换组件；浏览器后退到前一条时移过去不新加', () => {
  let s = [o('A', { comp: 'A.C1' }), o('B')].reduce(push, EMPTY)
  s = sync(s, 'objects', 'B', 'B.X')
  assert.equal(s.items.length, 2)
  assert.equal(current(s)?.comp, 'B.X')
  s = sync(s, 'objects', 'A', 'A.C1')
  assert.equal(s.index, 0)
  assert.equal(s.items.length, 2)
  s = sync(s, 'objects', 'B', 'B.X')
  assert.equal(s.index, 1)
})

test('sync：带了说明的点击就算地址是前一条也新加；别处跳过来记成 link', () => {
  let s = [o('A'), o('B', { via: 'Owner' })].reduce(push, EMPTY)
  s = sync(s, 'objects', 'A', undefined, { via: 'Parent' })
  assert.deepEqual(paths(s), ['A', 'B', 'A'])
  assert.equal(current(s)?.via, 'Parent')
  s = sync(s, 'assets', '/Game/X', undefined)
  assert.equal(current(s)?.from, 'link')
  assert.equal(current(s)?.page, 'assets')
  assert.equal(sync(s, 'assets', '', undefined), s)
})

test('chain 从最近一次浏览栏点选开始', () => {
  let s = [
    o('Old', { from: 'outline' }),
    o('Floor1', { from: 'outline' }),
    o('/Game/SM', { page: 'assets', via: 'Static Mesh' }),
    o('/Game/MI', { page: 'assets', via: 'Materials[0]' }),
  ].reduce(push, EMPTY)
  assert.deepEqual(
    chain(s).map((c) => [c.entry.path, c.index]),
    [
      ['Floor1', 1],
      ['/Game/SM', 2],
      ['/Game/MI', 3],
    ],
  )
  s = back(s)
  assert.deepEqual(
    chain(s).map((c) => c.entry.path),
    ['Floor1', '/Game/SM'],
  )
  assert.deepEqual(chain(EMPTY), [])
})

test('recent：新的在上、去重、最多 20 条、标出当前', () => {
  let s = [o('A'), o('B'), o('A'), o('C')].reduce(push, EMPTY)
  s = back(s)
  const r = recent(s)
  assert.deepEqual(
    r.map((x) => x.entry.path),
    ['C', 'A', 'B'],
  )
  assert.equal(r.find((x) => x.current)?.entry.path, 'A')
  let big = EMPTY
  for (let i = 0; i < 30; i++) big = push(big, o(`P${i}`))
  assert.equal(recent(big).length, RECENT_MAX)
})

test('splitSub', () => {
  assert.deepEqual(splitSub('A|B'), { path: 'A', comp: 'B' })
  assert.deepEqual(splitSub('A'), { path: 'A' })
  assert.deepEqual(splitSub('A|'), { path: 'A', comp: undefined })
})
