import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathStr, walk, type GtScript, type GtStep } from '../../../../../shared/gt-script/index.ts'
import type { CheckEnv, Issue, StepRef } from '../types.ts'

/**
 * 写法建议（style_*）共用的上下文：按「同一层的兄弟步骤」分好组，规则只看相邻关系，不自己再遍历一遍脚本。
 * 这些只是建议（warning），不挡运行：Agent 照着改能把一项一个节点的脚本收紧，人看画布也更清楚。
 */
type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export interface Row extends StepRef {
  /** 外层的块（从外到里） */
  blocks: GtStep[]
}

export interface StyleCtx {
  env: CheckEnv
  /** 每个步骤槽（steps、setup、某个块的 do / then…）里的步骤，按原顺序 */
  slots: Map<string, Row[]>
  /** 整份脚本里每个 $变量 出现的次数（含字段里嵌的 "第 $i 页"） */
  varUses: Map<string, number>
  /** 同目录别的脚本（不含自己），读一次缓存 */
  siblings: () => Promise<{ rel: string; doc: Obj }[]>
}

export interface StyleRule {
  name: string
  run: (c: StyleCtx) => Issue[] | Promise<Issue[]>
}

const VAR = /\$([A-Za-z_][A-Za-z0-9_]*)/g

export function makeStyleCtx(env: CheckEnv): StyleCtx {
  const slots = new Map<string, Row[]>()
  walk(env.doc as GtScript, (e) => {
    const key = pathStr(e.path.slice(0, -1))
    const row: Row = { step: e.step as Obj, path: pathStr(e.path), inGuard: e.inGuard, blocks: e.blocks }
    const list = slots.get(key)
    if (list) list.push(row)
    else slots.set(key, [row])
  })
  const varUses = new Map<string, number>()
  const count = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(VAR)) varUses.set(m[1], (varUses.get(m[1]) ?? 0) + 1)
    else if (Array.isArray(v)) v.forEach(count)
    else if (isObj(v)) Object.values(v).forEach(count)
  }
  count(env.doc)
  let sib: Promise<{ rel: string; doc: Obj }[]> | undefined
  return { env, slots, varUses, siblings: () => (sib ??= readSiblings(env)) }
}

async function readSiblings(env: CheckEnv) {
  if (!env.self) return []
  const dirRel = path.posix.dirname(env.self.replace(/\\/g, '/'))
  const dir = path.resolve(env.scenarioRoot, dirRel)
  const names = await readdir(dir).catch(() => [] as string[])
  const me = path.posix.basename(env.self.replace(/\\/g, '/')).toLowerCase()
  const out: { rel: string; doc: Obj }[] = []
  for (const n of names) {
    if (!/\.json$/i.test(n) || n.startsWith('_') || n.toLowerCase() === me) continue
    const text = await readFile(path.join(dir, n), 'utf8').catch(() => '')
    try {
      const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
      if (isObj(v) && Array.isArray(v.steps)) out.push({ rel: dirRel === '.' ? n : `${dirRel}/${n}`, doc: v })
    } catch {
      // 读不了的同目录文件不算，校验它自己时会报
    }
  }
  return out
}

/** 录制产生的段（recorded）里不提建议：整理成流程另有一套规则 */
export const inRecorded = (r: Row) => r.blocks.some((b) => (b as Obj).recorded === true)

/** 比较两步是不是「同一件事」：去掉 id、名称、说明这些不影响执行的字段 */
export function sameStep(a: unknown, b: unknown) {
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip)
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const k of Object.keys(v).sort()) if (!['id', 'title', 'note'].includes(k)) out[k] = strip(v[k])
  return out
}

/** 报告里给人看的步骤名：有 id 用 id，没有用路径 */
export const label = (r: Row) => (typeof r.step.id === 'string' && r.step.id ? r.step.id : r.path)
