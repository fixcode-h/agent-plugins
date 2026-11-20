import type { GtCloseRule, GtIdentRule, GtRefDefaults } from '../../../../shared/gt-script/ref/types.ts'
import { op } from '../../../api.ts'
import { classShort } from './describe.ts'

/** _settings.json 里对象与标识这几项（协议第 6 节） */
export interface RefConfig {
  identRules?: GtIdentRule[]
  closeRules?: GtCloseRule[]
  refDefaults?: GtRefDefaults
  allowDestroy?: boolean
}

/**
 * 只改运行配置里的一两项（对象弹窗「以后都按这个认」、关闭检查器「这个类以后都这样关」）：
 * 现取一遍最新的整份配置、改完整份写回，别的字段原样带回去（和设置页保存同一个 gt.config）
 */
export async function patchRunConfig(project: string, fn: (c: RefConfig & Record<string, unknown>) => void) {
  const r = await op<{ config: RefConfig & Record<string, unknown> }>(project, 'gt.config')
  const config = { ...r.config }
  fn(config)
  await op(project, 'gt.config', { config })
}

const sameClass = (a: string, b: string) => classShort(a).toLowerCase() === classShort(b).toLowerCase()

/** 同类（同一个 in）已有规则就替换，没有就加 */
export function upsertIdentRule(list: GtIdentRule[] | undefined, rule: GtIdentRule): GtIdentRule[] {
  const key = JSON.stringify(rule.in ?? null)
  const rest = (list ?? []).filter((r) => !(sameClass(r.class, rule.class) && JSON.stringify(r.in ?? null) === key))
  return [...rest, rule]
}

export function upsertCloseRule(list: GtCloseRule[] | undefined, rule: GtCloseRule): GtCloseRule[] {
  return [...(list ?? []).filter((r) => !sameClass(r.class, rule.class)), rule]
}
