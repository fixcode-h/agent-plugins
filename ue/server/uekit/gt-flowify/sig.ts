import type { Step } from './types.ts'
import { rebasePath } from '../../../shared/gt-script/ref/path.ts'

/** 录制时附带、和「做了什么」无关的字段：比较两步是不是同一个操作时不看 */
const NOISE = new Set([
  'id',
  'note',
  'ms',
  'at',
  'time',
  't',
  'shot',
  'screenshot',
  'ocr',
  'hint',
  'meta',
  'recorded',
  'elapsedMs',
])

/** 一步的「操作签名」：动作和参数一样就是同一个操作 */
export function stepSig(s: Step): string {
  const keys = Object.keys(s)
    .filter((k) => !NOISE.has(k))
    .sort()
  return JSON.stringify(keys.map((k) => [k, s[k]]))
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** v4 的部件写法 {obj, part?}（GameTest 2.0 录出来就是它）；v3 录的是选择器字符串 */
export const isRefTarget = (t: unknown): t is { obj: unknown; part?: string } => isObj(t) && 'obj' in t

/**
 * 目标所在的界面：v3 选择器取屏名（`WBP_Bag:Btn_Sell` → `WBP_Bag`）；v4 取对象引用的名字或类
 * （同一个类的不同实例当同一个界面：认弹窗、认重复只看是哪种界面）。不是界面目标时空
 */
export function screenOf(target: unknown): string {
  if (isRefTarget(target)) {
    const o = target.obj
    if (typeof o === 'string') return o
    return isObj(o) && typeof o.class === 'string' ? o.class : ''
  }
  if (typeof target !== 'string') return ''
  const m = /^([A-Za-z_][\w]*)\s*:/.exec(target.trim())
  return m ? m[1] : ''
}

/** 目标最后一段的控件名（`WBP_Login:Root/Input_Account` → `Input_Account`；v4 取 part 的最后一段） */
export function widgetOf(target: unknown): string {
  if (isRefTarget(target)) return typeof target.part === 'string' ? (target.part.split('.').pop() ?? '') : ''
  if (typeof target !== 'string') return ''
  const tail = target.split(':').pop() ?? ''
  return (
    tail
      .split(/[/>.\s]+/)
      .filter(Boolean)
      .pop() ?? ''
  ).replace(/\[.*$/, '')
}

/** 「这个目标在屏上」的条件：v5 写对象判断，v3 写选择器 + 状态（跟着录制的格式走，不混用） */
export function shownCond(target: unknown, state: 'shown' | 'onScreen'): Obj {
  if (isRefTarget(target)) {
    const part = typeof target.part === 'string' && target.part ? target.part : undefined
    return { obj: target.obj, prop: rebasePath(`@:${state}`, part), op: 'is', value: true }
  }
  return state === 'shown' ? { target, visible: true } : { target, onScreen: true }
}

/** 连续号段 [a, b] */
export const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
