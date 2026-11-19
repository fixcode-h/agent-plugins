// 曲线布局的单测：node --test ue/web/inspect/layouts/curve/curve.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prop } from '../../../details/model.ts'
import { keyProps } from './key-props.ts'
import {
  boundsOf,
  curvePath,
  curvesOf,
  enumShort,
  fmtTick,
  handles,
  keyId,
  keyPath,
  mapper,
  parseKeyId,
  ticks,
  valueRange,
} from './model.ts'

const key = (time: number, value: number, interp = 'RCIM_Cubic', arrive = 0, leave = 0) => ({
  interpMode: interp,
  tangentMode: 'RCTM_Auto',
  tangentWeightMode: 'RCTWM_WeightedNone',
  time,
  value,
  arriveTangent: arrive,
  leaveTangent: leave,
})
const rich = (keys: unknown[]) => ({
  keys,
  defaultValue: 3.4028234663852886e38,
  preInfinityExtrap: 'RCCE_Constant',
  postInfinityExtrap: 'RCCE_Linear',
})

test('从属性里找曲线：单条、定长数组（向量 / 颜色）', () => {
  const props: Prop[] = [
    { name: 'FloatCurve', displayName: 'Float Curve', type: 'FRichCurve', value: rich([key(1, 1), key(0, 0)]) },
    { name: 'Other', type: 'int32', value: 3 },
  ]
  const [c] = curvesOf(props)
  assert.equal(c.label, 'Float Curve')
  assert.deepEqual(
    c.keys.map((k) => k.time),
    [0, 1],
  )
  assert.equal(c.defaultValue, undefined)
  assert.equal(c.post, 'Linear')
  assert.equal(c.keys[0].tangentMode, 'Auto')
  assert.equal(keyPath(c, 1, 'Value'), 'FloatCurve.Keys[1].Value')
  const vec = curvesOf([{ name: 'FloatCurves', type: 'FRichCurve', value: [rich([]), rich([]), rich([])] }])
  assert.deepEqual(
    vec.map((x) => [x.label, x.prop, x.tone]),
    [
      ['X', 'FloatCurves[0]', 'danger'],
      ['Y', 'FloatCurves[1]', 'success'],
      ['Z', 'FloatCurves[2]', 'accent'],
    ],
  )
  assert.equal(
    curvesOf([{ name: 'FloatCurves', type: '', value: [rich([]), rich([]), rich([]), rich([])] }])[3].label,
    'A',
  )
  assert.equal(curvesOf([{ name: 'X', type: '', value: { _truncated: true } }]).length, 0)
})

test('画法：三次段按 Hermite 控制点，线性直线，常量先平后竖', () => {
  const m = mapper({ t0: 0, t1: 1, v0: 0, v1: 1 }, 100, 100, { l: 0, r: 0, t: 0, b: 0 })
  const [c] = curvesOf([
    {
      name: 'C',
      type: '',
      value: rich([key(0, 0, 'RCIM_Cubic', 0, 3), key(1, 1, 'RCIM_Linear'), key(2, 0, 'RCIM_Constant'), key(3, 1)]),
    },
  ])
  const d = curvePath(c.keys, m)
  assert.ok(d.startsWith('M0,100C33.33,0 66.67,0 100,0'), d)
  assert.ok(d.includes('L200,100'), d)
  assert.ok(d.includes('H300V0'), d)
  assert.equal(curvePath([], m), '')
  const hd = handles(c.keys[0], m, 10)
  assert.ok(hd.leave.x > 0 && hd.leave.y < 100, '离开切线往右上')
})

test('范围、刻度、选中键 id', () => {
  const [c] = curvesOf([{ name: 'C', type: '', value: rich([key(0, 0), key(1, 1)]) }])
  assert.deepEqual(boundsOf([c]), { t0: -0.1, t1: 1.1, v0: -0.1, v1: 1.1 })
  const one = curvesOf([{ name: 'C', type: '', value: rich([key(2, 5)]) }])
  const b = boundsOf(one)
  assert.ok(b.t1 > b.t0 && b.v1 > b.v0)
  const tk = ticks(-0.1, 1.1, 600)
  assert.ok(tk.includes(0) && tk.includes(1))
  assert.equal(fmtTick(0.5, [0, 0.1]), '0.5')
  assert.equal(fmtTick(-0, [0, 1]), '0')
  assert.deepEqual(parseKeyId(keyId('FloatCurves[1]', 3)), { curve: 'FloatCurves[1]', index: 3 })
  assert.equal(parseKeyId(''), undefined)
  assert.deepEqual(valueRange([c]), { min: 0, max: 1 })
  assert.equal(enumShort('ERichCurveInterpMode::RCIM_Linear'), 'Linear')
})

test('右栏细节：属性名就是写回路径', () => {
  const [c] = curvesOf([{ name: 'FloatCurve', type: '', value: rich([key(0, 0), key(0.7, 0.92)]) }])
  const props = keyProps(c, 1, { cls: 'CurveFloat', range: { min: 0, max: 1 }, key: 'K', curve: 'C', asset: 'A' })
  const names = props.map((p) => p.name)
  assert.ok(names.includes('FloatCurve.Keys[1].Time'))
  assert.ok(names.includes('FloatCurve.PostInfinityExtrap'))
  assert.equal(props.find((p) => p.name === 'FloatCurve.Keys[1].InterpMode')?.value, 'RCIM_Cubic')
  assert.equal(props.find((p) => p.name === 'Class')?.readOnly, true)
  // 没选键：只有曲线和资源两组
  assert.equal(
    keyProps(c, -1, { cls: 'CurveFloat', key: 'K', curve: 'C', asset: 'A' }).some((p) => p.category === 'K'),
    false,
  )
})
