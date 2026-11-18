import { h } from '../../host.ts'
import { satisfies } from './plugins/model.ts'

/**
 * 录成块（GameTest 1.10.0）：录制时 Alt+6 等到、Alt+7 按状态分支，录完装成一个步骤段，编辑页「从这里接着录」。
 * 编辑器里的 GameTest 更旧时这些参数和快捷动作都不认（会报「不认识 phase」），按钮和菜单项不显示或灰掉
 */
export const SEGMENT_MIN_VERSION = '1.10.0'

export const segmentSupported = (gameTestVersion?: string) =>
  !!gameTestVersion && satisfies(gameTestVersion, `>=${SEGMENT_MIN_VERSION}`)

/**
 * gt.record.start 的 group / insert：
 * - 接着录（insert）：录到的段插进正在编辑的场景里 after 这一步后面，UE 停止时自己写回原文件；
 * - 新录制按设置「录完装成一个录制段」决定要不要 group（默认不装：场景详情页的逐步工具只认平铺的步骤）
 */
export function recordSegmentArgs(gameTestVersion?: string, insert?: { scenario: string; after?: string }) {
  if (!segmentSupported(gameTestVersion)) return {}
  if (insert) return { insert: insert.after ? insert : { scenario: insert.scenario } }
  return h().config().gtRecordGroup === true ? { group: true } : {}
}
