import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byClass, byModule, byOwner, isA, isClassObj, isPathQuery, parseSrc, regroupFns, search, selfCandidates, tidyChain, type BoundObj, type TNode } from './tree-model.ts'

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

test('tidyChain：路径只留类名，重复的层标 dup，匿名层按文件认出模块', () => {
  const raw = [
    { name: '', src: 'C:/P/Content/Script/AI/BP_AICharacter_C.lua:12' },
    { name: '/Game/Core/ABP_AICharacter.ABP_AICharacter_C', kind: 'ue' as const },
    { name: '/Game/Core/ABP_AICharacter.ABP_AICharacter_C', kind: 'ue' as const },
  ]
  const c = tidyChain<{ name: string; src?: string; kind?: 'lua' | 'ue'; path?: string }>(raw, 'AI.BP_AICharacter_C')
  assert.equal(c.length, 3)
  assert.equal(c[0].name, 'AI.BP_AICharacter_C')
  assert.equal(c[0].kind, 'lua')
  assert.equal(c[1].name, 'ABP_AICharacter_C')
  assert.equal(c[1].path, '/Game/Core/ABP_AICharacter.ABP_AICharacter_C')
  assert.equal(c[2].dup, true)
})

test('regroupFns：自己表上的 C 函数归第一层 UE 类', () => {
  const fns = [
    { name: 'GetName', from: 0 },
    { name: 'Spawn', from: 0, src: 'a.lua:3' },
    { name: 'IsA', from: 2 },
  ]
  const r = regroupFns(fns, [{ name: 'M', kind: 'lua' }, { name: 'AActor', kind: 'ue' }])
  assert.deepEqual(
    r.map((f) => f.from),
    [2, 0, 2],
  )
})

test('selfCandidates：模块表给绑这个模块的实例，类对象给这个类的实例，类本身不算', () => {
  const objs: BoundObj[] = [
    { path: '/G.BP_A_C', name: 'BP_A_C', class: 'BlueprintGeneratedClass', module: 'AI.A' },
    { path: 'L.BP_A_C_0', name: 'BP_A_C_0', class: 'BP_A_C', module: 'AI.A' },
    { path: 'L.BP_A_C_1', name: 'BP_A_C_1', class: 'BP_A_C', module: 'AI.A', state: 'garbage' },
  ]
  assert.ok(isClassObj(objs[0]))
  const m = selfCandidates({ path: '', keys: ['package', 'loaded', 'AI.A'] }, objs)
  assert.deepEqual(m?.cands.map((o) => o.name), ['BP_A_C_0'])
  const c = selfCandidates({ path: objs[0].path, keys: [] }, objs, objs[0])
  assert.equal(c?.why, 'class')
  assert.deepEqual(c?.cands.map((o) => o.name), ['BP_A_C_0'])
  assert.equal(selfCandidates({ path: objs[1].path, keys: [] }, objs, objs[1]), undefined)
})
