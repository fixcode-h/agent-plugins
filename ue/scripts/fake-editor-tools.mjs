// 假桥接里的编辑器小工具（UELink 2.4：config.*、tags.*、asset.redirectors、editor.spawn / destroy），冒烟测试用。
// 单独一个文件，fake-bridge.mjs 只把它展开进 ops。
export function editorToolOps(state) {
  state.tools = { spawned: [], destroyed: [], fixed: false }
  // 编辑器打开的地图和 PIE（UELink 2.22 editor.map、pie）：/info 的 worlds 按它算（fake-bridge.mjs），默认 Town + PIE 在跑
  const MAPS = ['/Game/Maps/Town', '/Game/Maps/Arena', '/Game/Test/Arena']
  state.map = { package: '/Game/Maps/Town', pie: true, pieMap: '', dirty: [], last: undefined }
  const short = (p) => p.split('/').pop()
  const resolve = (m) => {
    const name = String(m ?? '').split('.')[0]
    if (name.startsWith('/')) {
      if (!MAPS.includes(name)) throw new Error(`找不到地图 ${name}`)
      return name
    }
    const hits = MAPS.filter((p) => p.endsWith(`/${name}`))
    if (hits.length !== 1)
      throw new Error(
        hits.length
          ? `有 ${hits.length} 张地图叫 ${name}，写全包名再开：${hits.join('、')}`
          : `项目里没有叫 ${name} 的地图`,
      )
    return hits[0]
  }
  return {
    'editor.map': (a) => {
      const m = state.map
      if (a.action === 'status')
        return {
          package: m.package,
          map: short(m.package),
          pie: m.pie,
          ...(m.dirty.length && { dirty: m.dirty, dirtyCount: m.dirty.length }),
          ...(m.last && { last: m.last }),
        }
      if (m.pie) throw new Error('PIE 正在运行：先停掉 PIE 再打开地图')
      const pkg = resolve(a.map)
      if (pkg === m.package && !a.reload) return { package: pkg, previous: m.package, already: true, started: false }
      if (m.dirty.length && a.unsaved !== 'discard') throw new Error(`当前关卡有 ${m.dirty.length} 个包改了没保存`)
      const discarded = m.dirty.length ? m.dirty : undefined
      m.dirty = []
      const previous = m.package
      m.package = pkg
      m.last = { package: pkg, previous, ok: true, ms: 1200 }
      return { started: true, package: pkg, previous, ...(discarded && { discarded }) }
    },
    pie: (a) => {
      const m = state.map
      if (a.action === 'start') {
        if (m.pie) throw new Error('PIE 已经在运行')
        m.pie = true
        m.pieMap = a.map ? resolve(a.map) : ''
        return { running: true, ...(a.map && { map: m.pieMap }) }
      }
      if (a.action === 'stop') m.pie = false
      return { running: m.pie }
    },
    'config.files': () => ({ items: [{ name: 'Engine', file: 'Saved/Config/WindowsEditor/Engine.ini' }] }),
    'config.get': (a) => {
      if (a.file !== 'Engine') throw new Error(`进程里没有加载配置 ${a.file}`)
      if (!a.section)
        return { file: 'Engine', sections: ['/Script/Engine.RendererSettings', 'Plugin.OnlyLive'], total: 2 }
      // 进程里的值和磁盘上叠出来的不一样，再加一个只在进程里有的键
      if (a.section === '/Script/Engine.RendererSettings')
        return {
          file: 'Engine',
          section: a.section,
          values: [
            { key: 'r.Shadow', value: '3' },
            { key: 'r.FromPlugin', value: '1' },
          ],
          total: 2,
        }
      return { file: 'Engine', section: a.section, values: [], total: 0, missing: true }
    },
    'tags.list': () => ({
      items: [
        { tag: 'Ability' },
        { tag: 'Ability.Fire', source: 'DefaultGameplayTags.ini' },
        { tag: 'Native.Tag', source: 'Native' },
      ],
      total: 3,
    }),
    'tags.refs': (a) => ({ tag: a.tag, items: ['/Game/BP_Hero'], total: 1 }),
    'asset.redirectors': (a) => {
      const items = state.tools.fixed
        ? []
        : [
            {
              path: `${a.path}/BP_Old.BP_Old`,
              package: `${a.path}/BP_Old`,
              file: `/tmp/BP_Old.uasset`,
              readOnly: false,
              target: '/Game/BP_Hero.BP_Hero',
              referencers: [{ package: '/Game/Maps/Town', file: '/tmp/Town.umap', readOnly: false }],
            },
          ]
      if (!a.fix) return { path: a.path, items, total: items.length }
      state.tools.fixed = true
      return {
        path: a.path,
        items,
        total: items.length,
        fixed: items.map((i) => ({ package: i.package, file: i.file })),
        left: [],
      }
    },
    'editor.spawn': (a) => {
      if (!a.class) throw new Error('找不到类 ')
      const actor = {
        path: `/Game/Maps/Town.Town:PersistentLevel.${a.class}_0`,
        name: `${a.class}_0`,
        label: a.label ?? a.class,
        class: a.class,
        level: '/Game/Maps/Town',
        location: a.location ?? [0, 0, 0],
      }
      state.tools.spawned.push(actor.path)
      const tx = `tx${state.bp.tx.length + 1}`
      state.bp.tx.push({ id: tx, undo: () => state.tools.spawned.pop() })
      return { actor, tx }
    },
    'editor.destroy': (a) => {
      state.tools.destroyed.push(...a.actors)
      const tx = `tx${state.bp.tx.length + 1}`
      state.bp.tx.push({ id: tx, undo: () => state.tools.destroyed.splice(-a.actors.length) })
      return { destroyed: a.actors.map((p) => ({ path: p })), tx }
    },
  }
}
