// 阻挡界面输入框的控件蓝图候选。用法：node --test ue/web/sections/uekit/gt-widget-match.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toAsset, type LoadedIndex } from '../../jump/index-match.ts'
import { matchWidgets } from './gt-widget-match.ts'

const idx: LoadedIndex = {
  version: '1',
  assets: [
    toAsset(['/Game/UI/Notice/WBP_Notice.WBP_Notice', 'WidgetBlueprint', 'UserWidget']),
    toAsset(['/Game/UI/Guide/WBP_Guide.WBP_Guide', 'Blueprint', 'BaseWidget']),
    toAsset(['/Game/UI/Old/WBP_Guide.WBP_Guide', 'WidgetBlueprint', 'UserWidget']),
    toAsset(['/Game/UI/W_Reconnect.W_Reconnect', '']),
    toAsset(['/Game/Editor/EUW_Tools.EUW_Tools', 'EditorUtilityWidgetBlueprint', 'EditorUtilityWidget']),
    toAsset(['/Game/Characters/BP_Notice.BP_Notice', 'Blueprint', 'Actor']),
    toAsset(['/Game/Data/DT_Notice.DT_Notice', '']),
  ],
  lua: [],
  source: { assets: 'uetovs', lua: 'none' },
}

test('只列控件蓝图：认出的、父类像控件的、扫磁盘按名字猜的', () => {
  const r = matchWidgets(idx, '', 50)
  assert.deepEqual(
    r.rows.map((x) => x.pkg),
    ['/Game/UI/Guide/WBP_Guide', '/Game/UI/Old/WBP_Guide', '/Game/UI/Notice/WBP_Notice', '/Game/UI/W_Reconnect'],
  )
  assert.equal(r.all, 4)
  assert.equal(r.rows[3].sure, false)
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
