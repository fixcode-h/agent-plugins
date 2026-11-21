import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setHost } from '../../../host.ts'
import { normalizeGroups } from './props-shape.ts'

// 文案原样返回：只测整形
setHost({ t: (zh: string) => zh } as unknown as Parameters<typeof setHost>[0])

test('gt.props 读 Lua 类：lua 组照收，functions 组的函数整成只看的行', () => {
  const g = normalizeGroups({
    groups: [
      {
        id: 'lua',
        title: 'Lua',
        items: [{ prop: '@#shopId', name: 'shopId', src: 'lua', type: 'number', kind: 'int' }],
      },
      { id: 'functions', title: 'Functions', items: [{ name: 'Refresh', params: ['force'], from: 'UI.BaseView' }] },
    ],
  })
  assert.equal(g[0].items[0].prop, '@#shopId')
  const fn = g[1].items[0]
  assert.equal(fn.name, 'Refresh(force)')
  assert.equal(fn.comparable, false)
  assert.deepEqual(fn.luaFn, { params: ['force'], from: 'UI.BaseView', src: 'lua' })
})

test('UE 类的函数带返回类型和来源', () => {
  const g = normalizeGroups({
    groups: [
      {
        id: 'functions',
        title: '函数',
        items: [{ name: 'GetActorLocation', params: [], ret: 'FVector', from: 'Actor', src: 'cpp', pure: true }],
      },
    ],
  })
  const fn = g[0].items[0]
  assert.equal(fn.src, 'cpp')
  assert.deepEqual(fn.luaFn, { params: [], from: 'Actor', ret: 'FVector', src: 'cpp', pure: true })
})

test('lua / functions 放在顶层时也认', () => {
  const g = normalizeGroups({
    groups: [],
    lua: [{ prop: '@#a', name: 'a', src: 'lua', type: 'x', kind: 'string' }],
    functions: [{ name: 'F' }],
  })
  assert.deepEqual(
    g.map((x) => x.id),
    ['lua', 'functions'],
  )
  assert.equal(g[1].items[0].name, 'F()')
})
