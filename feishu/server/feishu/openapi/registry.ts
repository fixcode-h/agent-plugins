import { DATA_API } from './handlers-data.ts'
import { DOC_API } from './handlers-docs.ts'
import { DRIVE_API } from './handlers-drive.ts'
import type { ApiHandler } from './types.ts'

/**
 * token 模式的操作注册表（「工具.动作」→ 开放接口实现）。没登记的（改文档正文、新建文档、改 Markdown 文件、妙记搜索）
 * 在 token 模式下报不支持并说明要装 lark-cli（用户 2026-11-24 选「读写，改文档正文除外」）
 */
const API_OPS: Record<string, ApiHandler> = { ...DOC_API, ...DRIVE_API, ...DATA_API }

export const apiHandler = (tool: string, action: string): ApiHandler | undefined => API_OPS[`${tool}.${action}`]
