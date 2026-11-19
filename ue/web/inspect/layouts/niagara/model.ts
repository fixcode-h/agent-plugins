import { refPath } from '../preview/model.ts'

/**
 * Niagara 布局（效果图 B10）的纯数据：系统的 EmitterHandles（名字、开关、发射器对象），读不到时退到子对象里的 NiagaraEmitter；
 * 每个发射器下面挂它的脚本（子对象里路径在它下面的 NiagaraScript）。模块栈在脚本图里，UELink 导不出来。单测在 niagara.test.ts
 */
export interface Emitter {
  name: string
  /** 发射器对象路径（细节看它）；读不到时空 */
  path: string
  enabled: boolean
  scripts: { path: string; name: string }[]
}

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/** Instance 在 UE 5.1 起是 FVersionedNiagaraEmitter {Emitter, Version}，之前直接是发射器路径 */
function emitterPath(h: Record<string, unknown>): string {
  const inst = h.Instance
  if (inst && typeof inst === 'object') return refPath((inst as Record<string, unknown>).Emitter)
  return refPath(inst ?? h.Emitter)
}

export function emitters(
  props: Record<string, unknown> | undefined,
  subs: { path: string; name: string; class: string }[] | undefined,
): Emitter[] {
  const scriptsOf = (p: string) =>
    (subs ?? [])
      .filter((s) => s.class === 'NiagaraScript' && p && s.path.startsWith(p) && s.path !== p)
      .map((s) => ({ path: s.path, name: s.name.split(/[.:]/).pop() ?? s.name }))
  const handles = list(props?.EmitterHandles)
  if (handles.length)
    return handles.map((h) => {
      const path = emitterPath(h)
      return {
        name: String(h.Name ?? '') || (path.split(/[.:]/).pop() ?? '?'),
        path: path === 'None' ? '' : path,
        enabled: h.bIsEnabled !== false && h.bIsEnabled !== 'false',
        scripts: scriptsOf(path),
      }
    })
  return (subs ?? [])
    .filter((s) => s.class === 'NiagaraEmitter')
    .map((s) => ({
      name: s.name.split(/[.:]/).pop() ?? s.name,
      path: s.path,
      enabled: true,
      scripts: scriptsOf(s.path),
    }))
}
