import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TidyResult } from './gt-tidy-plan.ts'

/**
 * 「整理成流程」写回时，步骤之外要动的地方（脚本协议第 1、5 节）：
 * - 场景顶层的 guards（本脚本守护）和 params（参数），和原有的合并，同名参数以这次为准；
 * - 勾了 global 的守护写进场景根 _settings.json 的 guards（全局守护），别的运行配置原样保留；
 * - 用到块、守护、参数时 schemaVersion 升到 3（mergeScenario 只升不降）。
 * 守护缺 id 时按 g1、g2… 补一个没用过的：报告和推送按 id 记守护触发次数。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function withIds(guards: Obj[], taken: Obj[]) {
  const used = new Set(taken.map((g) => g.id).filter((x) => typeof x === 'string'))
  let n = 1
  return guards.map((g) => {
    if (typeof g.id === 'string' && g.id && !used.has(g.id)) {
      used.add(g.id)
      return g
    }
    while (used.has(`g${n}`)) n++
    used.add(`g${n}`)
    return { id: `g${n}`, ...g }
  })
}

/** 交给 mergeScenario 的整理稿：steps 加上这次带出的守护、参数和版本 */
export function withFlow(orig: Obj, out: TidyResult): Obj {
  const draft: Obj = { steps: out.steps }
  if (out.guards.length) {
    const old = Array.isArray(orig.guards) ? (orig.guards as Obj[]) : []
    draft.guards = [...old, ...withIds(out.guards, old)]
  }
  if (Object.keys(out.params).length) draft.params = { ...(isObj(orig.params) ? orig.params : {}), ...out.params }
  if (out.v3) draft.schemaVersion = 3
  return draft
}

/**
 * 读好场景根 _settings.json、把全局守护接上，返回真正写盘的函数（场景写成功后再调）。
 * 文件坏了直接报错，不覆盖用户的运行配置；没有文件时新建一份只有 guards 的。
 */
export async function prepareGlobalGuards(scenarioRoot: string, guards: Obj[]) {
  const file = path.join(scenarioRoot, '_settings.json')
  let settings: Obj = {}
  let text = ''
  try {
    text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
  } catch {
    text = ''
  }
  if (text.trim()) {
    let v: unknown
    try {
      v = JSON.parse(text)
    } catch {
      v = undefined
    }
    if (!isObj(v)) throw new Error('场景根的 _settings.json 不是合法的 JSON 对象：先在 GameTest 设置里修好，再应用全局守护')
    settings = v
  }
  if (Array.isArray(settings.blockers))
    throw new Error('_settings.json 里还是旧的 blockers：先用 GameTest 1.9.0 打开一次让它改成 guards，再应用全局守护')
  const old = Array.isArray(settings.guards) ? (settings.guards as Obj[]) : []
  const next = { ...settings, guards: [...old, ...withIds(guards, old)] }
  return async () => {
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, '\t') + '\n', 'utf8')
    await rename(tmp, file)
    return file.replace(/\\/g, '/')
  }
}
