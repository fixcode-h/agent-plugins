import { buildPackage, v, type PackSpec } from './pack.ts'

/** 单测用的几个最小资源：数据资产（带子对象、结构体、数组）、数据表 */

const IMPORTS = [
  { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: '/Script/Game' },
  { classPackage: '/Script/CoreUObject', className: 'Class', outer: -1, name: 'ItemData' },
  { classPackage: '/Script/CoreUObject', className: 'Class', outer: -1, name: 'ItemPart' },
]

export const dataAssetSpec = (pkg = '/Game/Data/DA_Sword'): PackSpec => ({
  packageName: pkg,
  imports: IMPORTS,
  exports: [
    {
      name: pkg.split('/').pop()!,
      classIndex: -2,
      props: [
        { name: 'Damage', type: ['IntProperty'], value: v.int(42) },
        { name: 'Title', type: ['StrProperty'], value: v.str('Sword') },
        { name: 'Enabled', type: ['BoolProperty'], bool: true },
        { name: 'Tags', type: ['ArrayProperty', [['IntProperty']]], value: v.ints([1, 2, 3]) },
        {
          name: 'Size',
          type: ['StructProperty', [['ItemSize'], ['/Script/Game']]],
          value: v.struct([{ name: 'Width', type: ['IntProperty'], value: v.int(5) }]),
        },
        { name: 'Part', type: ['ObjectProperty', [['ItemPart'], ['/Script/Game']]], value: v.ref(2) },
      ],
    },
    {
      name: 'Blade',
      classIndex: -3,
      outer: 1,
      props: [{ name: 'Weight', type: ['FloatProperty'], value: v.float(1.5) }],
    },
  ],
  registry: [{ objectPath: pkg.split('/').pop()!, className: '/Script/Game.ItemData', tags: { Rarity: 'Epic' } }],
})

export const dataAsset = (damage = 42, pkg?: string) => {
  const spec = dataAssetSpec(pkg)
  spec.exports[0].props[0].value = v.int(damage)
  return buildPackage(spec)
}

/** 数据表：两行，行结构 ItemRow（Price 整数、Name 字符串） */
export const dataTable = () =>
  buildPackage({
    packageName: '/Game/Data/DT_Items',
    imports: [
      { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: '/Script/Engine' },
      { classPackage: '/Script/CoreUObject', className: 'Class', outer: -1, name: 'DataTable' },
      { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: '/Script/Game' },
      { classPackage: '/Script/CoreUObject', className: 'ScriptStruct', outer: -3, name: 'ItemRow' },
    ],
    exports: [
      {
        name: 'DT_Items',
        classIndex: -2,
        props: [
          {
            name: 'RowStruct',
            type: ['ObjectProperty', [['ScriptStruct'], ['/Script/CoreUObject']]],
            value: v.ref(-4),
          },
        ],
        tail: (w, n) => {
          w.i32(2)
          n.write(w, 'Apple')
          v.struct([
            { name: 'Price', type: ['IntProperty'], value: v.int(3) },
            { name: 'Label', type: ['StrProperty'], value: v.str('apple') },
          ])(w, n)
          n.write(w, 'Pear')
          v.struct([{ name: 'Price', type: ['IntProperty'], value: v.int(5) }])(w, n)
        },
      },
    ],
  })
