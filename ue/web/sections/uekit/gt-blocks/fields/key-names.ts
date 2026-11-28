/**
 * 「键」输入框的候选：UE 的键名（EKeys 里的名字，GameTest 的 key 动作照原样认）。
 * 只列常用的，打别的键名照样能填；手柄键也在这里，测手柄操作不用去查键名
 */
export interface KeyName {
  key: string
  /** 给人看的名字（不翻译的键名本身就是名字时留空） */
  label?: () => string
  group: 'keyboard' | 'mouse' | 'gamepad'
}

const kb = (key: string): KeyName => ({ key, group: 'keyboard' })

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(kb)
const DIGITS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'].map(kb)
const FKEYS = Array.from({ length: 12 }, (_, i) => kb(`F${i + 1}`))
const NAMED = [
  'SpaceBar',
  'Enter',
  'Escape',
  'Tab',
  'BackSpace',
  'Delete',
  'LeftShift',
  'RightShift',
  'LeftControl',
  'RightControl',
  'LeftAlt',
  'RightAlt',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tilde',
].map(kb)
const MOUSE: KeyName[] = [
  'LeftMouseButton',
  'RightMouseButton',
  'MiddleMouseButton',
  'ThumbMouseButton',
  'ThumbMouseButton2',
].map((key) => ({ key, group: 'mouse' }))
const GAMEPAD: KeyName[] = [
  'Gamepad_FaceButton_Bottom',
  'Gamepad_FaceButton_Right',
  'Gamepad_FaceButton_Left',
  'Gamepad_FaceButton_Top',
  'Gamepad_LeftShoulder',
  'Gamepad_RightShoulder',
  'Gamepad_LeftTrigger',
  'Gamepad_RightTrigger',
  'Gamepad_DPad_Up',
  'Gamepad_DPad_Down',
  'Gamepad_DPad_Left',
  'Gamepad_DPad_Right',
  'Gamepad_Special_Left',
  'Gamepad_Special_Right',
  'Gamepad_LeftThumbstick',
  'Gamepad_RightThumbstick',
].map((key) => ({ key, group: 'gamepad' }))

export const KEY_NAMES: KeyName[] = [...LETTERS, ...DIGITS, ...NAMED, ...FKEYS, ...MOUSE, ...GAMEPAD]

/** 按输入筛：键名包含输入（不分大小写）就留；空输入列全部 */
export function matchKeys(q: string, limit = 60) {
  const s = q.trim().toLowerCase()
  const hit = s ? KEY_NAMES.filter((k) => k.key.toLowerCase().includes(s)) : KEY_NAMES
  return { rows: hit.slice(0, limit), total: hit.length }
}
