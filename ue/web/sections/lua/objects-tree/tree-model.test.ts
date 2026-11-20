import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byClass, byModule, byOwner, isA, isPathQuery, parseSrc, search, type BoundObj, type TNode } from './tree-model.ts'

const base = ['Character', 'Pawn', 'Actor', 'Object']
const O: BoundObj[] = [
  { path: '/W.W:L.PC_0', name: 'BP_PC_C_0', class: 'BP_PC_C', module: 'Player.BP_PC_C', world: 'pie0', classChain: ['PlayerController', 'Controller', 'Actor', 'Object'] },
  { path: '/W.W:L.Player_0', name: 'BP_Player_C_0', class: 'BP_Player_C', module: 'Player.BP_Player_C', world: 'pie0', classChain: ['BP_CharacterBase_C', ...base], owner: '/W.W:L.PC_0' },
  { path: '/W.W:L.AI_0', name: 'BP_AI_C_0', class: 'BP_AI_C', module: 'AI.BP_AI_C', world: 'pie0', classChain: ['BP_CharacterBase_C', ...base] },
  { path: '/W.W:L.AI_1', name: 'BP_AI_C_1', class: 'BP_AI_C', module: 'AI.BP_AI_C', world: 'pie0', state: 'garbage', classChain: ['BP_CharacterBase_C', ...base], owner: '/W.W:L.AIC_9', ownerName: 'AIC_9' },
  { path: '/Old.Old:L.Panel_0', name: 'WBP_Lobby_C_0', class: 'WBP_Lobby_C', module: 'UI.WBP_Lobby_C', state: 'noworld', classChain: ['UserWidget', 'Widget', 'Object'] },
]
const names = (ns: TNode[]): unknown => ns.map((n) => (n.children.length ? { [n.name]: names(n.children) } : n.name))

test('按模块分组，模块下是实例', () => {
  const t = byModule(O)
  assert.equal(t.length, 4)
  assert.deepEqual(names(t.filter((n) => n.name === 'AI.BP_AI_C')), [{ 'AI.BP_AI_C': ['BP_AI_C_0', 'BP_AI_C_1'] }])
})

test('按类名搜含子类：树根是搜到的类', () => {
  const r = search('BP_CharacterBase', O, ['Character.BP_CharacterBase'], [])
  assert.equal(r.classHits, 3)
  assert.deepEqual(names(r.classes), [{ BP_CharacterBase_C: [{ BP_AI_C: ['BP_AI_C_0', 'BP_AI_C_1'] }, { BP_Player_C: ['BP_Player_C_0'] }] }])
  assert.equal(r.classes[0].count, 3)
  assert.deepEqual(r.modules, ['Character.BP_CharacterBase'])
  assert.ok(isA(O[1], 'BP_CharacterBase'))
  assert.ok(isA(O[0], 'APlayerController'))
})

test('类树收掉只有一条路的上层', () => {
  const t = byClass(O.slice(1, 4))
  assert.deepEqual(names(t), [{ BP_CharacterBase_C: [{ BP_AI_C: ['BP_AI_C_0', 'BP_AI_C_1'] }, { BP_Player_C: ['BP_Player_C_0'] }] }])
})

test('按归属：外层是绑定对象时挂在下面，没绑的补外层节点，已关的世界最后', () => {
  const t = byOwner(O)
  assert.deepEqual(names(t), [
    { pie0: [{ AIC_9: ['BP_AI_C_1'] }, 'BP_AI_C_0', { BP_PC_C_0: ['BP_Player_C_0'] }] },
    { '': ['WBP_Lobby_C_0'] },
  ])
})

test('归属成环时不死循环', () => {
  const a = { ...O[0], owner: O[1].path }
  const t = byOwner([a, O[1]])
  assert.equal(t[0].count, 2)
})

test('Lua 路径和源码位置', () => {
  assert.ok(isPathQuery('UIManager.Panels'))
  assert.ok(!isPathQuery('BP_CharacterBase'))
  assert.deepEqual(parseSrc('[string "C:/P/Script/A.lua"]:26'), { file: 'C:/P/Script/A.lua', line: 26 })
  assert.deepEqual(parseSrc('@D:\\P\\B.lua:3'), { file: 'D:/P/B.lua', line: 3 })
  assert.deepEqual(parseSrc('=[C]'), { file: '=[C]' })
})
