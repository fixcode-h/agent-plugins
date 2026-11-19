// 骨骼网格 / 动画序列布局的纯函数单测：node --test ue/web/inspect/layouts/skeletal/skeletal.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { animCurves, animGroups, animLength, animNotifies, sockets } from './model.ts'

const PROPS = {
  SequenceLength: 2,
  Notifies: [
    { NotifyName: 'Footstep_R', LinkValue: 1.1, TrackIndex: 1 },
    { NotifyName: 'None', Notify: "Class'/Game/AN_Step.AN_Step_C'", LinkValue: 0.5, TrackIndex: 0 },
    { NotifyName: 'None', NotifyStateClass: '/Script/Engine.AnimNotifyState_Trail', LinkValue: 0.3, Duration: 0.8 },
    { NotifyName: 'Bad' },
  ],
  RawCurveData: {
    FloatCurves: [
      {
        Name: { DisplayName: 'ArmWeight' },
        FloatCurve: {
          Keys: [
            { Time: 0, Value: 0.5, InterpMode: 'RCIM_Cubic' },
            { Time: 2, Value: 0.6, InterpMode: 'RCIM_Linear' },
          ],
        },
      },
    ],
  },
}

test('动画通知：时间、名字（没名字用类名）、持续时间、轨道；没有时间的丢掉', () => {
  const n = animNotifies(PROPS)
  assert.deepEqual(
    n.map((x) => [x.name, x.time, x.duration, x.track]),
    [
      ['AnimNotifyState_Trail', 0.3, 0.8, 0],
      ['AN_Step', 0.5, 0, 0],
      ['Footstep_R', 1.1, 0, 1],
    ],
  )
  assert.deepEqual(animNotifies(undefined), [])
})

test('曲线：名字三种写法、插值，长度优先 SequenceLength', () => {
  const c = animCurves(PROPS)
  assert.equal(c[0].name, 'ArmWeight')
  assert.deepEqual(
    c[0].keys.map((k) => k.interp),
    ['cubic', 'linear'],
  )
  assert.deepEqual(animCurves({}), [])
  assert.equal(animLength(PROPS, undefined, [], []), 2)
  assert.equal(animLength({}, { SequenceLength: '1.5' }, [], []), 1.5)
  assert.equal(animLength({}, undefined, animNotifies(PROPS), []), 1.1)
})

test('时间轴分组：通知按轨道一行（状态多一个结束点），曲线一条一行', () => {
  const g = animGroups(animNotifies(PROPS), animCurves(PROPS), {
    notify: 'N',
    track: (n) => `T${n}`,
    curve: 'C',
  })
  assert.deepEqual(
    g.map((x) => [x.id, x.channels.map((c) => [c.label, c.keys.length])]),
    [
      [
        'notifies',
        [
          ['T1', 3],
          ['T2', 1],
        ],
      ],
      ['curves', [['ArmWeight', 2]]],
    ],
  )
  assert.equal(animGroups([], [], { notify: '', track: String, curve: '' }).length, 0)
  assert.deepEqual(
    sockets([
      { path: '/Game/SK.SK:weapon_s', name: 'weapon_s', class: 'SkeletalMeshSocket' },
      { path: '/Game/SK.SK:x', name: 'x', class: 'Object' },
    ]).map((s) => s.name),
    ['weapon_s'],
  )
})
