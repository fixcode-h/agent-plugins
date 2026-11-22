import { issue, type Check, type Issue, type StepRef } from './types.ts'

/**
 * 协议里有、GameTest 2.x 还没做的写法（分析文档 B10）：写了不报错但不生效，比报错更难查，所以先给警告。
 * 现在只有引用的 `client`（game-test-ref 第 1 节：2.0.0 只认字段、不生效，引用一律在步骤的世界里找）。
 * GameTest 做了以后从 FIELDS 里删掉那一项
 */
const FIELDS: { key: string; isRef: (o: Record<string, unknown>) => boolean; message: string }[] = [
  {
    key: 'client',
    isRef: (o) => 'class' in o || 'in' in o || 'ident' in o,
    message:
      '引用的 client 还没生效（GameTest 2.x）：多客户端时一律在这一步的世界里找；要换客户端先用 pie 切到那个世界',
  },
]

/** 找出一个值里写了未生效字段的引用；遇到子步骤（带 action 的对象）不进去，它自己会被单独检查 */
function scan(v: unknown, at: string, out: { path: string; message: string }[], top = true) {
  if (!v || typeof v !== 'object') return
  if (Array.isArray(v)) return v.forEach((x, i) => scan(x, `${at}.${i}`, out, false))
  const o = v as Record<string, unknown>
  if (!top && typeof o.action === 'string') return
  for (const f of FIELDS)
    if (o[f.key] !== undefined && o[f.key] !== null && f.isRef(o)) out.push({ path: at, message: f.message })
  for (const [k, x] of Object.entries(o)) scan(x, at ? `${at}.${k}` : k, out, false)
}

export const unsupported: Check = {
  name: 'unsupported',
  summary: '协议里有但 GameTest 还没做的写法（引用的 client）',
  run({ doc, steps }) {
    const out: Issue[] = []
    const found: { path: string; message: string }[] = []
    const top: StepRef = { step: doc, path: '', inGuard: false }
    scan(doc.objects, 'objects', found, false)
    for (const f of found) out.push(issue({ ...top, path: f.path }, 'not_supported', f.message, 'warning'))
    for (const s of steps) {
      const here: { path: string; message: string }[] = []
      scan(s.step, s.path, here)
      for (const f of here) out.push(issue(s, 'not_supported', f.message, 'warning'))
    }
    return out
  },
}
