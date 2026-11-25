import { buildPackage, v, writeTagged, type PropSpec } from './pack.ts'

/**
 * 单测用的一对蓝图：BP_Base（C++ 父类 Actor，加了组件 Mesh，类默认值 Health=100、Speed=1）和继承它的 BP_Child
 * （类默认值只改了 Speed=5，在 InheritableComponentHandler 里改了 Mesh 的 bHiddenInGame）。
 * 文件里各自只有改过的值，测原型链合并（server/uasset/defaults/resolve.ts）和父蓝图的组件。
 */

const obj = (name: string, ref: number): PropSpec => ({
  name,
  type: ['ObjectProperty', [['Object'], ['/Script/CoreUObject']]],
  value: v.ref(ref),
})
const int = (name: string, x: number): PropSpec => ({ name, type: ['IntProperty'], value: v.int(x) })
const cls = (name: string, outer = -1) => ({ classPackage: '/Script/CoreUObject', className: 'Class', outer, name })

export const BASE = '/Game/BP/BP_Base'
export const CHILD = '/Game/BP/BP_Child'

export const baseBlueprint = () =>
  buildPackage({
    packageName: BASE,
    imports: [
      { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: '/Script/Engine' },
      cls('Blueprint'),
      cls('BlueprintGeneratedClass'),
      cls('Actor'),
      cls('StaticMeshComponent'),
      cls('SimpleConstructionScript'),
      cls('SCS_Node'),
    ],
    exports: [
      {
        name: 'BP_Base',
        classIndex: -2,
        props: [obj('ParentClass', -4), obj('GeneratedClass', 2), obj('SimpleConstructionScript', 5)],
      },
      { name: 'BP_Base_C', classIndex: -3, superIndex: -4, props: [] },
      { name: 'Default__BP_Base_C', classIndex: 2, cdo: true, props: [int('Health', 100), int('Speed', 1)] },
      {
        name: 'Mesh_GEN_VARIABLE',
        classIndex: -5,
        outer: 2,
        props: [{ name: 'CastShadow', type: ['BoolProperty'], bool: false }],
      },
      {
        name: 'SimpleConstructionScript_0',
        classIndex: -6,
        outer: 2,
        props: [
          {
            name: 'RootNodes',
            type: ['ArrayProperty', [['ObjectProperty', [['Object'], ['/Script/CoreUObject']]]]],
            value: v.ints([6]),
          },
        ],
      },
      {
        name: 'SCS_Node_0',
        classIndex: -7,
        outer: 5,
        props: [
          obj('ComponentTemplate', 4),
          { name: 'InternalVariableName', type: ['NameProperty'], value: v.name('Mesh') },
        ],
      },
    ],
  })

export const childBlueprint = () =>
  buildPackage({
    packageName: CHILD,
    imports: [
      { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: '/Script/Engine' },
      cls('Blueprint'),
      cls('BlueprintGeneratedClass'),
      cls('StaticMeshComponent'),
      cls('InheritableComponentHandler'),
      { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: BASE },
      { classPackage: '/Script/Engine', className: 'BlueprintGeneratedClass', outer: -6, name: 'BP_Base_C' },
    ],
    exports: [
      { name: 'BP_Child', classIndex: -2, props: [obj('ParentClass', -7), obj('GeneratedClass', 2)] },
      { name: 'BP_Child_C', classIndex: -3, superIndex: -7, props: [obj('InheritableComponentHandler', 4)] },
      { name: 'Default__BP_Child_C', classIndex: 2, cdo: true, props: [int('Speed', 5)] },
      {
        name: 'InheritableComponentHandler_0',
        classIndex: -5,
        outer: 2,
        props: [
          {
            name: 'Records',
            type: ['ArrayProperty', [['StructProperty', [['ComponentOverrideRecord'], ['/Script/Engine']]]]],
            value: (w, n) => {
              w.i32(1)
              writeTagged(w, n, [obj('ComponentTemplate', 5)])
            },
          },
        ],
      },
      {
        name: 'Mesh_GEN_VARIABLE',
        classIndex: -4,
        outer: 2,
        props: [{ name: 'bHiddenInGame', type: ['BoolProperty'], bool: true }],
      },
    ],
  })
