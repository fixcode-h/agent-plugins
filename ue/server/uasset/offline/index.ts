/**
 * 离线操作的入口：导入各领域的处理函数（导入时登记进注册表），ops.ts 只认 canOffline / runOffline。
 * 加新的离线操作：在对应领域的文件里 registerOffline，返回照 UELink 同名操作的形状
 */
import './asset-ops.ts'
import './bp-ops.ts'
import './table-ops.ts'
import './find-ops.ts'
import './textify-ops.ts'

export { canOffline, runOffline } from './registry.ts'
