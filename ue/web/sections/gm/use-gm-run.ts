import { useState } from 'react'
import { callText, mergeArgs } from '../../../shared/gm/custom.ts'
import { inCommon, toggleCommon } from '../../../shared/gm/common.ts'
import type { GmCustom, GmFav, GmMacro } from '../../../shared/gm/schema.ts'
import { useUe } from '../../ctx.tsx'
import { useKept } from '../../keep.ts'
import { outLine, overrides, runCall, type CallOut } from './custom/run-custom.ts'
import type { GmEntry } from './data.ts'
import { runEntry, type RunOut } from './run.ts'
import type { GmData } from './use-gm.ts'

type Step = GmMacro['steps'][number]

/**
 * GM 页右边详情的参数、执行、加到常用（规格第 6 节）：扫描出来的 GM 参数按顺序（字符串数组），自定义 GM 按名字（只有「执行时可改」的能改）。
 * 填的参数按项目记在内存里（切走再回来还在）；执行结果进本机的最近执行。出错原样显示，不重试
 */
export function useGmRun(d: GmData) {
  const { project, target } = useUe()
  const [args, setArgs] = useKept<Record<string, string[]>>(`gm-args/${project.id}`, {})
  const [cargs, setCargs] = useKept<Record<string, Record<string, unknown>>>(`gm-cargs/${project.id}`, {})
  const [outs, setOuts] = useState<Record<string, RunOut>>({})
  const [couts, setCouts] = useState<Record<string, CallOut>>({})
  const [running, setRunning] = useState(false)

  const argsOf = (e: GmEntry) => args[e.key] ?? e.params.map(() => '')
  const valuesOf = (c: GmCustom) => cargs[c.id] ?? c.args
  const setArg = (e: GmEntry, i: number, v: string) =>
    setArgs({ ...args, [e.key]: e.params.map((_, k) => (k === i ? v : (argsOf(e)[k] ?? ''))) })
  const fill = (e: GmEntry, a: GmFav['args']) => {
    if (e.custom) setCargs({ ...cargs, [e.custom.id]: { ...e.custom.args, ...(Array.isArray(a) ? {} : a) } })
    else if (Array.isArray(a)) setArgs({ ...args, [e.key]: e.params.map((_, k) => a[k] ?? '') })
  }
  const setCustomArg = (c: GmCustom, n: string, v: unknown) =>
    setCargs({ ...cargs, [c.id]: { ...valuesOf(c), [n]: v } })

  /** a：从常用、最近执行、右键菜单直接执行时带的那组参数（state 里填的还没生效，不能等 fill 之后再读） */
  const exec = async (e: GmEntry, a?: GmFav['args']) => {
    setRunning(true)
    if (e.custom) {
      const c = e.custom
      let full: Record<string, unknown> = c.args
      let r: CallOut
      try {
        const vals = a && !Array.isArray(a) ? { ...c.args, ...a } : valuesOf(c)
        full = mergeArgs(c, overrides(c, vals))
        r = await runCall(project.id, c, full, target)
      } catch (err) {
        r = { ok: false, error: (err as Error).message, invoke: [], ms: 0, at: new Date().toISOString() }
      }
      setCouts((o) => ({ ...o, [c.id]: r }))
      d.pushRecent({
        key: e.key,
        name: c.name,
        args: full,
        code: callText(c, full),
        ok: r.ok,
        out: outLine(r),
        at: r.at,
      })
    } else {
      const list = Array.isArray(a) ? e.params.map((_, k) => a[k] ?? '') : argsOf(e)
      const r = await runEntry(project.id, e, list, target)
      setOuts((o) => ({ ...o, [e.key]: r }))
      d.pushRecent({
        key: e.key,
        name: e.name,
        args: list,
        code: r.code,
        ok: r.ok,
        out: (r.ok ? r.lines.find(Boolean) : r.error) ?? '',
        at: new Date().toISOString(),
      })
    }
    setRunning(false)
  }

  /** 这组参数加到常用：自定义 GM 只存改过的那几个（执行时可改的），和 ue_gm run 的 args 一个意思 */
  const favOf = (e: GmEntry): GmFav => ({
    key: e.key,
    args: e.custom ? overrides(e.custom, valuesOf(e.custom)) : argsOf(e),
  })
  const isFav = (e: GmEntry) => inCommon(d.gm, favOf(e))
  const toggle = (e: GmEntry) => void d.saveGm(toggleCommon(d.gm, favOf(e)))

  /** 宏的一步：自定义 GM 写 {custom, args}，Lua 写 {lua, args}，控制台命令写 {console}，C++ 写 {gm, args} */
  const stepOf = (e: GmEntry): Step => {
    if (e.custom) {
      const o = overrides(e.custom, valuesOf(e.custom))
      return Object.keys(o).length ? { custom: e.custom.id, args: o } : { custom: e.custom.id }
    }
    if (e.src === 'console') return { console: e.name }
    return e.src === 'lua' ? { lua: e.name, args: argsOf(e) } : { gm: e.name, args: argsOf(e) }
  }

  return {
    argsOf,
    valuesOf,
    setArg,
    setCustomArg,
    fill,
    exec: (e: GmEntry, a?: GmFav['args']) => void exec(e, a),
    running,
    outOf: (e: GmEntry) => outs[e.key],
    coutOf: (c: GmCustom) => couts[c.id],
    isFav,
    toggleFav: toggle,
    stepOf,
  }
}

export type GmRunState = ReturnType<typeof useGmRun>
