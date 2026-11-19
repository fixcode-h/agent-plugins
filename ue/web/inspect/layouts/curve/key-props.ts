import type { Prop } from '../../../details/model.ts'
import { enumShort, EXTRAP_NAMES, INTERP_NAMES, keyPath, TANGENT_NAMES, WEIGHT_NAMES, type Curve } from './model.ts'

/** 枚举值的显示名（照 UE 下拉）：RCIM_Cubic → Cubic、RCTWM_WeightedNone → None */
const labels = (names: string[]) => names.map((n) => enumShort(n).replace(/^Weighted/, ''))

const INTERP_FULL: Record<string, string> = { cubic: 'RCIM_Cubic', linear: 'RCIM_Linear', constant: 'RCIM_Constant' }

/**
 * 右栏细节的属性（效果图 B9 右栏）：选中关键帧（Time、Value、插值、切线模式和切线），所在曲线（外推、默认值），资源（类、值范围）。
 * 属性名就是写回的属性路径（FloatCurve.Keys[2].Time），细节面板改值直接 set 它；类和值范围只读
 */
export function keyProps(
  c: Curve | undefined,
  index: number,
  extra: { cls: string; range?: { min: number; max: number }; key: string; curve: string; asset: string },
): Prop[] {
  const out: Prop[] = []
  const k = c?.keys[index]
  const num = (name: string, displayName: string, value: number, category: string): Prop => ({
    name,
    displayName,
    value,
    type: 'float',
    category,
    edit: true,
  })
  const pick = (name: string, displayName: string, value: string, names: string[], category: string): Prop => ({
    name,
    displayName,
    value,
    type: 'enum',
    enum: names,
    enumLabels: labels(names),
    category,
    edit: true,
  })
  if (c && k) {
    out.push(
      num(keyPath(c, index, 'Time'), 'Time', k.time, extra.key),
      num(keyPath(c, index, 'Value'), 'Value', k.value, extra.key),
      pick(keyPath(c, index, 'InterpMode'), 'Interp Mode', INTERP_FULL[k.interp], INTERP_NAMES, extra.key),
      pick(keyPath(c, index, 'TangentMode'), 'Tangent Mode', `RCTM_${k.tangentMode}`, TANGENT_NAMES, extra.key),
      num(keyPath(c, index, 'ArriveTangent'), 'Arrive Tangent', k.arrive, extra.key),
      num(keyPath(c, index, 'LeaveTangent'), 'Leave Tangent', k.leave, extra.key),
      pick(
        keyPath(c, index, 'TangentWeightMode'),
        'Tangent Weight Mode',
        `RCTWM_${k.tangentWeightMode}`,
        WEIGHT_NAMES,
        extra.key,
      ),
    )
  }
  if (c) {
    out.push(
      pick(`${c.prop}.PreInfinityExtrap`, 'Pre-Infinity', `RCCE_${c.pre}`, EXTRAP_NAMES, extra.curve),
      pick(`${c.prop}.PostInfinityExtrap`, 'Post-Infinity', `RCCE_${c.post}`, EXTRAP_NAMES, extra.curve),
    )
    if (c.defaultValue !== undefined)
      out.push(num(`${c.prop}.DefaultValue`, 'Default Value', c.defaultValue, extra.curve))
  }
  const ro = (name: string, value: string): Prop => ({
    name,
    displayName: name,
    value,
    type: 'FString',
    category: extra.asset,
    edit: true,
    readOnly: true,
  })
  out.push(ro('Class', extra.cls))
  if (extra.range) out.push(ro('Value Range', `${extra.range.min.toFixed(3)} – ${extra.range.max.toFixed(3)}`))
  return out
}
