// 阻挡界面输入框的控件蓝图候选。用法：node --test ue/web/sections/uekit/gt-widget-match.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toAsset, type LoadedIndex } from '../../jump/index-match.ts'
import { matchWidgets } from './gt-widget-match.ts'

const idx: LoadedIndex = {
  version: '1',
  assets: [
    toAsset(['/Game/UI/Notice/WBP_Notice.WBP_Notice', 'WidgetBlueprint', 'UserWidget']),
    toAsset(['/Game/UI/Guide/WBP_Guide.WBP_Guide', 'WidgetBlueprint', 'MyPanelBase']),
    toAsset(['/Game/UI/Fake/WBP_Fake.WBP_Fake', 'Blueprint', 'FancyWidgetActor']),
    toAsset(['/Game/UI/Old/WBP_Guide.WBP_Guide', 'WidgetBlueprint', 'UserWidget']),
    toAsset(['/Game/UI/W_Reconnect.W_Reconnect', '']),
    toAsset(['/Game/Editor/EUW_Tools.EUW_Tools', 'EditorUtilityWidgetBlueprint', 'EditorUtilityWidget']),
    toAsset(['/Game/Characters/BP_Notice.BP_Notice', 'Blueprint', 'Actor']),
    toAsset(['/Game/Data/DT_Notice.DT_Notice', '']),
  ],
  lua: [],
  source: { assets: 'uetovs', lua: 'none' },
}

test('只按继承认控件蓝图：名字像界面、父类名带 Widget 都不算', () => {
  const r = matchWidgets(idx, '', 50)
  assert.deepEqual(
    r.rows.map((x) => x.pkg),
    ['/Game/UI/Guide/WBP_Guide', '/Game/UI/Old/WBP_Guide', '/Game/UI/Notice/WBP_Notice'],
  )
  assert.equal(r.all, 3)
})

test('扫磁盘的索引认不出类型：都列出来，标成没认出', () => {
  const disk: LoadedIndex = {
    ...idx,
    assets: [toAsset(['/Game/UI/Reconnect.Reconnect', '']), toAsset(['/Game/Maps/Main.Main', 'World'])],
    source: { assets: 'disk', lua: 'none' },
  }
  const r = matchWidgets(disk, '', 50)
  assert.deepEqual(
    r.rows.map((x) => [x.pkg, x.sure]),
    [['/Game/UI/Reconnect', false]],
  )
})

test('名字不重复填类名，重名填包路径', () => {
  const r = matchWidgets(idx, 'notice', 50)
  assert.deepEqual(
    r.rows.map((x) => x.value),
    ['WBP_Notice'],
  )
  assert.deepEqual(
    matchWidgets(idx, 'guide', 50).rows.map((x) => x.value),
    ['/Game/UI/Guide/WBP_Guide', '/Game/UI/Old/WBP_Guide'],
  )
})

test('贴资源路径也能搜到，没有索引时返回空', () => {
  assert.equal(matchWidgets(idx, '/Game/UI/Old/WBP_Guide.WBP_Guide', 50).rows[0].pkg, '/Game/UI/Old/WBP_Guide')
  assert.deepEqual(matchWidgets(undefined, 'x', 50), { rows: [], total: 0, all: 0 })
})
