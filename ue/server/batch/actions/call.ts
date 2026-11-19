import { registerBatch } from '../registry.ts'

/**
 * ue_call 调编辑器函数库（UELink 2.16 的 editor.call）：一批资源各调一次同一个静态函数，
 * args 里的 {path} {name} 按资源替换（如 {StaticMesh: "{path}", LODCount: 3}）。每次调用各一个事务，失败整批按 tx 撤回
 */
const entry = {
  op: 'editor.call',
  args: (a: Record<string, unknown>) => ({ class: a.class, function: a.function, args: a.args ?? [] }),
  timeoutMs: 1800000,
  write: true,
}
registerBatch('ue_call', entry)
registerBatch('ue_call.call', entry)
