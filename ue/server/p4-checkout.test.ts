// /Game 包名换成磁盘文件（p4-checkout.ts）。签出规则本身在面板 server/vcs/p4-plan.ts，单测也在那边。
// 用法（在 ue/ 下）：node --test server/p4-checkout.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { gameFileOf } from './p4-checkout.ts'

const root = path.resolve('/proj')
const f = (n: string) => path.join(root, 'Content', n)

test('/Game 包名换成 Content 下的文件：资源 .uasset、关卡 .umap，插件里的包不管', () => {
  const has = new Set([f('UI/WBP_Bag.uasset'), f('Maps/L1.umap')])
  const ex = (x: string) => has.has(x)
  assert.equal(gameFileOf(root, '/Game/UI/WBP_Bag', ex), f('UI/WBP_Bag.uasset'))
  assert.equal(gameFileOf(root, '/Game/UI/WBP_Bag.WBP_Bag', ex), f('UI/WBP_Bag.uasset'))
  assert.equal(gameFileOf(root, '/Game/Maps/L1', ex), f('Maps/L1.umap'))
  assert.equal(gameFileOf(root, '/MyPlugin/X', ex), undefined)
})
