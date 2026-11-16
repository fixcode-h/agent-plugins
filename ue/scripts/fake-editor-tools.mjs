// 假桥接里的编辑器小工具（UELink 2.4：config.*、tags.*、asset.redirectors、editor.spawn / destroy），冒烟测试用。
// 单独一个文件，fake-bridge.mjs 只把它展开进 ops。
export function editorToolOps(state) {
  state.tools = { spawned: [], destroyed: [], fixed: false }
  return {
    'config.files': () => ({ items: [{ name: 'Engine', file: 'Saved/Config/WindowsEditor/Engine.ini' }] }),
    'config.get': (a) => {
      if (a.file !== 'Engine') throw new Error(`进程里没有加载配置 ${a.file}`)
      if (!a.section) return { file: 'Engine', sections: ['/Script/Engine.RendererSettings', 'Plugin.OnlyLive'], total: 2 }
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
      items: [{ tag: 'Ability' }, { tag: 'Ability.Fire', source: 'DefaultGameplayTags.ini' }, { tag: 'Native.Tag', source: 'Native' }],
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
      return { path: a.path, items, total: items.length, fixed: items.map((i) => ({ package: i.package, file: i.file })), left: [] }
    },
    'editor.spawn': (a) => {
      if (!a.class) throw new Error('找不到类 ')
      const actor = { path: `/Game/Maps/Town.Town:PersistentLevel.${a.class}_0`, name: `${a.class}_0`, label: a.label ?? a.class, class: a.class, level: '/Game/Maps/Town', location: a.location ?? [0, 0, 0] }
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
