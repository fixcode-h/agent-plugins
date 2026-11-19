// 数据资产、枚举、结构体布局的单测：node --test ue/web/inspect/layouts/dataasset/data-layouts.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prop } from '../../../details/model.ts'
import { parseEnum, shortName } from '../enum/model.ts'
import { parseMembers, pinLabel, shownDefault, stripVarName, typeLabel } from '../struct/model.ts'
import { categoriesOf, inCategory, knownParent } from './model.ts'

const P = (name: string, category: string, extra: Partial<Prop> = {}): Prop => ({
  name,
  type: 'int32',
  category,
  value: 0,
  edit: true,
  ...extra,
})

test('数据资产的分类索引：第一层分类、按出现顺序、内部状态不算', () => {
  const props = [
    P('ConfigName', 'General'),
    P('MaxActors', 'Spawning'),
    P('Version', 'General|Meta'),
    P('Cache', '', { edit: false }),
  ]
  assert.deepEqual(categoriesOf(props), [
    { name: 'General', count: 2 },
    { name: 'Spawning', count: 1 },
  ])
  assert.deepEqual(
    inCategory(props, 'General').map((p) => p.name),
    ['ConfigName', 'Version'],
  )
  assert.equal(inCategory(props, '').length, 4)
  assert.equal(
    knownParent(['PrimaryDataAsset', 'DataAsset', 'Object'], ['PrimaryDataAsset', 'DataAsset']),
    'PrimaryDataAsset',
  )
})

test('枚举条目从 DisplayNameMap 拼出来', () => {
  const props: Prop[] = [
    {
      name: 'DisplayNameMap',
      type: 'TMap<FName,FText>',
      value: { NewEnumerator0: 'Idle', 'E_S::NewEnumerator1': 'Heating' },
    },
    { name: 'EnumDescription', type: 'FText', value: '锻炉状态' },
  ]
  const r = parseEnum(props)
  assert.deepEqual(r.entries, [
    { index: 0, name: 'NewEnumerator0', label: 'Idle' },
    { index: 1, name: 'NewEnumerator1', label: 'Heating' },
  ])
  assert.equal(r.description, '锻炉状态')
  assert.equal(
    parseEnum([{ name: 'DisplayNameMap', type: '', value: [{ key: 'A', value: 'a' }] }]).entries[0].label,
    'a',
  )
  assert.equal(parseEnum([{ name: 'DisplayNameMap', type: '', value: { _truncated: true } }]).truncated, true)
  assert.equal(shortName('E::X'), 'X')
})

test('结构体成员：显示名、类型、默认值', () => {
  const members = parseMembers([
    {
      varName: 'Price_12_0A1B2C3D4E5F60718293A4B5C6D7E8F9',
      friendlyName: 'Price',
      category: 'int',
      containerType: 'None',
      currentDefaultValue: '0',
      toolTip: '售价',
      bEnableSaveGame: true,
    },
    { VarName: 'Tags_3_0A1B2C3D4E5F60718293A4B5C6D7E8F9', Category: 'name', ContainerType: 'Array', DefaultValue: '' },
    { varName: 'Icon', category: 'softobject', subCategoryObject: '/Script/Engine.Texture2D' },
    {
      varName: 'Tint',
      category: 'struct',
      subCategoryObject: '/Script/CoreUObject.LinearColor',
      defaultValue: '(R=1,G=1,B=1,A=1)',
    },
    { varName: 'Label', category: 'text' },
    'junk',
  ])
  assert.deepEqual(
    members.map((m) => [m.name, m.type, shownDefault(m)]),
    [
      ['Price', 'Integer', '0'],
      ['Tags', 'Array of Name', '[]'],
      ['Icon', 'Texture 2D (Soft)', ''],
      ['Tint', 'Linear Color', '(R=1,G=1,B=1,A=1)'],
      ['Label', 'Text', '""'],
    ],
  )
  assert.equal(members[0].flags.saveGame, true)
  assert.equal(members[0].tooltip, '售价')
  assert.equal(stripVarName('A_1_0A1B2C3D4E5F60718293A4B5C6D7E8F9'), 'A')
  assert.equal(pinLabel('byte', '', '/Game/E_ForgeRarity.E_ForgeRarity'), 'E_ForgeRarity')
  assert.equal(pinLabel('real', 'double', ''), 'Float')
  assert.equal(
    typeLabel({ category: 'name', containerType: 'Map', pinValueType: { terminalCategory: 'int' } }),
    'Map of Name to Integer',
  )
})
