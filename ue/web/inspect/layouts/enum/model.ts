import { show } from '../../../api.ts'
import type { Prop } from '../../../details/model.ts'

/**
 * 枚举条目（单测 enum.test.ts）。UELink 没有专门读枚举的接口，这里从资源属性里拼：
 * UserDefinedEnum 的 DisplayNameMap（内部名 → 显示名，按条目顺序存）和 EnumDescription。
 * 条目的说明（ToolTip 元数据）和「位掩码枚举」开关不是属性，读不到
 */
export interface EnumEntry {
  index: number
  /** 内部名（NewEnumerator0），代码和存档里存的是它 */
  name: string
  /** 显示名（编辑器下拉、蓝图里看到的） */
  label: string
}

const field = (props: Prop[], name: string) => props.find((p) => p.name === name)?.value

/** DisplayNameMap 的值：对象 { 内部名: 显示名 }，也认 [{ key, value }] 的列表写法 */
export function parseEnum(props: Prop[]): { entries: EnumEntry[]; description: string; truncated: boolean } {
  const raw = field(props, 'DisplayNameMap')
  const entries: EnumEntry[] = []
  let truncated = false
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!e || typeof e !== 'object') continue
      const o = e as Record<string, unknown>
      entries.push({ index: entries.length, name: show(o.key ?? o.Key), label: show(o.value ?? o.Value) })
    }
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (o._truncated) truncated = true
    else
      for (const [k, v] of Object.entries(o))
        entries.push({ index: entries.length, name: shortName(k), label: show(v) })
  }
  return { entries, description: show(field(props, 'EnumDescription')), truncated }
}

/** E_ForgeState::NewEnumerator0 → NewEnumerator0 */
export const shortName = (n: string) => n.replace(/^.*::/, '')
