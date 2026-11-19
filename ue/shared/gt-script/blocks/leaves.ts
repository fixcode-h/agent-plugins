import type { BlockDef, CondRef } from '../types.ts'

/**
 * v3 新加的叶子动作（没有子步骤）：数据层只要知道 id 前缀、条件字段和新建骨架。
 * 一个动作一个对象，加新动作就在这里或新文件里加一项、在 index.ts 注册
 */
const expectCond = (): CondRef[] => [{ key: ['expect'], role: 'expect' }]

export const call: BlockDef = {
  action: 'call',
  idPrefix: 'call',
  // 调用另一个脚本：双击打开被调用的脚本（面包屑前面是调用方）
  subgraph: true,
  make: () => ({ action: 'call', script: '', with: {} }),
}

export const set: BlockDef = {
  action: 'set',
  idPrefix: 'set',
  make: () => ({ action: 'set', var: '', value: '' }),
}

export const invoke: BlockDef = {
  action: 'invoke',
  idPrefix: 'fn',
  conds: (s) => (s.expect ? expectCond() : []),
  make: () => ({ action: 'invoke', object: '', function: '', args: {} }),
}

export const api: BlockDef = {
  action: 'api',
  idPrefix: 'api',
  conds: (s) => (s.expect ? expectCond() : []),
  make: () => ({ action: 'api', api: '', args: {} }),
}

export const breakBlock: BlockDef = { action: 'break', idPrefix: 's', make: () => ({ action: 'break' }) }
export const continueBlock: BlockDef = { action: 'continue', idPrefix: 's', make: () => ({ action: 'continue' }) }
export const returnBlock: BlockDef = { action: 'return', idPrefix: 's', make: () => ({ action: 'return' }) }
export const fail: BlockDef = { action: 'fail', idPrefix: 's', make: () => ({ action: 'fail', message: '' }) }

export const widgetClose: BlockDef = {
  action: 'widget.close',
  idPrefix: 's',
  make: () => ({ action: 'widget.close', target: '' }),
}

export const widgetCall: BlockDef = {
  action: 'widget.call',
  idPrefix: 's',
  make: () => ({ action: 'widget.call', target: '', function: '' }),
}

/** 原有动作里带统一条件的：assert cond、wait until:"cond" */
export const assertBlock: BlockDef = {
  action: 'assert',
  idPrefix: 's',
  conds: (s) => (s.cond ? [{ key: ['cond'], role: 'cond' }] : []),
  make: () => ({ action: 'assert', expr: '' }),
}

export const wait: BlockDef = {
  action: 'wait',
  idPrefix: 's',
  conds: (s) => (s.until === 'cond' && s.cond ? [{ key: ['cond'], role: 'cond' }] : []),
  make: () => ({ action: 'wait', until: 'cond', cond: { all: [] } }),
}
