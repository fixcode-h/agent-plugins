import type { GtStep } from '../../../../../shared/gt-script/index.ts'

/**
 * 动作字段表（用户 2026-11-19：检查器不给用户编辑 JSON，每种动作按 GameTest 动作表出表单）。
 * 一种动作一组字段描述，检查器按它画（FieldForm.tsx）；加新动作：在 actions.ts 里 registerFields 一行。
 * 没登记的动作（编辑器录制的步骤等）按这一步现有的字段自动出输入框，JSON 只在「高级」里
 */
export type FieldKind =
  /** 普通文字 */
  | 'text'
  /** 等宽文字（资源路径、类名、命令） */
  | 'mono'
  /** 数字（可写 $变量） */
  | 'number'
  /** 开关：不写等于关 */
  | 'switch'
  /** 三态：不写 / 是 / 否（写了就要控件认这个字段，所以「不写」要单独一档） */
  | 'tri'
  /** 下拉：options 里 value 为 '' 的是「不写，用默认」 */
  | 'select'
  /** 动作落点：对象 + 部件（协议 game-test-ref 第 2 节） */
  | 'target'
  /** 对象引用：命名对象、$变量、内联的类 + 标识 */
  | 'obj'
  /** 对象上的属性路径（v5：属性、方法、Lua 字段、运行状态），按名字从 step.obj 的属性树里找 */
  | 'prop'
  /** 值：常量、$变量、= 表达式 */
  | 'value'
  /** 几个数字一组：[x, y] / [x, y, z]，dims 是个数 */
  | 'vec'

export interface FieldDef {
  k: string
  label: () => string
  kind: FieldKind
  placeholder?: () => string
  /** 输入框后面的单位（毫秒、秒、厘米） */
  unit?: () => string
  /** 标签上悬停看的说明 */
  hint?: () => string
  options?: () => { value: string; label: string }[]
  dims?: number
  /** 只在这时显示（例如等待方式选了「等几秒」才显示秒数） */
  when?: (s: GtStep) => boolean
}

const table = new Map<string, FieldDef[]>()

export function registerFields(action: string, defs: FieldDef[]) {
  table.set(action, defs)
}

export const fieldsOf = (action: string): FieldDef[] | undefined => table.get(action)

const titles = new Map<string, () => string>()

/** 动作的中文名（检查器标题），没登记的显示动作名本身 */
export function registerActionTitles(m: Record<string, () => string>) {
  for (const [k, v] of Object.entries(m)) titles.set(k, v)
}

export const actionTitle = (action: string): string => titles.get(action)?.() ?? action

/** 表单不管、也不给用户改的字段：公共字段由检查器的说明和「出错和跳过」管，hint 是录制写的回放线索 */
export const NOT_FIELDS = new Set([
  'id',
  'action',
  'title',
  'note',
  'onFail',
  'retries',
  'timeoutMs',
  'skipIf',
  'expectNoErrors',
  'disabled',
  'guards',
  'hint',
])
