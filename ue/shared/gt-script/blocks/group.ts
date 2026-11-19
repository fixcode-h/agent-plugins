import type { BlockDef } from '../types.ts'

/** 步骤段：录制录出来的就是一段（recorded: true，面板默认折叠） */
export const group: BlockDef = {
  action: 'group',
  idPrefix: 'grp',
  slots: () => [{ key: ['do'], kind: 'do' }],
  wrapSlot: ['do'],
  subgraph: true,
  make: () => ({ action: 'group', name: '', do: [] }),
}
