import { SCHEMA_VERSION } from '../../../../shared/gt-script/index.ts'
import { issue, type Check, type Issue } from './types.ts'

/** 顶层形状：kind、版本、steps 是数组、守护有 when 和 do。版本太旧（v1–v4）由 refs 检查报 schema_old */
const SUPPORTED = SCHEMA_VERSION

export const shape: Check = {
  name: 'shape',
  summary: '顶层字段、schemaVersion、守护的 when / do',
  run({ doc }) {
    const out: Issue[] = []
    const top = { step: doc, path: '', inGuard: false }
    if (doc.kind !== undefined && doc.kind !== 'gametest-scenario')
      out.push(issue(top, 'bad_type', `kind 应该是 "gametest-scenario"，现在是 ${JSON.stringify(doc.kind)}`))
    const v = doc.schemaVersion
    if (typeof v === 'number' && v > SUPPORTED)
      out.push(issue(top, 'schema_too_new', `schemaVersion ${v} 比支持的 ${SUPPORTED} 高`))
    if (!Array.isArray(doc.steps) || !doc.steps.length)
      out.push(issue({ ...top, path: 'steps' }, 'bad_type', 'steps 要是非空的步骤数组'))
    for (const k of ['params', 'vars', 'objects'])
      if (doc[k] !== undefined && (typeof doc[k] !== 'object' || Array.isArray(doc[k])))
        out.push(issue({ ...top, path: k }, 'bad_type', `${k} 要是对象（{名字: …}）`))
    if (doc.blockers !== undefined)
      out.push(issue({ ...top, path: 'blockers' }, 'blockers_removed', 'blockers 已改成 guards（脚本协议 5.1 节）'))
    const guards = Array.isArray(doc.guards) ? doc.guards : []
    guards.forEach((g, i) => {
      const ref = { step: (g ?? {}) as Record<string, unknown>, path: `guards.${i}`, inGuard: true }
      if (!g || typeof g !== 'object') return out.push(issue(ref, 'bad_type', '守护要是对象'))
      const o = g as Record<string, unknown>
      if (!o.when) out.push(issue(ref, 'bad_type', '守护缺 when（统一条件）'))
      if (!Array.isArray(o.do) || !o.do.length) out.push(issue(ref, 'bad_type', '守护缺 do（成立时做的步骤）'))
    })
    return out
  },
}
