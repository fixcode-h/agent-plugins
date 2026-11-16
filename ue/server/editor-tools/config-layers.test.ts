// 配置分层和 Tag ini 的读取：用临时目录造引擎、项目、Saved 三处的 ini，不需要 UE。
// 用法：node --test ue/server/editor-tools/config-layers.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { applyEntry, configTypes, loadLayers, parseIni, searchConfig, sectionRows, sectionsOf } from './config-layers.ts'
import { iniTags } from './tag-ini.ts'

let p: UeProject
const put = async (f: string, body: string) => {
  await mkdir(path.dirname(f), { recursive: true })
  await writeFile(f, body)
}

before(async () => {
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
  const base = await mkdtemp(path.join(tmpdir(), 'ue-config-'))
  const root = path.join(base, 'Proj')
  const engine = path.join(base, 'UE')
  const plat = process.platform === 'darwin' ? 'Mac' : process.platform === 'linux' ? 'Linux' : 'Windows'
  await put(
    path.join(engine, 'Engine', 'Config', 'BaseEngine.ini'),
    '[/Script/Engine.RendererSettings]\nr.Shadow=1\n+Paths=A\n\n[Core.Log]\nLogTemp=Log\n',
  )
  await put(path.join(engine, 'Engine', 'Config', 'BaseGame.ini'), '[/Script/Engine.GameSession]\nMaxPlayers=16\n')
  await put(
    path.join(root, 'Config', 'DefaultEngine.ini'),
    '﻿; 注释\n[/Script/Engine.RendererSettings]\nr.Shadow=0\n+Paths=B\n+Paths=A\n-Paths=A\n',
  )
  await put(
    path.join(root, 'Config', 'DefaultGameplayTags.ini'),
    '[/Script/GameplayTags.GameplayTagsSettings]\n+GameplayTagList=(Tag="Ability.Fire",DevComment="开火")\n+GameplayTagList=(Tag="Ability.Jump",DevComment="")\n',
  )
  await put(path.join(root, 'Config', 'Tags', 'Extra.ini'), '[/Script/GameplayTags.GameplayTagsList]\nGameplayTagList=(Tag="State.Dead")\n')
  await put(path.join(root, 'Plugins', 'Feature', 'Config', 'Tags', 'Feat.ini'), '[x]\n+GameplayTagList=(Tag="Feat.On")\n')
  await put(path.join(root, 'Saved', 'Config', `${plat}Editor`, 'Engine.ini'), '[/Script/Engine.RendererSettings]\n!Paths=ClearArray\n')
  p = {
    root,
    engine: { dir: engine, version: '5.8', association: '5.8', source: 'custom' },
  } as unknown as UeProject
})

test('解析 ini：前缀、引号、注释、BOM', () => {
  const ini = parseIni('﻿[S]\n; x\nA="1 2"\n+B=x\n.B=x\n-B=y\n!C=\n')
  assert.deepEqual(
    ini.get('S')!.map((e) => `${e.op}${e.key}=${e.value}`),
    ['A=1 2', '+B=x', '.B=x', '-B=y', '!C='],
  )
})

test('按 UE 规则叠值', () => {
  let v: string[] = []
  v = applyEntry(v, { op: '+', key: 'K', value: 'a', line: 1 })
  v = applyEntry(v, { op: '+', key: 'K', value: 'a', line: 2 })
  v = applyEntry(v, { op: '.', key: 'K', value: 'a', line: 3 })
  assert.deepEqual(v, ['a', 'a'])
  assert.deepEqual(applyEntry(v, { op: '-', key: 'K', value: 'a', line: 4 }), [])
  assert.deepEqual(applyEntry(['x'], { op: '', key: 'K', value: 'y', line: 5 }), ['y'])
})

test('配置列表、各层和最后生效的那层', async () => {
  const types = await configTypes(p)
  assert.deepEqual(types.slice(0, 3), ['Engine', 'Game', 'GameplayTags'])
  const layers = await loadLayers(p, 'Engine')
  assert.equal(layers.length, 3)
  const secs = sectionsOf(layers)
  assert.deepEqual(
    secs.find((s) => s.name === '/Script/Engine.RendererSettings')?.layers.length,
    3,
  )
  const rows = sectionRows(layers, '/Script/Engine.RendererSettings')
  const shadow = rows.find((r) => r.key === 'r.Shadow')!
  assert.deepEqual(shadow.values, ['0'])
  assert.match(shadow.last, /DefaultEngine/)
  const paths = rows.find((r) => r.key === 'Paths')!
  // Default 里加了 B、删了 A，Saved 里整个清空
  assert.deepEqual(paths.values, [])
  assert.match(paths.last, /Saved/)
  assert.equal(paths.layers.length, 3)
  assert.equal(sectionRows(layers, '/Script/Engine.RendererSettings', 'R.SHADOW').length, 1)
})

test('全部配置里搜', async () => {
  const r = await searchConfig(p, 'maxplayers')
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].type, 'Game')
  assert.equal(r.hits[0].line, 2)
})

test('读项目和插件的 Tag ini', async () => {
  const tags = await iniTags(p.root)
  assert.deepEqual(
    tags.map((x) => x.tag),
    ['Ability.Fire', 'Ability.Jump', 'Feat.On', 'State.Dead'],
  )
  assert.equal(tags[0].comment, '开火')
  assert.equal(tags[1].comment, undefined)
  assert.equal(tags[3].source, 'Extra.ini')
})
