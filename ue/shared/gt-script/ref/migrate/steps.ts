import type { GtStep } from '../../types.ts'
import { propOnPart } from '../prop-path.ts'
import { todo, type MigrateCtx } from './context.ts'
import { migrateCond, WIDGET_KEYS } from './cond.ts'
import { migrateExprsIn, propCall } from './expr.ts'
import { unwrapObjRef } from './objects.ts'
import { selectorToRef, selectorToTarget } from './selector.ts'

/**
 * 一步的迁移（协议第 9 节的动作几行）：改的是传进来的步骤对象（调用方先整份拷贝）。
 * 先按动作换写法（STEP_TABLE，一个动作一项），再把还是字符串的 target / toTarget 换成部件写法，
 * 再迁条件（skipIf 省略 target = 这一步自己的）和表达式。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 1.x assert 直接写在步骤上的判断字段：收进 cond */
const ASSERT_KEYS = [...WIDGET_KEYS, 'any', 'equals', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'matches']
/** 子步骤槽、录制线索：不在这一步里改写表达式（子步骤自己会被遍历到） */
const NOT_OWN = new Set(['do', 'then', 'else', 'elif', 'guards', 'hint'])

/** v3 find 没写 into 时用路径末段当句柄名 */
function handleName(sel: unknown) {
  const m = /([A-Za-z_]\w*)\W*$/.exec(String(sel ?? ''))
  return m ? m[1] : 'found'
}

type StepMigrator = (s: Obj, ctx: MigrateCtx) => void

const STEP_TABLE: Record<string, StepMigrator> = {
  find(s, ctx) {
    const t = selectorToTarget(s.target, ctx)
    const name = typeof s.into === 'string' && s.into ? s.into.replace(/^@/, '') : handleName(s.target)
    s.action = 'obj.find'
    if (t) {
      s.obj = t.obj
      if (t.slate) todo(ctx, `find 抓的是 Slate 控件 ${t.slate}，v4 只存对象`)
      // 之后的 @句柄>X 写成 {obj: "$句柄", part: 部件.X}
      ctx.handles.set(name, t.part)
    }
    s.saveAs = name
    delete s.target
    delete s.into
  },
  'widget.close'(s, ctx) {
    s.action = 'obj.close'
    s.obj = selectorToRef(s.target, ctx, '要关') ?? ''
    s.how = [{ by: 'remove' }]
    delete s.target
  },
  'widget.call'(s, ctx) {
    s.action = 'obj.close'
    s.obj = selectorToRef(s.target, ctx, '要调函数') ?? ''
    s.how = [{ by: 'call', function: s.function }]
    delete s.target
    delete s.function
  },
  invoke(s, ctx) {
    s.action = 'obj.call'
    const o = unwrapObjRef(s.object)
    if (isObj(o) && 'target' in o) {
      const t = selectorToTarget(o.target, ctx)
      if (t) {
        s.obj = t.obj
        if (t.part) s.part = t.part
      }
    } else if (o === '@lua' && s.target !== undefined) {
      const t = selectorToTarget(s.target, ctx)
      if (t) s.obj = t.obj
      todo(ctx, '原来调的是界面绑的 Lua 实例上的函数：确认 obj.call 在这个对象上调得到（或改成项目 Lua 接口）')
      delete s.target
    } else if (o !== undefined && o !== '') s.obj = o
    delete s.object
  },
  wait(s, ctx) {
    if (s.until !== 'widget' && s.until !== 'widgetGone') return
    const t = selectorToTarget(s.target, ctx)
    const gone = s.until === 'widgetGone'
    s.until = 'cond'
    if (t) s.cond = { obj: t.obj, prop: propOnPart(t.part, ':exists'), op: 'is', value: !gone }
    else todo(ctx, `wait until=${gone ? 'widgetGone' : 'widget'} 没写 target`)
    delete s.target
  },
  assert(s, ctx) {
    const keys = ASSERT_KEYS.filter((k) => k in s)
    if (!keys.length || !keys.some((k) => WIDGET_KEYS.includes(k) || k === 'any')) return
    const leaf: Obj = { target: s.target }
    for (const k of keys) {
      leaf[k] = s[k]
      delete s[k]
    }
    const cond = migrateCond(leaf, ctx)
    s.cond = isObj(s.cond) ? { all: [s.cond, cond] } : cond
    delete s.target
  },
  set(s, ctx) {
    if (!isObj(s.from)) return
    const f = s.from
    const t = selectorToTarget(f.target, ctx)
    if (!t) return todo(ctx, 'set from 没写 target')
    const state = f.read === 'visible' ? ':shown' : f.read === 'enabled' ? ':enabled' : ':text'
    const read = propCall(t.obj, t.part, state)
    s.value = `=${f.read === 'number' ? `num(${read})` : read}`
    if (!['text', 'number', 'visible', 'enabled', undefined].includes(f.read as string))
      todo(ctx, `set from 的 read: ${String(f.read)} 不认识，按文字读了`)
    delete s.from
  },
  // 自带接口里按控件的（Widget.Text 这类）参数 target 也是选择器
  api(s, ctx) {
    if (isObj(s.args) && typeof s.args.target === 'string') {
      const t = selectorToTarget(s.args.target, ctx)
      if (t) s.args = { ...s.args, target: t }
    }
  },
  loop(s, ctx) {
    if (typeof s.each === 'string') {
      const t = selectorToTarget(s.each, ctx)
      if (t) s.each = { obj: t.obj, ...(t.part ? { part: t.part } : {}) }
    }
  },
}

/** 条件字段（if / elif 的 cond、loop 的 until / while、assert / wait 的 cond、obj.call 的 expect、skipIf） */
function migrateConds(s: Obj, ctx: MigrateCtx, ownTarget: unknown) {
  for (const k of ['cond', 'until', 'while', 'expect']) if (isObj(s[k])) s[k] = migrateCond(s[k], ctx)
  if (Array.isArray(s.elif))
    for (const e of s.elif) if (isObj(e) && isObj(e.cond)) e.cond = migrateExprsIn(migrateCond(e.cond, ctx), ctx)
  if (isObj(s.skipIf)) s.skipIf = migrateCond(s.skipIf, ctx, ownTarget)
}

export function migrateStep(step: GtStep, ctx: MigrateCtx, version: number) {
  const s = step as Obj
  ctx.hint = isObj(s.hint) ? s.hint : undefined
  const ownTarget = s.target
  // v1 的 click / type 默认不动鼠标（和 GameTest 读 v1 时一样），写明 via，行为不变
  if (version < 2 && (s.action === 'click' || s.action === 'type') && !('via' in s)) s.via = 'code'
  STEP_TABLE[String(s.action)]?.(s, ctx)
  for (const k of ['target', 'toTarget']) {
    if (typeof s[k] !== 'string' || !s[k]) continue
    const t = selectorToTarget(s[k], ctx)
    if (t) s[k] = t
  }
  migrateConds(s, ctx, ownTarget)
  for (const [k, v] of Object.entries(s)) if (!NOT_OWN.has(k)) s[k] = migrateExprsIn(v, ctx, k)
  ctx.hint = undefined
}
