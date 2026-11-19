// 材质 / 材质实例布局的纯函数单测：node --test ue/web/inspect/layouts/material/material.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cssColor, groupParams, instanceOverrides, linearColor, materialNodes, paramInfo, paramName } from './model.ts'

const sub = (name: string, cls: string) => ({ path: `/Game/M.M:${name}`, name, class: cls })

test('材质节点：参数单列（颜色、标量、贴图、开关），注释不算，其余按类型', () => {
  const r = materialNodes([
    sub('MaterialExpressionMultiply_1', 'MaterialExpressionMultiply'),
    sub('MaterialExpressionScalarParameter_0', 'MaterialExpressionScalarParameter'),
    sub('MaterialExpressionVectorParameter_0', 'MaterialExpressionVectorParameter'),
    sub('MaterialExpressionTextureSampleParameter2D_0', 'MaterialExpressionTextureSampleParameter2D'),
    sub('MaterialExpressionStaticSwitchParameter_0', 'MaterialExpressionStaticSwitchParameter'),
    sub('MaterialExpressionComment_0', 'MaterialExpressionComment'),
    sub('MaterialExpressionAdd_0', 'MaterialExpressionAdd'),
    sub('M_EditorOnlyData', 'MaterialEditorOnlyData'),
  ])
  assert.deepEqual(
    r.params.map((p) => p.kind),
    ['vector', 'scalar', 'texture', 'switch'],
  )
  assert.deepEqual(
    r.nodes.map((n) => n.type),
    ['Add', 'Multiply'],
  )
  assert.deepEqual(materialNodes(undefined), { params: [], nodes: [] })
})

test('参数节点的属性 → 名字、分组、默认值', () => {
  const [v, s, tex] = materialNodes([
    sub('MaterialExpressionVectorParameter_0', 'MaterialExpressionVectorParameter'),
    sub('MaterialExpressionScalarParameter_0', 'MaterialExpressionScalarParameter'),
    sub('MaterialExpressionTextureSampleParameter2D_0', 'MaterialExpressionTextureSampleParameter2D'),
  ]).params
  const vi = paramInfo(v, { ParameterName: 'Tint', Group: 'Color', DefaultValue: { R: 1, G: 0, B: 0, A: 1 } })
  assert.equal(vi.name, 'Tint')
  assert.equal(vi.group, 'Color')
  assert.equal(vi.value, '1 0 0 1')
  assert.equal(vi.color, 'rgb(255 0 0)')
  assert.equal(paramInfo(s, { ParameterName: 'Glow', Group: 'None', DefaultValue: 4 }).group, undefined)
  assert.equal(paramInfo(s, undefined).name, 'MaterialExpressionScalarParameter_0')
  assert.equal(paramInfo(tex, { ParameterName: 'Icon', Texture: '/Game/T_Icon.T_Icon' }).value, 'T_Icon')
  assert.deepEqual(
    groupParams([
      { name: 'a', group: undefined },
      { name: 'b', group: 'Z' },
      { name: 'c', group: 'A' },
    ]).map(([g]) => g),
    ['A', 'Z', ''],
  )
})

test('材质实例的覆盖：标量、颜色、贴图、静态开关（只算 bOverride），ParameterInfo 两种写法都认', () => {
  const o = instanceOverrides({
    ScalarParameterValues: [{ ParameterInfo: { Name: 'Glow' }, ParameterValue: 8 }],
    VectorParameterValues: [
      { ParameterInfo: '(Name="Tint",Association=GlobalParameter,Index=-1)', ParameterValue: '(R=0.5,G=0.25,B=0,A=1)' },
    ],
    TextureParameterValues: [{ ParameterInfo: { Name: 'Icon' }, ParameterValue: '/Game/T_Red.T_Red' }],
    StaticParametersRuntime: {
      StaticSwitchParameters: [
        { ParameterInfo: { Name: 'UseDetail' }, Value: true, bOverride: true },
        { ParameterInfo: { Name: 'Off' }, Value: false, bOverride: false },
      ],
    },
  })
  assert.deepEqual(
    o.map((x) => [x.kind, x.name, x.value]),
    [
      ['scalar', 'Glow', '8'],
      ['vector', 'Tint', '0.5 0.25 0 1'],
      ['texture', 'Icon', 'T_Red'],
      ['switch', 'UseDetail', 'true'],
    ],
  )
  assert.equal(o[2].ref, '/Game/T_Red.T_Red')
  assert.equal(instanceOverrides(undefined).length, 0)
  assert.equal(paramName('Plain'), 'Plain')
  assert.deepEqual(linearColor('(R=1,G=2,B=3)'), [1, 2, 3, 1])
  assert.equal(linearColor('nope'), undefined)
  // HDR 截到 1，线性转 sRGB
  assert.equal(cssColor([4, 0.5, 0, 1]), 'rgb(255 188 0)')
})
