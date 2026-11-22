import type { GmRef } from './expand.ts'

/**
 * GM 页「最近执行」的一条（store.ts 的 GmRun：键 lua:名字 / cpp:类.名字 / custom:id / console:命令）→ 测试里「执行 GM」存的引用。
 * 网页的选 GM 弹窗和 ue_gametest look what=gmRecent（把用户刚在 GM 页点过的变成测试步骤，测试页梳理 F5）共用
 */
export interface GmRunLike {
  key: string
  name?: string
  args?: GmRef['args']
}

export function refOfRun(r: GmRunLike): GmRef | undefined {
  const i = r.key.indexOf(':')
  const kind = r.key.slice(0, i)
  const rest = r.key.slice(i + 1)
  if (kind === 'lua') return { kind: 'lua', name: rest, ...(r.args ? { args: r.args } : {}) }
  if (kind === 'console') return { kind: 'console', name: rest }
  if (kind === 'custom') return { kind: 'custom', name: rest, ...(r.name ? { label: r.name } : {}), ...(r.args ? { args: r.args } : {}) }
  if (kind === 'cpp') {
    const dot = rest.lastIndexOf('.')
    return { kind: 'cpp', name: rest.slice(dot + 1), owner: rest.slice(0, dot), ...(r.args ? { args: r.args } : {}) }
  }
  return undefined
}
