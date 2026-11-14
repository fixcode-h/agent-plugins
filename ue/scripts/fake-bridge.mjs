// 假的桥接（冒烟测试用）：在本进程里起一个 HTTP 服务，协议和 UE 里的 UELink（原 AgentPanelBridge）一样（GET /info、POST /rpc、令牌头），
// 在 <项目>/Saved/UELink/instances/<PID>.json 写名片。只实现冒烟测试用到的几个操作，状态放在内存里。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { makeCsv, makeMemReport } from './perf-fixtures.mjs'
import { makeDetails } from './fake-details.mjs'

export async function startFakeBridge(root, { kind = 'editor' } = {}) {
  const token = 'fake-token'
  const state = {
    seq: 0,
    lines: [],
    hero: { Health: 80, MaxHealth: 120, bInvincible: false },
    cvars: { 't.MaxFPS': '0' },
    calls: [],
    perf: { csv: false, n: 0, mem: 0 },
    // 假的 UnLua 环境：全局表和 GameInstance 的 Lua 实例表
    lua: {
      global: { GameSystemManager: { Count: 3, Name: 'gsm', Players: { 1: 'alice', 2: 'bob' } } },
      inst: { Gold: 100, Ratio: 0.5, Bag: { Size: 20 } },
      exec: [],
    },
    // 假的蓝图 /Game/BP_Hero：变量、图里的节点、没保存的包、撤销栈（事务 id）
    bp: {
      vars: [{ name: 'MaxHP', type: 'Float' }],
      nodes: ['a1b2c3d4'],
      dirty: new Set(),
      tx: [],
      created: [],
      deleted: [],
    },
  }
  const log = (category, verbosity, text) => state.lines.push({ seq: ++state.seq, category, verbosity, text })
  log('LogInit', 'Display', 'fake bridge up')
  log('LogNet', 'Warning', 'connection timeout (client 2)')
  const HERO = '/Game/Maps/UEDPIE_0_Town.Town:PersistentLevel.BP_Hero_C_1'
  const GI = '/Engine/Transient.GameEngine_0:BP_LuaGameInstance_C_0'
  const BP = '/Game/BP_Hero'
  const details = makeDetails(HERO)
  const packageOf = (p) => String(p ?? '').split('.')[0]
  // 假桥接的 Lua：对象实例表 / 全局表按 keys 往下取（和真桥接一样数字键写成数字）
  const luaRoot = (a) => {
    if (!a.path) return state.lua.global
    if (a.path !== GI) throw new Error(`${a.path} 还没进过 Lua`)
    return state.lua.inst
  }
  const luaWalk = (v, keys) => {
    for (const k of keys) {
      if (typeof v !== 'object' || v === null) throw new Error('不是表')
      v = v[k]
    }
    return v
  }
  const luaDesc = (v) =>
    v === undefined || v === null
      ? { t: 'nil' }
      : typeof v === 'object'
        ? { t: 'table', n: Object.keys(v).length }
        : { t: typeof v, v, ...(Number.isInteger(v) ? { int: true } : {}) }
  const ITEMS = {
    Sword: { Name: '铁剑', Price: 120, Icon: '/Game/UI/T_Sword.T_Sword', Tags: ['Weapon', 'Melee'] },
    Potion: { Name: '治疗药水', Price: 30, Icon: '/Game/UI/T_Potion.T_Potion', Tags: ['Consumable'] },
    Shield: { Name: '木盾', Price: 80, Icon: '/Game/UI/T_Shield.T_Shield', Tags: ['Armor'] },
  }
  const ops = {
    // 资源转文本：真桥接在编辑器里加载那一版；这里只读临时文件（冒烟测试写的是文本），查参数和临时文件的位置
    'asset.textify': (a) => {
      state.textify = (state.textify ?? 0) + 1
      if (!existsSync(a.file)) throw new Error(`没有这个文件：${a.file}`)
      if (!String(a.file).startsWith(root.replaceAll('\\', '/'))) throw new Error('临时文件不在项目目录里')
      return { text: `资源 ${a.package}\n${readFileSync(a.file, 'utf8')}` }
    },
    // Object 页：类下拉（classes）、按类和名字前缀找对象（objects，Actor 带显示名和关卡）
    classes: (a) => ({
      items: [
        { name: 'Character', path: '/Script/Engine.Character', parent: 'Pawn', actor: true },
        { name: 'BP_Hero_C', path: '/Game/BP_Hero.BP_Hero_C', parent: 'Character', actor: true },
        { name: 'GameInstance', path: '/Script/Engine.GameInstance', parent: 'Object', actor: false },
        {
          name: 'MaterialInterface',
          path: '/Script/Engine.MaterialInterface',
          parent: 'Object',
          actor: false,
          mat: true,
        },
        {
          name: 'MaterialInstanceConstant',
          path: '/Script/Engine.MaterialInstanceConstant',
          parent: 'MaterialInstance',
          actor: false,
          mat: true,
        },
      ]
        .filter((c) => (a.base ? c.mat : a.q) && (!a.q || c.name.toLowerCase().includes(String(a.q).toLowerCase())))
        .map(({ mat: _m, ...c }) => c),
      more: false,
    }),
    objects: (a) => {
      const all = [
        {
          path: HERO,
          name: 'BP_Hero_C_1',
          class: 'BP_Hero_C',
          kind: 'instance',
          actor: true,
          label: 'BP_Hero',
          level: 'Town',
          player: true,
          is: ['', 'Actor', 'Pawn', 'Character', 'BP_Hero_C'],
        },
        {
          path: GI,
          name: 'BP_LuaGameInstance_C_0',
          class: 'BP_LuaGameInstance_C',
          kind: 'instance',
          is: ['', 'GameInstance'],
        },
        // 给函数参数选材质：assets=true 时才列资源，没加载的标 unloaded
        ...(a.assets
          ? [
              {
                path: '/Game/Materials/MI_Tire.MI_Tire',
                name: 'MI_Tire',
                class: 'MaterialInstanceConstant',
                kind: 'asset',
                is: ['MaterialInterface', 'MaterialInstanceConstant'],
              },
              {
                path: '/Game/Materials/MI_Tire_Wet.MI_Tire_Wet',
                name: 'MI_Tire_Wet',
                class: 'MaterialInstanceConstant',
                kind: 'unloaded',
                is: ['MaterialInterface', 'MaterialInstanceConstant'],
              },
            ]
          : []),
      ]
      const cls = String(a.class ?? '')
        .split('.')
        .pop()
      const pre = String(a.prefix ?? '').toLowerCase()
      if (!cls && !pre) throw new Error('要给类名或名字前缀')
      return {
        items: all
          .filter(
            (o) =>
              o.is.includes(cls) && (o.name.toLowerCase().startsWith(pre) || !!o.label?.toLowerCase().startsWith(pre)),
          )
          .map(({ is: _is, ...o }) => o),
        more: false,
        partial: !cls,
      }
    },
    // 函数执行弹窗：all=true 时列出受保护 / 私有、非蓝图函数；any=true 才能调非蓝图函数
    functions: (a) => ({
      items: [
        {
          name: 'SetMaterial',
          owner: 'BP_Hero_C',
          category: 'Rendering',
          tooltip: '换身上的材质',
          params: [
            { name: 'ElementIndex', type: 'int32', out: false },
            {
              name: 'Material',
              type: 'UMaterialInterface*',
              out: false,
              objectClass: 'MaterialInterface',
              objectClassPath: '/Script/Engine.MaterialInterface',
            },
          ],
          ret: '',
          access: 'public',
          blueprint: true,
        },
        {
          name: 'GetHealth',
          owner: 'BP_Hero_C',
          category: 'Health',
          tooltip: '',
          params: [{ name: 'Percent', type: 'float', out: true }],
          ret: 'float',
          access: 'public',
          blueprint: true,
        },
        {
          name: 'OnDamaged',
          owner: 'BP_Hero_C',
          category: '',
          tooltip: '',
          params: [],
          ret: '',
          access: 'protected',
          blueprint: false,
        },
        {
          name: 'ResetCache',
          owner: 'BP_Hero_C',
          category: '',
          tooltip: '',
          params: [],
          ret: 'bool',
          access: 'private',
          blueprint: false,
        },
      ].filter((f) => a.all || f.blueprint),
    }),
    call: (a) => {
      if ((a.function === 'OnDamaged' || a.function === 'ResetCache') && !a.any)
        throw new Error(`${a.function} 不是 BlueprintCallable / Exec 函数，也没标 AgentPanel，不开放调用`)
      if (a.function === 'SetMaterial' && a.args?.Material && !String(a.args.Material).includes('/MI_'))
        throw new Error(`参数 Material 要 MaterialInterface，${a.args.Material} 不是`)
      state.calls.push(`${a.function}(${JSON.stringify(a.args ?? {})})`)
      if (a.function === 'GetHealth')
        return { ret: state.hero.Health, out: { Percent: state.hero.Health / state.hero.MaxHealth }, ms: 0.12 }
      return { ret: a.function === 'ResetCache' ? true : undefined, out: {}, ms: 0.4 }
    },
    'object.refs': (a) => ({
      items:
        a.path === HERO
          ? [
              {
                path: '/Game/Materials/MI_Tire.MI_Tire',
                name: 'MI_Tire',
                class: 'MaterialInstanceConstant',
                kind: 'asset',
                via: 'Mesh.OverrideMaterials[0]',
              },
              {
                path: '/Game/Materials/MI_Body.MI_Body',
                name: 'MI_Body',
                class: 'MaterialInstanceConstant',
                kind: 'asset',
                via: 'BodyMaterial',
              },
            ]
          : [],
      more: false,
    }),
    'asset.classes': (a) => ({
      items: [
        { name: 'Blueprint', path: '/Script/Engine.Blueprint', count: 1 },
        { name: 'DataTable', path: '/Script/Engine.DataTable', count: 1 },
        { name: 'InputAction', path: '/Script/EnhancedInput.InputAction', count: 1 },
      ].filter((c) => c.name.toLowerCase().includes(String(a.q ?? '').toLowerCase())),
      more: false,
    }),
    'lua.objects': (a) => ({
      items:
        !a.module || 'Game.Core.GameInstance'.toLowerCase().includes(String(a.module).toLowerCase())
          ? [
              {
                path: GI,
                name: 'BP_LuaGameInstance_C_0',
                class: 'BP_LuaGameInstance_C',
                module: 'Game.Core.GameInstance',
              },
            ]
          : [],
      more: false,
      bound: 1,
    }),
    'lua.get': (a) => {
      const v = luaWalk(luaRoot(a), a.keys ?? [])
      const out = { value: luaDesc(v) }
      if (a.path)
        out.object = {
          path: GI,
          name: 'BP_LuaGameInstance_C_0',
          class: 'BP_LuaGameInstance_C',
          module: 'Game.Core.GameInstance',
          bound: true,
        }
      if (typeof v === 'object' && v !== null) {
        const keys = Object.keys(v)
        out.fields = keys.map((k) => ({
          k,
          kt: /^\d+$/.test(k) ? 'number' : 'string',
          ...(/^\d+$/.test(k) ? { kn: Number(k) } : {}),
          ...luaDesc(v[k]),
        }))
        out.total = keys.length
        out.more = false
        if (a.path && !(a.keys ?? []).length)
          out.functions = [{ name: 'ReceiveBeginPlay', src: 'Game/Core/GameInstance.lua:12' }]
      }
      return out
    },
    'lua.set': (a) => {
      const keys = a.keys ?? []
      const parent = luaWalk(luaRoot(a), keys.slice(0, -1))
      const k = keys[keys.length - 1]
      const prev = parent[k] ?? null
      if (typeof prev === 'object' && prev !== null) throw new Error('只能改数字、字符串、布尔或 nil 的字段')
      parent[k] = a.value
      return { prev, value: a.value, type: luaDesc(a.value).t }
    },
    'lua.exec': (a) => {
      state.lua.exec.push(a.code)
      if (/error\(/.test(a.code)) throw new Error('[string "AgentPanel"]:1: boom')
      return { results: [{ t: 'number', v: 42, int: true }], output: ['hello'], ms: 0.3 }
    },
    console: (a) => {
      state.calls.push(a.command)
      log('LogConsole', 'Log', `ran ${a.command}`)
      // 性能抓取：和引擎一样把文件写进 Saved/Profiling，不在输出里说写到哪了（面板要自己找新文件）
      const prof = path.join(root, 'Saved', 'Profiling')
      if (/^csvprofile start/i.test(a.command)) state.perf.csv = true
      if (/^csvprofile stop/i.test(a.command) && state.perf.csv) {
        state.perf.csv = false
        mkdirSync(path.join(prof, 'CSV'), { recursive: true })
        writeFileSync(path.join(prof, 'CSV', `Profile(${++state.perf.n}).csv`), makeCsv())
      }
      if (/^memreport/i.test(a.command)) {
        const dir = path.join(prof, 'MemReports', 'Fake-Windows-01.01-00.00.00')
        mkdirSync(dir, { recursive: true })
        // 第二份起背包控件多 40 个：模拟进出场景后没释放
        const extra = state.perf.mem++ ? { WBP_Bag_C: 40 } : {}
        writeFileSync(path.join(dir, `Town-${state.perf.mem}.memreport`), makeMemReport({ extra }))
      }
      return { output: [`ran ${a.command}`], world: 'pie0' }
    },
    cvars: () => ({
      items: Object.entries(state.cvars).map(([name, value]) => ({
        name,
        kind: 'var',
        value,
        setBy: 'Console',
        help: '',
      })),
      total: 1,
    }),
    'cvar.set': (a) => {
      const prev = state.cvars[a.name]
      state.cvars[a.name] = String(a.value)
      return { prev, prevSetBy: 'Constructor', value: state.cvars[a.name] }
    },
    'gm.list': () => ({
      items: [
        {
          name: 'God',
          owner: 'CheatManager',
          category: 'Cheat',
          tooltip: '',
          source: 'exec',
          server: false,
          params: [],
        },
      ],
    }),
    'gm.run': (a) => ({ output: [`gm ${a.name}`] }),
    actors: (a) => ({
      items: 'BP_Hero_C_1'.toLowerCase().startsWith(String(a.prefix).toLowerCase())
        ? [{ path: HERO, name: 'BP_Hero_C_1', class: 'BP_Hero_C', label: 'BP_Hero', level: 'Town', player: true }]
        : [],
      more: false,
      world: 'pie0',
    }),
    components: (a) => ({
      items:
        a.path === HERO
          ? [
              {
                path: `${HERO}.CapsuleComponent`,
                name: 'CapsuleComponent',
                class: 'CapsuleComponent',
                parent: '',
                root: true,
                scene: true,
                created: 'native',
              },
              {
                path: `${HERO}.Mesh`,
                name: 'Mesh',
                class: 'SkeletalMeshComponent',
                parent: `${HERO}.CapsuleComponent`,
                root: false,
                scene: true,
                created: 'native',
              },
              {
                path: `${HERO}.BackSpringArm`,
                name: 'BackSpringArm',
                class: 'SpringArmComponent',
                parent: `${HERO}.Mesh`,
                root: false,
                scene: true,
                created: 'blueprint',
              },
              {
                path: `${HERO}.BackCamera`,
                name: 'BackCamera',
                class: 'CameraComponent',
                parent: `${HERO}.BackSpringArm`,
                root: false,
                scene: true,
                created: 'blueprint',
              },
              {
                path: `${HERO}.Chasis_Main`,
                name: 'Chasis_Main',
                class: 'StaticMeshComponent',
                parent: `${HERO}.Mesh`,
                root: false,
                scene: true,
                created: 'blueprint',
              },
              {
                path: `${HERO}.Headlight_L`,
                name: 'Headlight_L',
                class: 'SpotLightComponent',
                parent: `${HERO}.Mesh`,
                root: false,
                scene: true,
                created: 'blueprint',
              },
              {
                path: `${HERO}.Headlight_R`,
                name: 'Headlight_R',
                class: 'SpotLightComponent',
                parent: `${HERO}.Mesh`,
                root: false,
                scene: true,
                created: 'blueprint',
              },
              {
                path: `${HERO}.Health`,
                name: 'Health',
                class: 'BP_HealthComponent_C',
                parent: '',
                root: false,
                scene: false,
                created: 'blueprint',
              },
              {
                path: `${HERO}.CharMoveComp`,
                name: 'CharMoveComp',
                class: 'CharacterMovementComponent',
                parent: '',
                root: false,
                scene: false,
                created: 'native',
              },
            ]
          : [],
    }),
    props: (a) => details.props(a, state.hero),
    get: (a) =>
      details.has(a.path) && !(a.prop in state.hero)
        ? details.get(a, state.hero)
        : { value: state.hero[a.prop], type: 'float' },
    set: (a) => {
      const r = details.has(a.path) ? details.set(a, state.hero) : null
      if (r) return r
      if (!(a.prop in state.hero)) throw new Error(`没有属性 ${a.prop}`)
      const prev = state.hero[a.prop]
      state.hero[a.prop] = a.value
      return { prev, value: a.value, asset: false, replicated: true, client: false }
    },
    'log.tail': (a) => {
      const since = Number(a.since) || 0
      const lines = state.lines.filter((l) => l.seq > since && (!a.contains || l.text.includes(a.contains)))
      return {
        lines,
        cursor: state.seq,
        dropped: 0,
        errors: 0,
        warnings: 1,
        file: path.join(root, 'Saved', 'Logs', 'Fake.log'),
      }
    },
    'log.clear': () => {
      const size = state.lines.length
      state.lines = []
      log('LogAgentPanel', 'Display', 'cleared')
      return { file: path.join(root, 'Saved', 'Logs', 'Fake.log'), size, backup: '', cursor: state.seq }
    },
    screenshot: () => ({ png: 'iVBORw0KGgo=', width: 1, height: 1, world: 'pie0' }),
    assets: () => ({
      items: [
        { path: '/Game/BP_Hero.BP_Hero', name: 'BP_Hero', class: 'Blueprint' },
        { path: '/Game/DT_Items.DT_Items', name: 'DT_Items', class: 'DataTable' },
        { path: '/Game/Input/IA_LookAround.IA_LookAround', name: 'IA_LookAround', class: 'InputAction' },
      ],
      total: 3,
    }),
    // 数据表（对话里点 .uasset 的查看窗口、资源分区的表格）
    datatable: (a) => {
      if (a.path !== '/Game/DT_Items.DT_Items') throw new Error(`找不到数据表 ${a.path}`)
      const f = String(a.filter ?? '').toLowerCase()
      const rows = Object.entries(ITEMS).filter(([n, v]) => !f || (n + JSON.stringify(v)).toLowerCase().includes(f))
      return {
        struct: 'FItemRow',
        columns: [
          { name: 'Name', type: 'FText', complex: false },
          { name: 'Price', type: 'int32', complex: false },
          { name: 'Icon', type: 'TSoftObjectPtr<UTexture2D>', complex: false },
          { name: 'Tags', type: 'TArray<FName>', complex: true },
        ],
        rows: rows.map(([name, values]) => ({ name, values })),
        total: rows.length,
        dirty: false,
      }
    },
    'datatable.row': (a) => {
      if (!ITEMS[a.row]) throw new Error(`找不到行 ${a.row}`)
      return { props: Object.entries(ITEMS[a.row]).map(([name, value]) => ({ name, type: typeof value, value })) }
    },
    // ----- 资源通用层和蓝图（只模拟参数、事务 id 和脏包；真正的图表和编译只有引擎里有） -----
    'asset.describe': (a) => ({
      path: a.path,
      name: 'BP_Hero',
      class: 'Blueprint',
      classChain: ['BlueprintCore', 'Object'],
      package: BP,
      file: path.join(root, 'Content', 'BP_Hero.uasset'),
      onDisk: true,
      size: 1234,
      dirty: state.bp.dirty.has(BP),
      tags: { ParentClass: '/Script/Engine.Character' },
      subobjects: [],
      subobjectCount: 0,
      dependencies: 1,
      referencers: 1,
    }),
    'asset.refs': () => ({
      package: BP,
      dependencies: [{ package: '/Game/DT_Items', level: 1 }],
      dependencyTotal: 1,
      referencers: [{ package: '/Game/Maps/Town', level: 1 }],
      referencerTotal: 1,
    }),
    'asset.create': (a) => {
      if (!a.dryRun) {
        state.bp.created.push(a.path)
        state.bp.dirty.add(a.path)
      }
      return { path: `${a.path}.${a.path.split('/').pop()}`, class: a.class, dryRun: !!a.dryRun }
    },
    'asset.duplicate': (a) => ({ path: `${a.to}.${a.to.split('/').pop()}`, dryRun: !!a.dryRun }),
    'asset.delete': (a) => {
      const referencers = a.path === BP ? ['/Game/Maps/Town'] : []
      if (a.dryRun) return { package: a.path, referencers, referencerTotal: referencers.length, dryRun: true }
      if (referencers.length && !a.force) throw new Error(`${a.path} 还被 1 个资源引用，没有删：/Game/Maps/Town`)
      state.bp.deleted.push(a.path)
      return { package: a.path, file: '', onDisk: false, referencers, referencerTotal: referencers.length }
    },
    'asset.dirty': () => ({
      items: [...state.bp.dirty].map((p) => ({ package: p, file: `${p}.uasset`, readOnly: false, isNew: false })),
    }),
    'asset.save': (a) => {
      // 真桥接回写回的磁盘文件；这里按 /Game → Content 拼出来
      const pkgs = a.packages?.length ? a.packages : [...state.bp.dirty]
      const saved = pkgs.map(
        (p) =>
          path.join(
            root,
            'Content',
            ...String(p)
              .replace(/^\/Game\//, '')
              .split('.')[0]
              .split('/'),
          ) + '.uasset',
      )
      state.bp.dirty.clear()
      return { saved }
    },
    'asset.undo': (a) => {
      if (state.bp.tx.at(-1)?.id !== a.tx) throw new Error('这一步不在撤销栈顶')
      state.bp.tx.pop().undo()
      return { undone: true }
    },
    'bp.outline': (a) => {
      if (packageOf(a.path) !== BP) throw new Error(`${a.path} 不是蓝图`)
      return {
        path: `${BP}.BP_Hero`,
        name: 'BP_Hero',
        parent: '/Script/Engine.Character',
        status: 'ok',
        dirty: state.bp.dirty.has(BP),
        interfaces: [],
        variables: state.bp.vars.map((v) => ({ ...v, instanceEditable: true })),
        dispatchers: [],
        components: [
          { name: 'Health', class: 'BP_HealthComponent_C', template: `${BP}.BP_Hero_C:Health_GEN_VARIABLE` },
        ],
        graphs: [{ name: 'EventGraph', kind: 'event', nodes: state.bp.nodes.length }],
        timelines: [],
        compile: { status: 'ok', nodes: [] },
      }
    },
    'bp.graph': (a) =>
      a.node
        ? {
            graph: 'EventGraph',
            node: {
              id: a.node,
              kind: 'event',
              title: 'Event BeginPlay',
              pins: [{ name: 'then', dir: 'out', type: 'exec' }],
            },
          }
        : a.format === 'json'
          ? {
              graph: 'EventGraph',
              kind: 'event',
              total: state.bp.nodes.length,
              nodes: state.bp.nodes.map((id) => ({ id, kind: 'other', title: id, pins: [] })),
            }
          : {
              graph: 'EventGraph',
              kind: 'event',
              total: state.bp.nodes.length,
              pseudo: 'Event ReceiveBeginPlay()  #a1b2c3d4\n  HP = MaxHP  #0f3e77a1',
              more: false,
            },
    'bp.node_search': (a) => ({
      items: [
        {
          spawner: 'f00dfeed',
          name: `Print String (${a.query})`,
          category: 'Development',
          nodeClass: 'K2Node_CallFunction',
        },
      ],
      total: 1,
    }),
    'bp.find': (a) => ({
      items: [{ blueprint: `${BP}.BP_Hero`, graph: 'EventGraph', node: 'a1b2c3d4', kind: 'call', title: a.query }],
      matched: 1,
      scanned: 1,
      blueprints: 1,
      partial: false,
    }),
    'bp.edit': (a) => {
      const before = { vars: [...state.bp.vars], nodes: [...state.bp.nodes] }
      const results = []
      for (const [i, o] of a.ops.entries()) {
        if (o.op === 'add_variable') state.bp.vars.push({ name: o.name, type: o.type })
        else if (o.op === 'add_node') {
          const id = `n${state.bp.nodes.length}0000000`.slice(0, 8)
          state.bp.nodes.push(id)
          results.push({ op: o.op, node: id, as: o.as })
          continue
        } else if (o.op !== 'connect') {
          // 和真桥接一样：任一步失败整批取消
          Object.assign(state.bp, before)
          throw new Error(`第 ${i + 1} 个操作（${o.op}）失败：不认识的操作 ${o.op}。整批已取消，蓝图没有变化`)
        }
        results.push({ op: o.op })
      }
      const compile = { status: 'ok', errors: 0, warnings: 0, messages: [], nodes: [], affected: [] }
      if (a.dryRun) {
        Object.assign(state.bp, before)
        return { path: a.path, dryRun: true, results, compile }
      }
      const tx = `tx${state.bp.tx.length + 1}`
      state.bp.tx.push({ id: tx, undo: () => Object.assign(state.bp, before) })
      state.bp.dirty.add(BP)
      return { path: a.path, dryRun: false, results, compile, tx }
    },
    'bp.compile': (a) => ({
      path: a.path,
      compile: { status: 'ok', errors: 0, warnings: 0, messages: [], nodes: [], affected: [] },
    }),
  }
  const server = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers['x-agentpanel-token'] !== token) return send(401, { ok: false, error: 'bad token' })
    if (req.method === 'GET' && req.url === '/info')
      return send(200, {
        ok: true,
        kind,
        pid: process.pid,
        log: path.join(root, 'Saved', 'Logs', 'Fake.log'),
        lua: { available: true, version: 'Lua 5.4.6' },
        worlds: [
          { id: 'editor', type: 'Editor', netMode: 'Standalone', map: 'Town' },
          { id: 'pie0', type: 'PIE', netMode: 'ListenServer', pieInstance: 0, map: 'Town' },
        ],
      })
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const { op, args } = JSON.parse(body)
        if (!ops[op])
          return send(200, { ok: false, error: `这个进程不支持 ${op}（编辑器专用的操作要在编辑器或后台编辑器里执行）` })
        send(200, { ok: true, ...ops[op](args ?? {}) })
      } catch (e) {
        send(200, { ok: false, error: e.message })
      }
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const dir = path.join(root, 'Saved', 'UELink', 'instances')
  mkdirSync(dir, { recursive: true })
  const card = path.join(dir, `${process.pid}.json`)
  writeFileSync(
    card,
    JSON.stringify({
      pid: process.pid,
      port,
      token,
      kind,
      engine: '5.4.4',
      bridge: '1.0.0',
      project: root,
      startedAt: new Date().toISOString(),
    }),
  )
  return {
    state,
    hero: HERO,
    gi: GI,
    bp: BP,
    stop: () => {
      rmSync(card, { force: true })
      return new Promise((r) => server.close(r))
    },
  }
}
