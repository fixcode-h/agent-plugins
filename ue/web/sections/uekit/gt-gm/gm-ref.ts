import type { GmRun } from '../../../../server/store.ts'
import type { GmMacro } from '../../../../shared/gm/schema.ts'
import type { GmKind, GmRef } from '../../../../shared/gt-script/gm/expand.ts'
import { t } from '../../../host.ts'
import type { GmEntry } from '../../gm/data.ts'

/**
 * GM 页的条目（GmEntry、宏、最近执行）→ 测试里「执行 GM」存的引用（gm 字段，shared/gt-script/gm/expand.ts）。
 * 存的是「哪条 + 参数」，不拷 GM 的内容：GM 库里改了，下次存盘就跟上
 */

export function refOfEntry(e: GmEntry, args?: GmRef['args']): GmRef {
  switch (e.src) {
    case 'lua':
      return { kind: 'lua', name: e.name, args: args ?? e.params.map((p) => p.default ?? '') }
    case 'cpp':
    case 'engine':
      return { kind: 'cpp', name: e.name, ...(e.owner ? { owner: e.owner } : {}), args: args ?? e.params.map(() => '') }
    case 'custom':
      return { kind: 'custom', name: e.custom!.id, label: e.name, ...(args ? { args } : {}) }
    case 'console':
      return { kind: 'console', name: e.name }
  }
}

export const refOfMacro = (m: GmMacro): GmRef => ({ kind: 'macro', name: m.id, label: m.name })

/** 最近执行（GM 页「最近执行」、调用记录）里的一条：键 lua:名字 / cpp:类.名字 / custom:id / console:命令 */
export function refOfRecent(r: GmRun): GmRef | undefined {
  const i = r.key.indexOf(':')
  const kind = r.key.slice(0, i)
  const rest = r.key.slice(i + 1)
  if (kind === 'lua') return { kind: 'lua', name: rest, args: r.args }
  if (kind === 'console') return { kind: 'console', name: rest }
  if (kind === 'custom') return { kind: 'custom', name: rest, label: r.name, args: r.args }
  if (kind === 'cpp') {
    const dot = rest.lastIndexOf('.')
    return { kind: 'cpp', name: rest.slice(dot + 1), owner: rest.slice(0, dot), args: r.args }
  }
  return undefined
}

/** 和 GM 页一样的条目键：找回 GmEntry 显示参数、说明 */
export function keyOfRef(ref: GmRef): string {
  if (ref.kind === 'cpp') return `cpp:${ref.owner ?? ''}.${ref.name}`
  if (ref.kind === 'macro') return `macro:${ref.name}`
  return `${ref.kind}:${ref.name}`
}

export const entryOfRef = (ref: GmRef, entries: GmEntry[]) => {
  const key = keyOfRef(ref)
  return (
    entries.find((e) => e.key === key) ??
    // C++ 引用没记类（宏里的 gm 步骤）时按名字认
    (ref.kind === 'cpp' ? entries.find((e) => (e.src === 'cpp' || e.src === 'engine') && e.name === ref.name) : undefined)
  )
}

export const KIND_LABEL: Record<GmKind, () => string> = {
  cpp: () => 'C++',
  lua: () => 'Lua',
  console: () => t('命令'),
  custom: () => t('自定义 GM'),
  macro: () => t('宏'),
}

/** 节点上、附带 GM 每行的一句话：名字(参数, …) */
export function refText(ref: GmRef | undefined): string {
  if (!ref?.name) return t('还没选 GM')
  const name = ref.label ?? ref.name
  const a = ref.args
  const vals = Array.isArray(a)
    ? a.filter((v) => v !== '' && v !== undefined)
    : a
      ? Object.entries(a).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      : []
  return vals.length ? `${name}(${vals.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ')})` : name
}
