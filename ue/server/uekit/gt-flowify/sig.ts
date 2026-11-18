import type { Step } from './types.ts'

/** 录制时附带、和「做了什么」无关的字段：比较两步是不是同一个操作时不看 */
const NOISE = new Set(['id', 'note', 'ms', 'at', 'time', 't', 'shot', 'screenshot', 'ocr', 'hint', 'meta', 'recorded', 'elapsedMs'])

/** 一步的「操作签名」：动作和参数一样就是同一个操作 */
export function stepSig(s: Step): string {
  const keys = Object.keys(s)
    .filter((k) => !NOISE.has(k))
    .sort()
  return JSON.stringify(keys.map((k) => [k, s[k]]))
}

/** 选择器所在的界面（`WBP_Bag:Btn_Sell` → `WBP_Bag`）；不是界面选择器时空 */
export function screenOf(target: unknown): string {
  if (typeof target !== 'string') return ''
  const m = /^([A-Za-z_][\w]*)\s*:/.exec(target.trim())
  return m ? m[1] : ''
}

/** 选择器最后一段的控件名（`WBP_Login:Root/Input_Account` → `Input_Account`） */
export function widgetOf(target: unknown): string {
  if (typeof target !== 'string') return ''
  const tail = target.split(':').pop() ?? ''
  return (tail.split(/[/>.\s]+/).filter(Boolean).pop() ?? '').replace(/\[.*$/, '')
}

/** 连续号段 [a, b] */
export const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
