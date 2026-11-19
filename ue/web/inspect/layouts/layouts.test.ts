// 资源查看布局注册表的单测：node --test ue/web/inspect/layouts/layouts.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LAYOUT_DEFS } from './defs.ts'
import { classOfKind, guessClass, pickLayout } from './pick.ts'
import type { LayoutDef } from './types.ts'

const pick = (cls?: string, classChain?: string[], path = '/Game/UI/X.X') =>
  pickLayout(LAYOUT_DEFS, { cls, classChain, path }).id

test('从具体到一般：控件蓝图先于蓝图，表先于通用', () => {
  assert.equal(pick('WidgetBlueprint', ['BaseWidgetBlueprint', 'Blueprint', 'BlueprintCore', 'Object']), 'umg')
  // 子类按类链认（编辑器工具控件）
  assert.equal(pick('EditorUtilityWidgetBlueprint', ['WidgetBlueprint', 'Blueprint']), 'umg')
  assert.equal(pick('Blueprint', ['BlueprintCore', 'Object']), 'blueprint')
  assert.equal(pick('AnimBlueprint'), 'blueprint')
  assert.equal(pick('DataTable'), 'datatable')
  assert.equal(pick('CompositeDataTable', ['DataTable', 'Object']), 'datatable')
  assert.equal(pick('ForgeConfigData', ['PrimaryDataAsset', 'DataAsset', 'Object']), 'dataasset')
  assert.equal(pick('DataAsset'), 'dataasset')
  assert.equal(pick('UserDefinedEnum', ['Enum', 'Field', 'Object']), 'enum')
  assert.equal(pick('UserDefinedStruct', ['ScriptStruct', 'Struct']), 'struct')
  assert.equal(pick('CurveFloat', ['CurveBase', 'Object']), 'curve')
  assert.equal(pick('CurveLinearColor', ['CurveBase', 'Object']), 'curve')
  assert.equal(pick('CurveTable'), 'curve')
  assert.equal(pick('StaticMesh'), 'static-mesh')
  assert.equal(pick('Material'), 'material')
  assert.equal(
    pick('MaterialInstanceConstant', ['MaterialInstance', 'MaterialInterface', 'Object']),
    'material-instance',
  )
  assert.equal(pick('Texture2D', ['Texture', 'StreamableRenderAsset', 'Object']), 'texture')
  assert.equal(pick('SkeletalMesh'), 'skeletal')
  assert.equal(pick('AnimSequence', ['AnimSequenceBase', 'AnimationAsset', 'Object']), 'skeletal')
  assert.equal(pick('SoundWave', ['SoundBase', 'Object']), 'audio')
  assert.equal(pick('SoundCue'), 'audio')
  assert.equal(pick('NiagaraSystem'), 'niagara')
  // 材质函数不是材质
  assert.equal(pick('MaterialFunction', ['MaterialFunctionInterface', 'Object']), 'generic')
  assert.equal(pick(undefined), 'generic')
})

test('子对象（路径带冒号）不当蓝图看', () => {
  assert.equal(pick('Blueprint', undefined, '/Game/BP_A.BP_A:Comp'), 'generic')
  assert.equal(pick('WidgetBlueprint', undefined, '/Game/W.W:WidgetTree.Btn'), 'generic')
})

test('priority 相同按登记顺序，都不匹配用最后一个', () => {
  const mk = (id: string, priority: number, ok: boolean): LayoutDef => ({
    id,
    label: () => id,
    classes: () => [],
    priority,
    match: () => ok,
    regions: [],
  })
  assert.equal(pickLayout([mk('a', 1, true), mk('b', 1, true), mk('z', 0, true)], { path: '' }).id, 'a')
  assert.equal(pickLayout([mk('z', 0, true), mk('hi', 5, true)], { path: '' }).id, 'hi')
  assert.equal(pickLayout([mk('a', 1, false), mk('z', 0, false)], { path: '' }).id, 'z')
})

test('按路径猜类型、按配置 kind 定类型', () => {
  assert.equal(guessClass('/Game/UI/WBP_Shop.WBP_Shop'), 'WidgetBlueprint')
  assert.equal(guessClass('/Game/Data/DT_Items.DT_Items'), 'DataTable')
  assert.equal(guessClass('/Game/BP_Hero.BP_Hero'), 'Blueprint')
  assert.equal(guessClass('/Game/BP_Hero.BP_Hero:Mesh'), undefined)
  assert.equal(guessClass('/Game/DA_Cfg.DA_Cfg'), 'DataAsset')
  assert.equal(guessClass('/Game/E_State.E_State'), 'UserDefinedEnum')
  assert.equal(guessClass('/Game/S_Click.S_Click'), undefined)
  assert.equal(guessClass('/Game/SM_Rock.SM_Rock'), 'StaticMesh')
  assert.equal(guessClass('/Game/MI_Red.MI_Red'), 'MaterialInstanceConstant')
  assert.equal(guessClass('/Game/M_Glow.M_Glow'), 'Material')
  assert.equal(guessClass('/Game/Rock.Rock'), undefined)
  assert.equal(classOfKind('umg-widget'), 'WidgetBlueprint')
  assert.equal(classOfKind('material'), undefined)
})

test('每个布局的区域 id 不重复，默认尺寸写了单位', () => {
  for (const d of LAYOUT_DEFS) {
    const ids = d.regions.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length, d.id)
    for (const r of d.regions) assert.match(r.size, /^\d+(px|%)$/, `${d.id}.${r.id}`)
  }
  assert.equal(LAYOUT_DEFS.filter((d) => d.priority === 0).length, 1, '只有一个兜底布局')
})
