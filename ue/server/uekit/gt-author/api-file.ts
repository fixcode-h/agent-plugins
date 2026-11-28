import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 场景根下的 `_api.json`（GameTest 脚本协议 8.2）：旧版扫出来的项目测试接口。GameTest 2.9.0 起不认了，
 * 面板也不再扫、不再写，只读出来给接口库弹窗和 ue_gametest look what=api 提示「这些要迁走」
 */
export const API_FILE = '_api.json'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

async function readJson(file: string): Promise<Obj | undefined> {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (!text.trim()) return undefined
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

export async function readApiFile(scenarioRoot: string): Promise<Obj> {
  return (await readJson(path.join(scenarioRoot, API_FILE))) ?? { kind: 'gametest-api', version: 1 }
}
