import type { GtGuard } from '../../types.ts'
import type { GtIdentRule } from '../types.ts'
import { flushTodo, newCtx, type MigrateTodo } from './context.ts'
import { keyProp } from './objects.ts'
import { migrateScript } from './script.ts'
import { selectorToTarget } from './selector.ts'

/**
 * `_settings.json` 一起迁（协议第 6、9 节）：
 * - itemKeys [{entry, container?, by}] → identRules [{class: entry, in?: {obj, part: 容器}, ident: [属性路径…]}]
 * - objectKeys [{class, by}] → identRules [{class, ident}]
 * - blockers（1.9 以前的阻挡界面，还没被 GameTest 改写的）→ guards（直接写 v4：obj.close）
 * - guards 里的 when / do 照场景迁
 * 其余字段原样。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export interface SettingsMigrateResult {
  doc: Obj
  todos: MigrateTodo[]
  changed: boolean
}

const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []

/** blockers[] → guards[]（GameTest 1.9 的 5.1 表，do 直接写 v4 的动作） */
function blockerGuard(b: Obj, i: number): GtGuard {
  const widget = String(b.widget ?? '')
  const obj = { class: widget }
  const action = b.action ?? 'close'
  const step =
    action === 'command'
      ? { action: 'console', command: b.command }
      : { action: 'obj.close', obj, how: [action === 'call' ? { by: 'call', function: b.function } : { by: 'remove' }] }
  return {
    id: `b${i + 1}`,
    name: typeof b.name === 'string' && b.name ? b.name : widget,
    when: {
      obj,
      prop: ':onScreen',
      op: 'is',
      value: true,
      ...(typeof b.delayMs === 'number' && b.delayMs > 0 ? { settleMs: b.delayMs } : {}),
    },
    do: [step],
    ...(b.enabled === false ? { disabled: true } : {}),
    ...(typeof b.note === 'string' && b.note ? { note: b.note } : {}),
  }
}

export function migrateSettings(doc: Obj): SettingsMigrateResult {
  const out: Obj = structuredClone(doc)
  const ctx = newCtx()
  const rules: GtIdentRule[] = Array.isArray(out.identRules) ? (out.identRules as GtIdentRule[]) : []
  if (Array.isArray(out.itemKeys))
    for (const raw of out.itemKeys) {
      if (!isObj(raw) || typeof raw.entry !== 'string' || !raw.entry) continue
      const by = strs(raw.by)
      // 条件左边没写来源的：录制时多半是 ListView 的数据对象（GameTest 1.4 的默认），按 @item. 迁、在 note 里说明
      const bare = by.filter((x) => !x.startsWith('@'))
      const rule: GtIdentRule = { class: raw.entry, ident: by.map((x) => (x.startsWith('@') ? x : `@item.${x}`)) }
      if (typeof raw.container === 'string' && raw.container) {
        ctx.hint = undefined
        const t = selectorToTarget(raw.container, ctx)
        if (t) rule.in = { obj: t.obj, ...(t.part ? { part: t.part } : {}) }
      }
      if (bare.length)
        rule.note = `从 itemKeys 迁移：${bare.join('、')} 按条目的数据对象（@item.）认，容器不是 ListView 时改成 @self.`
      flushTodo(ctx, rule as unknown as Obj, `identRules.${rules.length}`)
      rules.push(rule)
    }
  if (Array.isArray(out.objectKeys))
    for (const raw of out.objectKeys) {
      if (!isObj(raw) || typeof raw.class !== 'string' || !raw.class) continue
      rules.push({ class: raw.class, ident: strs(raw.by).map(keyProp) })
    }
  delete out.itemKeys
  delete out.objectKeys
  if (rules.length) out.identRules = rules
  const guards: GtGuard[] = Array.isArray(out.guards) ? (out.guards as GtGuard[]) : []
  if (Array.isArray(out.blockers)) {
    out.blockers.forEach((b, i) => isObj(b) && guards.push(blockerGuard(b, i)))
    delete out.blockers
  }
  const todos = [...ctx.todos]
  if (guards.length) {
    // 守护借场景的迁移（when 的条件、do 里的 widget.close 这些），迁完放回来
    const r = migrateScript({ schemaVersion: 3, guards })
    out.guards = r.doc.guards
    todos.push(...r.todos)
  }
  return { doc: out, todos, changed: JSON.stringify(out) !== JSON.stringify(doc) }
}
