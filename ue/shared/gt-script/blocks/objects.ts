import type { BlockDef } from '../types.ts'

/**
 * v4 的对象动作（协议 5.2、5.3）：obj 是引用（命名、内联、$var）。取代 v3 的 invoke、find、widget.close、widget.call
 * （v4 不认，校验报 action_removed，旧脚本靠迁移改写）。
 */
export const objClose: BlockDef = {
  action: 'obj.close',
  idPrefix: 's',
  // how 省略 = 按运行配置的 closeRules 或默认推荐（call Close… → click BtnClose → pop → remove）
  make: () => ({ action: 'obj.close', obj: '' }),
}

export const objSet: BlockDef = {
  action: 'obj.set',
  idPrefix: 'set',
  make: () => ({ action: 'obj.set', obj: '', prop: '', value: '' }),
}

export const objCall: BlockDef = {
  action: 'obj.call',
  idPrefix: 'fn',
  conds: (s) => (s.expect ? [{ key: ['expect'], role: 'expect' }] : []),
  make: () => ({ action: 'obj.call', obj: '', function: '', args: {} }),
}

export const objFind: BlockDef = {
  action: 'obj.find',
  idPrefix: 's',
  make: () => ({ action: 'obj.find', obj: '', saveAs: '' }),
}

/** wait until=cond 的简写：等到这个对象判断成立（prop 省略 = :exists is true） */
export const objWait: BlockDef = {
  action: 'obj.wait',
  idPrefix: 's',
  make: () => ({ action: 'obj.wait', obj: '' }),
}
