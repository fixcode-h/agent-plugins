// 预览类布局（材质、贴图、网格、音频、Niagara）共用的纯函数单测：node --test ue/web/inspect/layouts/preview/preview.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioFacts, soundNodes } from '../audio/model.ts'
import { emitters } from '../niagara/model.ts'
import {
  DEFAULT_VIEW,
  dolly,
  hasCap,
  isDefaultView,
  oldBridge,
  orbit,
  pickStats,
  refPath,
  reqSize,
  restTags,
  tidyTag,
  waitFor,
} from './model.ts'

test('拖动转视角：yaw 折回 ±180，pitch 限在 ±89，滚轮推拉有上下限', () => {
  const v = orbit(DEFAULT_VIEW, 100, 0)
  assert.equal(v.yaw, -107.5)
  assert.equal(orbit({ yaw: 170, pitch: 0, distance: 0 }, 40, 0).yaw, -170)
  assert.equal(orbit({ yaw: 0, pitch: 0, distance: 0 }, 0, 1000).pitch, -89)
  assert.equal(orbit({ yaw: 0, pitch: 0, distance: 0 }, 0, -1000).pitch, 89)
  assert.equal(dolly(DEFAULT_VIEW, 120).distance, 25)
  assert.equal(dolly(DEFAULT_VIEW, -1).distance, -25)
  let far = DEFAULT_VIEW
  for (let i = 0; i < 400; i++) far = dolly(far, 1)
  assert.equal(far.distance, 5000)
  let near = DEFAULT_VIEW
  for (let i = 0; i < 20; i++) near = dolly(near, -1)
  assert.equal(near.distance, -150)
  assert.equal(isDefaultView(DEFAULT_VIEW), true)
  assert.equal(isDefaultView(v), false)
})

test('请求尺寸：按物理像素取 64 的倍数，限在 64–max（UELink 最多 2048）', () => {
  assert.equal(reqSize(500, 1), 512)
  assert.equal(reqSize(500, 2), 1024)
  assert.equal(reqSize(900, 2), 1024)
  assert.equal(reqSize(900, 2, 4096), 1856)
  assert.equal(reqSize(3000, 1, 4096), 2048)
  assert.equal(reqSize(0), 256)
  assert.equal(reqSize(10), 64)
})

test('节流：上一次发出后不到 120 毫秒就等', () => {
  assert.equal(waitFor(1000, 1050), 70)
  assert.equal(waitFor(1000, 1200), 0)
  assert.equal(waitFor(0, 5), 115)
})

test('能力：操作在 ops 里或能力名在名片 features 里，UE 没连上都不算', () => {
  assert.equal(hasCap({ online: true, ops: ['asset.preview'] }, 'asset.preview'), true)
  assert.equal(hasCap({ online: true, ops: [], features: ['bp.layout'] }, 'bp.layout'), true)
  assert.equal(hasCap({ online: false, ops: ['asset.preview'] }, 'asset.preview'), false)
  assert.equal(hasCap({ online: true }, 'bp.layout'), false)
  assert.equal(hasCap(undefined, 'bp.layout'), false)
  assert.equal(oldBridge('这个进程不支持 asset.preview（编辑器专用的操作…）', 'asset.preview'), true)
  assert.equal(oldBridge('asset.preview 不支持 NiagaraSystem 这类资源', 'asset.preview'), false)
})

test('统计条：按顺序挑出有的注册表标签，值整理成好读的样子', () => {
  const tags = { Triangles: '1248', Vertices: '1032', ApproxSize: '100x100x100', NaniteEnabled: 'False', Extra: 'x' }
  const s = pickStats(
    tags,
    [
      ['triangles', '三角形'],
      ['Vertices', '顶点'],
      ['LODs', 'LOD'],
      ['ApproxSize', '尺寸'],
      ['NaniteEnabled', 'Nanite'],
    ],
    '开',
    '关',
  )
  assert.deepEqual(
    s.map((x) => [x.label, x.value]),
    [
      ['三角形', '1,248'],
      ['顶点', '1,032'],
      ['尺寸', '100 × 100 × 100'],
      ['Nanite', '关'],
    ],
  )
  assert.deepEqual(
    restTags(tags, [
      ['Triangles', ''],
      ['Vertices', ''],
      ['ApproxSize', ''],
      ['NaniteEnabled', ''],
    ]),
    [['Extra', 'x']],
  )
  assert.equal(tidyTag('512'), '512')
  assert.equal(pickStats(undefined, [['A', 'a']]).length, 0)
  assert.equal(refPath("Skeleton'/Game/A/SK.SK'"), '/Game/A/SK.SK')
  assert.equal(refPath('/Game/A/SK.SK'), '/Game/A/SK.SK')
  assert.equal(refPath(3), '')
})

test('音频：时长、采样率、声道按候选字段找，SoundCue 的节点从子对象挑', () => {
  const f = audioFacts({ Duration: '0.48', SampleRate: '48000' }, { NumChannels: 2, bLooping: false })
  assert.deepEqual(
    f.map((x) => [x.key, x.value]),
    [
      ['duration', '0.480 s'],
      ['rate', '48000 Hz'],
      ['channels', '2'],
      ['loop', 'false'],
    ],
  )
  assert.equal(audioFacts(undefined, undefined).length, 0)
  assert.deepEqual(
    soundNodes([
      { path: '/Game/SC.SC:SoundNodeWavePlayer_0', name: 'SoundNodeWavePlayer_0', class: 'SoundNodeWavePlayer' },
      { path: '/Game/SC.SC:X', name: 'X', class: 'Object' },
    ]).map((n) => n.type),
    ['WavePlayer'],
  )
})

test('Niagara：发射器按 EmitterHandles，关掉的标出来，读不到退到子对象', () => {
  const subs = [
    { path: '/Game/NS.NS:Sparks', name: 'Sparks', class: 'NiagaraEmitter' },
    { path: '/Game/NS.NS:Sparks.SpawnScript', name: 'Sparks.SpawnScript', class: 'NiagaraScript' },
    { path: '/Game/NS.NS:Glow', name: 'Glow', class: 'NiagaraEmitter' },
  ]
  const e = emitters(
    {
      EmitterHandles: [
        { Name: 'Sparks', bIsEnabled: true, Instance: { Emitter: '/Game/NS.NS:Sparks', Version: 'x' } },
        { Name: 'Glow', bIsEnabled: false, Instance: '/Game/NS.NS:Glow' },
      ],
    },
    subs,
  )
  assert.deepEqual(
    e.map((x) => [x.name, x.enabled, x.scripts.map((s) => s.name)]),
    [
      ['Sparks', true, ['SpawnScript']],
      ['Glow', false, []],
    ],
  )
  assert.deepEqual(
    emitters(undefined, subs).map((x) => x.name),
    ['Sparks', 'Glow'],
  )
})
