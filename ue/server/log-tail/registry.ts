import path from 'node:path'
import { moreNote } from '../logs.ts'
import { LogTail } from './tail.ts'

/** 同一个文件只有一份 LogTail：日志页、判忙、Agent 的 ue_log 共用一次读取和解析 */
const tails = new Map<string, LogTail>() // 模块状态：缓存，丢了下次重读

/** 最多留几个文件的（每个项目一般一两个：编辑器日志、-game 进程的日志） */
const MAX = 16

export function logTailOf(file: string): LogTail {
  const key = path.resolve(file)
  let x = tails.get(key)
  if (x) {
    // 最近用过的挪到最后，超出时从最前面丢
    tails.delete(key)
    tails.set(key, x)
    return x
  }
  x = new LogTail(key, { moreNote })
  tails.set(key, x)
  while (tails.size > MAX) tails.delete(tails.keys().next().value as string)
  return x
}
