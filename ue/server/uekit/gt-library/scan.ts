import path from 'node:path'
import { findCalls, type CallRef } from './call-refs.ts'
import { readJsonFile, slash, walkJson } from './files.ts'

/** 一个文件里的全部 call（相对场景根的文件路径）；没有 call 的文件不列 */
export interface FileCalls {
  file: string
  calls: CallRef[]
}

/**
 * 场景根里谁在 call 谁：全部 .json 读一遍（解析失败的跳过：坏文件本来就跑不了，也不该被改写）。
 * 几百上千个脚本一次读完也就几十毫秒，整理是低频操作，不建索引
 */
export async function scanCalls(rootAbs: string): Promise<FileCalls[]> {
  const out: FileCalls[] = []
  for (const abs of await walkJson(rootAbs)) {
    const f = await readJsonFile(abs)
    if (!f) continue
    const calls = findCalls(f.doc)
    if (calls.length) out.push({ file: slash(path.relative(rootAbs, abs)), calls })
  }
  return out
}
