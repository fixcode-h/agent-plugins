import type { Prop } from '../../../details/model.ts'
import type { DetailsApi } from '../../../details/rows.tsx'

/**
 * 只看的细节面板动作（枚举条目、结构体成员这类 UELink 还改不了的东西）：各行都是只读，改值、数组按钮不会出现；
 * 点对象引用照常交给外面的导航
 */
export function readOnlyApi(openRef: DetailsApi['openRef'] = () => undefined): Omit<DetailsApi, 'q'> {
  return {
    busy: '',
    version: 0,
    changed: () => undefined,
    isChanged: () => false,
    setValue: () => undefined,
    arrayOp: () => undefined,
    reset: () => undefined,
    openRef,
    loadFull: async () => undefined,
  }
}

/**
 * 只读的一行属性（细节面板画）：name 是显示名也是键，category 是折叠条；why 写在锁的悬停提示里（为什么不能在这里改）
 */
export function roProp(
  name: string,
  value: unknown,
  category: string,
  why: string,
  type = typeof value === 'number' ? 'double' : typeof value === 'boolean' ? 'bool' : 'FString',
): Prop {
  return { name, displayName: name, value, type, category, edit: true, readOnly: true, readOnlyWhy: why }
}
