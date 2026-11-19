import { registerBatch } from '../registry.ts'

/** 属性的批量：同一个属性在多个资源（蓝图类默认值、DataAsset……）上读、改 */

registerBatch('ue_get', {
  op: (a) => (a.prop ? 'get' : 'props'),
  args: (a) => (a.prop ? { prop: a.prop } : { filter: a.filter ?? '', maxChars: 600 }),
  timeoutMs: 600000,
})

registerBatch('ue_set', {
  op: 'set',
  args: (a) => ({
    prop: a.prop,
    ...(a.array ? { array: a.array } : {}),
    ...(a.index !== undefined ? { index: Number(a.index) } : {}),
    ...(a.key !== undefined ? { key: a.key } : {}),
    ...(a.value !== undefined ? { value: a.value } : {}),
    ...(a.class ? { class: String(a.class) } : {}),
    ...(a.where !== undefined ? { where: a.where } : {}),
  }),
  timeoutMs: 600000,
  write: true,
})
