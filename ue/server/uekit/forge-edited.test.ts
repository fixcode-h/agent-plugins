/** 改纳管资产的提醒：哪些调用算改了资源；导入作业什么时候算进完成依据 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetPackage, editedAsset } from './forge-edited.ts'
import { forgeVerdict } from './forge-verdict.ts'

test('对象路径取资源包，PIE 运行时对象和非资源路径不算', () => {
  assert.equal(assetPackage('/Game/UI/WBP_HUD.WBP_HUD_C:WidgetTree.Title'), '/Game/UI/WBP_HUD')
  assert.equal(assetPackage('/Game/Data/DT_Item'), '/Game/Data/DT_Item')
  assert.equal(assetPackage('/Game/Maps/UEDPIE_0_Main.Main:PersistentLevel.BP_Hero_C_0'), '')
  assert.equal(assetPackage('Hero'), '')
})

test('只有真正改了资源的调用才提醒', () => {
  assert.equal(editedAsset('ue_set', { path: '/Game/Data/DA_Hero', prop: 'MaxHP' }), '/Game/Data/DA_Hero')
  assert.equal(editedAsset('ue_set', { path: '/Game/Data/DA_Hero', lua: 'x' }), '')
  assert.equal(editedAsset('ue_blueprint', { action: 'edit', path: '/Game/BP/BP_Door' }), '/Game/BP/BP_Door')
  assert.equal(editedAsset('ue_blueprint', { action: 'edit', path: '/Game/BP/BP_Door', dryRun: true }), '')
  assert.equal(editedAsset('ue_blueprint', { action: 'outline', path: '/Game/BP/BP_Door' }), '')
  assert.equal(editedAsset('ue_asset', { action: 'set', path: '/Game/Data/DT_Item', row: 'A' }), '/Game/Data/DT_Item')
  assert.equal(editedAsset('ue_asset', { action: 'duplicate', path: '/Game/Data/DT_Item', to: '/Game/X' }), '')
  assert.equal(
    editedAsset('ue_asset', { action: 'duplicate', path: '/Game/Data/DT_Item', row: 'A' }),
    '/Game/Data/DT_Item',
  )
  assert.equal(editedAsset('ue_asset', { action: 'delete', path: '/Game/Data/DT_Item' }), '/Game/Data/DT_Item')
  assert.equal(editedAsset('ue_asset', { action: 'rows', path: '/Game/Data/DT_Item' }), '')
})

test('只有跑完的正式导入给结论', () => {
  assert.deepEqual(forgeVerdict({ job: { mode: 'import', status: 'done', total: 2 } })?.passed, true)
  assert.deepEqual(forgeVerdict({ job: { mode: 'import', status: 'failed', failed: 1 } })?.passed, false)
  assert.equal(forgeVerdict({ job: { mode: 'plan', status: 'done' } }), undefined)
  assert.equal(forgeVerdict({ job: { mode: 'export', status: 'done' } }), undefined)
  assert.equal(forgeVerdict({ job: { mode: 'import', status: 'running' } }), undefined)
})
