import { parseRows } from './diff.ts'
import type { AssetSnap, SnapObject } from './types.ts'
import { flatten } from './umg.ts'

/**
 * 属性的来历（设计稿「UE资源版本差异-修复与强化」3.6）：在一份快照里找某个对象的某个属性的值。
 * 对象的认法和 diff.ts 给 ObjDiff 起的 key 一致：类默认值 / 资源本身是 defaults，组件是「来源:名字」，
 * 控件是名字（属性里有 Slot.* 和 ParentWidget），内嵌子对象是相对路径，数据表的行是行名
 */
export interface PropRef {
  kind: 'defaults' | 'component' | 'widget' | 'subobject' | 'row'
  key: string
  /** 组件的来源（native / scs / inherited） */
  source?: string
  prop: string
}

function objectOf(snap: AssetSnap, ref: PropRef): SnapObject | undefined {
  switch (ref.kind) {
    case 'defaults':
      return { name: 'defaults', class: snap.class, props: snap.props }
    case 'component':
      return snap.blueprint?.components.find((c) => c.name === ref.key && (!ref.source || c.source === ref.source))
    case 'widget':
      return flatten(snap.blueprint?.widgets?.find((w) => w.name === ref.key))
    case 'subobject':
      return snap.subobjects?.find((s) => s.name === ref.key)
    case 'row':
      return parseRows(snap.rows)?.find((r) => r.name === ref.key)
  }
}

/** 没有这个对象或属性时 found 为 false（那一版里还没加、或者被删了） */
export function propValueIn(snap: AssetSnap | null, ref: PropRef): { found: boolean; value?: unknown } {
  if (!snap) return { found: false }
  const p = objectOf(snap, ref)?.props.find((x) => x.name === ref.prop)
  return p ? { found: true, value: p.value } : { found: false }
}

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
