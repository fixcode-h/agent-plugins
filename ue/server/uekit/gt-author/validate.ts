import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpCtx } from '../../ops.ts'
import { scenarioRoot } from '../gt-disk.ts'
import { scenarioFile } from '../gt-paths.ts'
import { readApiFile } from './api-file.ts'
import { offlineChecks, panelOnlyChecks } from './checks/index.ts'
import type { Check, CheckEnv, Issue } from './checks/types.ts'
import { luaRoot } from './lua-files.ts'
import type { Op } from './tool-actions.ts'
import { flatSteps } from './walk.ts'

/**
 * ue_gametest action=validate：不开游戏校验一份脚本（定稿 11 节第 3 步）。
 * - 编辑器开着：交给 GameTest 的 gt.validate（查函数、选择器在 WBP 里能不能找到、代码变量路径——这些只有编辑器知道），
 *   再补面板这边才看得到的检查（Lua 模块文件和字段）。
 * - 编辑器没开：面板按检查表做结构上能查的（格式、块、id、call、$变量、表达式、项目接口、Lua 引用），返回 offline: true，
 *   并说明函数、选择器这些要开编辑器再校验一次。
 * 返回结构和 gt.validate 一样：ok、errors / warnings: [{id?, path, code, message}]、checked。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

async function readJson(abs: string): Promise<Obj | undefined> {
  const text = await readFile(abs, 'utf8').catch(() => '')
  if (!text) return undefined
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** 要校验的脚本：scenario（相对场景根的文件）或 script（整份 JSON，可以是字符串） */
async function loadInput(projectRoot: string, scen: string, a: Obj) {
  if (a.script !== undefined) {
    if (isObj(a.script)) return { doc: a.script, self: '' }
    if (typeof a.script === 'string')
      try {
        const v = JSON.parse(a.script) as unknown
        if (isObj(v)) return { doc: v, self: '' }
      } catch (e) {
        return { error: `script 不是合法的 JSON：${(e as Error).message}` }
      }
    return { error: 'script 要是场景 JSON 对象' }
  }
  if (typeof a.scenario !== 'string' || !a.scenario) return { error: '给 scenario（相对场景根的路径）或 script（整份 JSON）' }
  const rel = /\.json$/i.test(a.scenario) ? a.scenario : `${a.scenario}.json`
  const f = scenarioFile(projectRoot, scen, rel)
  const text = await readFile(f.abs, 'utf8').catch(() => undefined)
  if (text === undefined) return { error: `场景文件不存在：${f.rel}` }
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    if (!isObj(v)) return { error: `${f.rel} 不是 JSON 对象` }
    return { doc: v, self: f.rel }
  } catch (e) {
    return {
      result: {
        ok: false,
        errors: [{ path: '', code: 'bad_type', message: `${f.rel} 不是合法的 JSON：${(e as Error).message}` }],
        warnings: [],
      },
    }
  }
}

export function makeEnv(doc: Obj, self: string, scen: string, luaRootAbs: string): CheckEnv {
  const scripts = new Map<string, Promise<Obj | undefined>>()
  let api: Promise<Obj> | undefined
  return {
    doc,
    steps: flatSteps(doc),
    scenarioRoot: scen,
    self,
    luaRoot: luaRootAbs,
    loadScript: (rel) => {
      const key = rel.replace(/\\/g, '/').replace(/\.json$/i, '').toLowerCase()
      if (!scripts.has(key)) {
        const abs = path.resolve(scen, `${rel.replace(/\.json$/i, '')}.json`)
        const r = path.relative(scen, abs)
        scripts.set(key, r.startsWith('..') || path.isAbsolute(r) ? Promise.resolve(undefined) : readJson(abs))
      }
      return scripts.get(key)!
    },
    api: () => (api ??= readApiFile(scen)),
  }
}

export async function runChecks(checks: Check[], env: CheckEnv) {
  const all: Issue[] = []
  for (const c of checks) {
    try {
      all.push(...(await c.run(env)))
    } catch (e) {
      // 一项检查自己出错不拖垮整份校验：记一条警告，说明这一项没查成
      all.push({ path: '', code: 'internal', message: `检查 ${c.name} 出错：${(e as Error).message}`, level: 'warning' })
    }
  }
  const strip = ({ level: _l, ...x }: Issue) => x
  return {
    errors: all.filter((x) => x.level === 'error').map(strip),
    warnings: all.filter((x) => x.level === 'warning').map(strip),
  }
}

/** 返回太长时只留前面的（问题按步骤顺序排，改完前面的再校验一次） */
function cap(list: unknown[], n = 40) {
  return list.length > n ? { list: list.slice(0, n), more: list.length - n } : { list }
}

export async function validateScript(op: Op, a: Obj, ctx: OpCtx, online: boolean) {
  const scen = await scenarioRoot(ctx.project.root)
  const input = await loadInput(ctx.project.root, scen, a)
  if ('error' in input) return { error: input.error }
  if ('result' in input) return input.result
  const env = makeEnv(input.doc, input.self, scen, luaRoot(ctx.project))
  if (online) {
    const args = a.script !== undefined ? { script: input.doc } : { scenario: a.scenario }
    let res: Obj | undefined
    try {
      res = await op('gt.validate', { ...args, deep: a.deep !== false }, 120000)
    } catch (e) {
      // 旧版 GameTest 没有 gt.validate：退回离线校验，说清楚
      if (!/unknown|不认识|未知/i.test((e as Error).message)) throw e
    }
    if (res) {
      const extra = await runChecks(panelOnlyChecks(), env)
      const warnings = [...((res.warnings as unknown[]) ?? []), ...extra.warnings]
      const errors = [...((res.errors as unknown[]) ?? []), ...extra.errors]
      return { ...res, ok: !errors.length, errors, warnings }
    }
  }
  const r = await runChecks(offlineChecks(), env)
  const e = cap(r.errors)
  const w = cap(r.warnings)
  return {
    ok: !r.errors.length,
    errors: e.list,
    warnings: w.list,
    ...(e.more || w.more ? { more: { errors: e.more ?? 0, warnings: w.more ?? 0 } } : {}),
    checked: { steps: env.steps.length, checks: offlineChecks().map((c) => c.name) },
    offline: true,
    note: online
      ? '编辑器里的 GameTest 还没有 gt.validate（要 1.9.0）：只做了结构检查，函数、选择器、代码变量路径没查'
      : '编辑器没开：只做了结构检查；函数在不在、参数类型、选择器在 WBP 里能不能找到、代码变量路径，开着编辑器再 validate 一次',
  }
}
