import type { LarkResult } from '../cli.ts'
import type { OpArgs, Target } from '../ops/types.ts'
import type { FeishuApi } from './client.ts'

/** 一个飞书操作的开放接口实现（token 模式）：注册表按「工具.动作」登记，没登记的操作在 token 模式下不支持 */
export interface ApiIo {
  /** 这个对话的缓存目录（下载的文件写这里） */
  dir: string
  signal?: AbortSignal
}

export type ApiHandler = (api: FeishuApi, a: OpArgs, target: Target | undefined, io: ApiIo) => Promise<LarkResult>
