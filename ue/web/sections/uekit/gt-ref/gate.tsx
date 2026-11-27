import { TriangleAlert } from 'lucide-react'
import { SCHEMA_VERSION } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { satisfies } from '../plugins/model.ts'

/** 对象引用（运行设置里的「对象与标识」）要的最低 GameTest */
export const REF_MIN_VERSION = '2.0.0'
/** 脚本 v5（属性路径 v5、in 数组、lua: 类）要的最低 GameTest */
export const SCRIPT_MIN_VERSION = '2.1.0'

const atLeast = (v: string | undefined, min: string) => !!v && satisfies(v.replace(/-.*$/, ''), `>=${min}`)
export const refSupported = (gameTestVersion?: string) => atLeast(gameTestVersion, REF_MIN_VERSION)
/** GameTest 2.5.0 起运行设置认 pieWindow（PIE 开在选中的视口 / 独立窗口），旧版 pie.start 只开独立窗口 */
export const pieWindowSupported = (gameTestVersion?: string) => atLeast(gameTestVersion, '2.5.0')

/** 文件里原本写的 schemaVersion（打开时数据层会整理，所以从原文读，不从整理后的 doc 读） */
export function rawSchemaVersion(text: string): number {
  try {
    const v = (JSON.parse(text.replace(/^﻿/, '')) as { schemaVersion?: unknown }).schemaVersion
    return typeof v === 'number' ? v : 1
  } catch {
    return SCHEMA_VERSION
  }
}

/**
 * 编辑页能不能改：GameTest 低于 SCRIPT_MIN_VERSION 时只读并提示升级 GameTest；脚本是旧版本时只读，
 * 顶上写「旧格式不再支持，请按新写法重写」——不迁移（用户 2026-11-21），也不给「升级脚本」按钮。
 * GameTest 版本不知道（编辑器没开）时只看脚本格式
 */
export function useRefGate(o: { base: string; gtVersion?: string }) {
  const oldGt = !!o.gtVersion && !atLeast(o.gtVersion, SCRIPT_MIN_VERSION)
  const oldDoc = !!o.base && rawSchemaVersion(o.base) < SCHEMA_VERSION
  const locked = oldGt || oldDoc
  const reason = oldGt
    ? t('装着的 GameTest {v} 还不认新格式的脚本：编辑页只读，到「UE 插件」页升级到 {m} 以上', {
        v: o.gtVersion ?? '',
        m: SCRIPT_MIN_VERSION,
      })
    : t('旧格式不再支持，请按新写法重写')
  const banner = locked ? (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-warning/8 ue:px-4 ue:py-1.5 ue:text-footnote ue:text-warning">
      <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span className="ue:min-w-0">{reason}</span>
    </div>
  ) : null
  return { locked, reason, banner }
}
