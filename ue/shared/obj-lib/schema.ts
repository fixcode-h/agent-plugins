import { z } from 'zod'
import { GmObject } from '../gm/schema.ts'

/**
 * 对象库 objects.json 的契约（测试页梳理第三期 G5，用户 2026-11-22 定）：GM 页「对象调用」的对象列表和 GameTest 测试页「对象」页签
 * 共用这一份，从 gm.json 拆出来单独存（项目文档根的 AgentPanel/UE/objects.json，和 gm.json 同一个目录，可以提交、团队共用）。
 * 一项是一个有名字的对象：匹配规则 ref（GameTest 引用）或来源字符串 src，二选一；folder 用 / 分层
 */
export const OBJ_LIB_VERSION = 1

export const ObjLib = z.object({
  version: z.literal(OBJ_LIB_VERSION),
  objects: z.array(GmObject).default([]),
  /** 文件夹（含空的；有对象的文件夹不一定在这里，按对象的 folder 推出来） */
  objFolders: z.array(z.string()).default([]),
})
export type ObjLib = z.infer<typeof ObjLib>

export const emptyObjLib = (): ObjLib => ObjLib.parse({ version: OBJ_LIB_VERSION })

/** 读到的文件内容 → 对象库：没有版本号的（坏文件、空文件）按空的；字段不合格式的抛错，原样给页面和 Agent */
export function parseObjLib(raw: unknown): ObjLib {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== OBJ_LIB_VERSION) return emptyObjLib()
  return ObjLib.parse(raw)
}
