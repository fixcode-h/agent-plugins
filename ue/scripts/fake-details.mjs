// 假桥接里细节面板用的对象：照真实的 InputAction 资源、Actor 和它的根组件造属性（显示名、分类、高级、内部、只读、枚举、数组），
// 本机看细节面板效果用；冒烟测试只碰 Health 那几个，不受影响。props / get / set（含 array 数组按钮、Stats.MaxHP、Items[2] 路径）照桥接 1.5.0 的协议回
const p = (name, type, value, o = {}) => ({ name, type, value, edit: true, readOnly: false, ...o })

export function makeDetails(HERO) {
  const IA = '/Game/Input/IA_LookAround.IA_LookAround'
  const ROOT = `${HERO}.CapsuleComponent`
  const objs = {
    [IA]: {
      object: { path: IA, name: 'IA_LookAround', class: 'InputAction' },
      kind: 'asset',
      props: [
        p('ActionDescription', 'FText', '', { category: 'Description', displayName: 'Action Description' }),
        p('bTriggerWhenPaused', 'bool', true, { category: 'Action', displayName: 'Trigger when Paused' }),
        p('bReserveAllMappings', 'bool', false, { category: 'Action', displayName: 'Reserve All Mappings' }),
        p('ValueType', 'EInputActionValueType', 'Axis1D', {
          category: 'Action',
          displayName: 'Value Type',
          enum: ['Boolean', 'Axis1D', 'Axis2D', 'Axis3D'],
          enumLabels: ['Digital (bool)', 'Axis1D (float)', 'Axis2D (Vector2D)', 'Axis3D (Vector)'],
        }),
        p('Triggers', 'TArray<UInputTrigger*>', [], {
          category: 'Action',
          displayName: 'Triggers',
          container: 'array',
          count: 0,
          inner: 'UInputTrigger*',
        }),
        p('Modifiers', 'TArray<UInputModifier*>', [], {
          category: 'Action',
          displayName: 'Modifiers',
          container: 'array',
          count: 0,
          inner: 'UInputModifier*',
        }),
        p('AccumulationBehavior', 'EInputActionAccumulationBehavior', 'TakeHighestAbsoluteValue', {
          category: 'Action',
          displayName: 'Accumulation Behavior',
          advanced: true,
          enum: ['TakeHighestAbsoluteValue', 'Cumulative'],
          enumLabels: ['Take Highest Absolute Value', 'Cumulative'],
        }),
        p('bConsumeInput', 'bool', true, {
          category: 'Input Consumption',
          displayName: 'Consume Lower Priority Enhanced Input Mappings',
        }),
        p('bConsumesActionAndAxisMappings', 'bool', false, {
          category: 'Input Consumption',
          displayName: 'Consumes Action and Axis Mappings',
        }),
        p('TriggerEventsThatConsumeLegacyKeys', 'int32', 0, {
          category: 'Input Consumption',
          displayName: 'Trigger Events That Consume Legacy Keys',
          readOnly: true,
          readOnlyWhy: '只读属性（EditConst）',
          enum: ['0'],
          enumLabels: ['（未设置标记）'],
        }),
        p('PlayerMappableKeySettings', 'UPlayerMappableKeySettings*', null, {
          category: 'User Settings',
          displayName: 'Player Mappable Key Settings',
        }),
      ],
    },
    [ROOT]: {
      object: { path: ROOT, name: 'CapsuleComponent', class: 'CapsuleComponent' },
      kind: 'instance',
      props: [
        p(
          'RelativeLocation',
          'FVector',
          { x: 4450.092503, y: 0.029897, z: 25.311674 },
          { category: 'Transform', displayName: 'Location' },
        ),
        p(
          'RelativeRotation',
          'FRotator',
          { pitch: 0.319376, yaw: 90.001892, roll: -0.005929 },
          { category: 'Transform', displayName: 'Rotation' },
        ),
        p('RelativeScale3D', 'FVector', { x: 1, y: 1, z: 1 }, { category: 'Transform', displayName: 'Scale' }),
        p('CapsuleHalfHeight', 'float', 88, { category: 'Shape', displayName: 'Capsule Half Height' }),
        p('CapsuleRadius', 'float', 34, { category: 'Shape', displayName: 'Capsule Radius' }),
        p('bHiddenInGame', 'bool', true, { category: 'Rendering', displayName: 'Hidden in Game' }),
      ],
    },
  }
  // Actor 本身：前面接冒烟测试用的 Health 那几个（值从 state.hero 取），后面是照 Pawn 造的
  const heroExtra = [
    p('RootComponent', 'USceneComponent*', ROOT, {
      category: '',
      edit: false,
      readOnly: true,
      readOnlyWhy: '编辑器和蓝图里都不能改的内部状态，只能看',
    }),
    p('bUseControllerRotationPitch', 'bool', false, { category: 'Pawn', displayName: 'Use Controller Rotation Pitch' }),
    p('bUseControllerRotationYaw', 'bool', false, { category: 'Pawn', displayName: 'Use Controller Rotation Yaw' }),
    p('AutoPossessPlayer', 'EAutoReceiveInput::Type', 'Disabled', {
      category: 'Pawn',
      displayName: 'Auto Possess Player',
      enum: ['Disabled', 'Player0', 'Player1'],
      enumLabels: ['Disabled', 'Player 0', 'Player 1'],
    }),
    p('AIControllerClass', 'TSubclassOf<AController>', '/Script/AIModule.AIController', {
      category: 'Pawn',
      displayName: 'AI Controller Class',
    }),
    p('BaseEyeHeight', 'float', 64, { category: 'Camera', displayName: 'Base Eye Height' }),
    p('RemoteRole', 'TEnumAsByte<ENetRole>', 'ROLE_SimulatedProxy', {
      category: 'Replication',
      displayName: 'Remote Role',
      readOnly: true,
      readOnlyWhy: '只读属性（EditConst）',
      enum: ['ROLE_None', 'ROLE_SimulatedProxy', 'ROLE_AutonomousProxy', 'ROLE_Authority'],
      enumLabels: ['None', 'Simulated Proxy', 'Autonomous Proxy', 'Authority'],
    }),
    p('Role', 'TEnumAsByte<ENetRole>', 'ROLE_Authority', {
      category: 'Replication',
      displayName: 'Role',
      readOnly: true,
      readOnlyWhy: '只读属性（EditConst）',
      enum: ['ROLE_None', 'ROLE_SimulatedProxy', 'ROLE_AutonomousProxy', 'ROLE_Authority'],
      enumLabels: ['None', 'Simulated Proxy', 'Autonomous Proxy', 'Authority'],
    }),
    p('InputPriority', 'int32', 0, { category: 'Input', displayName: 'Input Priority' }),
    p('Tags', 'TArray<FName>', ['Hero', 'Player'], {
      category: 'Actor',
      displayName: 'Tags',
      container: 'array',
      count: 2,
      inner: 'FName',
    }),
    p('Stats', 'FHeroStats', { maxHP: 120, speed: 600, bCanJump: true }, { category: 'Stats', displayName: 'Stats' }),
    p('NetUpdateFrequency', 'float', 100, {
      category: 'Replication',
      displayName: 'Net Update Frequency',
      advanced: true,
    }),
    p(
      'LastHitLocation',
      'FVector',
      { x: 12, y: -3.5, z: 80 },
      { category: '', edit: false, readOnly: true, readOnlyWhy: '编辑器和蓝图里都不能改的内部状态，只能看' },
    ),
    p('PendingSwapConnection', 'UNetConnection*', null, {
      category: '',
      edit: false,
      readOnly: true,
      readOnlyWhy: '编辑器和蓝图里都不能改的内部状态，只能看',
    }),
  ]

  const parse = (s) =>
    String(s)
      .match(/[^.[\]"]+|\["[^"]*"\]|\[\d+\]/g)
      ?.map((x) => x.replace(/^\["|"\]$|^\[|\]$/g, '')) ?? []
  const objOf = (path, hero) => {
    if (path === HERO)
      return {
        object: { path: HERO, name: 'BP_Hero_C_1', class: 'BP_Hero_C' },
        kind: 'instance',
        props: [
          ...Object.entries(hero).map(([name, value]) =>
            p(name, typeof value === 'boolean' ? 'bool' : 'float', value, { category: 'Health', replicated: true }),
          ),
          ...heroExtra,
        ],
      }
    return objs[path]
  }
  // 按属性路径取 / 写：第一段是属性名，后面是结构体成员（不分大小写，和 FName 一样）或数组下标
  const walk = (o, keys) => {
    let cur = o
    for (const k of keys) {
      if (cur === null || typeof cur !== 'object') throw new Error(`没有 ${k}`)
      const hit = Object.keys(cur).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k
      cur = cur[hit]
    }
    return cur
  }
  const assign = (o, keys, v) => {
    const parent = walk(o, keys.slice(0, -1))
    const last = keys.at(-1)
    const hit = Array.isArray(parent)
      ? last
      : (Object.keys(parent).find((x) => x.toLowerCase() === last.toLowerCase()) ?? last)
    parent[hit] = v
  }

  return {
    has: (path) => path === HERO || !!objs[path],
    props(a, hero) {
      const o = objOf(a.path, hero)
      if (!o) throw new Error(`找不到对象 ${a.path}`)
      const f = String(a.filter ?? '').toLowerCase()
      return { ...o, props: o.props.filter((x) => !f || x.name.toLowerCase().startsWith(f)) }
    },
    get(a, hero) {
      const o = objOf(a.path, hero)
      const [name, ...rest] = parse(a.prop)
      const prop = o.props.find((x) => x.name.toLowerCase() === name.toLowerCase())
      if (!prop) throw new Error(`没有属性 ${a.prop}`)
      return { value: walk(prop.value, rest), type: prop.type }
    },
    set(a, hero) {
      if (a.path === HERO && a.prop in hero) return null
      const o = a.path === HERO ? { props: heroExtra } : objs[a.path]
      if (!o) throw new Error(`找不到对象 ${a.path}`)
      const [name, ...rest] = parse(a.prop)
      const prop = o.props.find((x) => x.name.toLowerCase() === name.toLowerCase())
      if (!prop) throw new Error(`没有属性 ${a.prop}`)
      if (prop.readOnly) throw new Error(`不能改 ${prop.readOnlyWhy}`)
      const prev = structuredClone(walk(prop.value, rest))
      if (a.array) {
        const arr = walk(prop.value, rest)
        if (!Array.isArray(arr)) throw new Error(`${a.prop} 不是数组，不能 ${a.array}`)
        const i = Number(a.index)
        const blank = prop.inner?.endsWith('*') ? null : typeof arr[0] === 'number' ? 0 : ''
        if (a.array === 'add') arr.push(blank)
        else if (a.array === 'clear') arr.length = 0
        else if (!(i >= 0 && i < arr.length)) throw new Error(`${a.prop} 只有 ${arr.length} 个元素，没有 [${i}]`)
        else if (a.array === 'insert') arr.splice(i, 0, blank)
        else if (a.array === 'remove') arr.splice(i, 1)
        else if (a.array === 'duplicate') arr.splice(i + 1, 0, structuredClone(arr[i]))
        if (!rest.length) prop.count = arr.length
      } else if (rest.length) assign(prop.value, rest, a.value)
      else prop.value = a.value
      return {
        prev,
        value: walk(prop.value, rest),
        asset: !a.path.includes(':PersistentLevel'),
        replicated: false,
        client: false,
      }
    },
  }
}
