import { condsOf } from '../blocks/index.ts'
import { walkChecks } from '../cond.ts'
import { exprOfValue, parseExpr, refsOf } from '../expr.ts'
import { REMOVED_EXPR_FUNCTIONS } from '../functions.ts'
import { getAt, pathStr } from '../path.ts'
import type { GtPath, GtScript, GtStep } from '../types.ts'
import { walk, walkGuards } from '../walk.ts'
import { allOps, COUNT_CMPS, implicitOp, opDef, opsFor } from './compare/index.ts'
import { IDENT_GROUP_DEPTH } from './ident-tree.ts'
import { oldPathHint, parsePropPath } from './path.ts'
import {
  findRefCycle,
  inObj,
  luaClassOf,
  looksLikeComponent,
  looksLikeSelector,
  looksLikeSubsystem,
  refForm,
  validPart,
  validSlate,
} from './ref.ts'
import { stateOf } from './states.ts'
import type { GtPropKind } from './types.ts'

/**
 * v5 脚本的离线校验（协议 game-test-ref 第 10 节的错误码）：引用的写法、in 成环、部件和 Slate 段的写法、属性路径
 * （v5 写法，旧写法报 path_old、写法不对报 path_syntax）、op 和属性类型对不对得上（只知道算出状态的类型；反射属性、
 * Lua 字段的类型由调用方 kindOf 给）、v3 旧写法（选择器、按控件写的条件、invoke / find / widget.*、text(sel)）。
 * 旧版本脚本不迁移（用户 2026-11-21），只报 schema_old。
 * 部件在不在类的树里（part_missing）、属性在不在（prop_missing）要读 WBP 和反射，在编辑器里的 gt.validate 做。
 * message 是给 Agent 和用户看的中文，写清楚怎么改；界面按 code 另行翻译。
 */
export interface RefIssue {
  /** 出问题的值在场景里的位置 */
  at: GtPath
  /** 在哪一步 / 哪条守护（步骤路径）；objects 里的没有 */
  owner?: GtPath
  code: string
  message: string
  level: 'error' | 'warning'
}

export interface ValidateRefOptions {
  /** 给出属性的类型（编辑器开着时按反射、面板按 ---@field）；不知道返回 undefined，就不查 op_type */
  kindOf?: (ref: unknown, prop: string) => GtPropKind | undefined
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export const SCHEMA_V5 = 5

/** 读到旧版本时的说明（C++ 那边同一句） */
export const SCHEMA_OLD_MESSAGE = '旧格式不再支持，请按新写法重写'

/** 条件里按控件写的判断（v3），现在写成 {obj, prop, op, value}（第 4 节） */
export const REMOVED_COND_KEYS = [
  'exists',
  'visible',
  'enabled',
  'checked',
  'selected',
  'text',
  'textContains',
  'textLike',
  'textMatches',
  'image',
  'count',
  'number',
  'field',
  'onScreen',
]

/** 不再认的动作和改成什么 */
export const REMOVED_ACTIONS: Record<string, string> = {
  invoke: 'obj.call（object 字段改成 obj）',
  find: 'obj.find（into 改成 saveAs）',
  'widget.close': 'obj.close（how: [{by: "remove"}]，或省略 how 按 closeRules）',
  'widget.call': 'obj.close（how: [{by: "call", function}]）',
}

const CLOSE_BY = ['call', 'lua', 'click', 'visibility', 'remove', 'pop', 'key', 'destroy']
const MANY = ['error', 'first', 'last', 'nearest']
const IN_WORDS = ['screen', 'world', 'lua', 'all']
/** 要 target 的动作（协议 5.1）；snapshot、screenshot、key、wheel 的 target 可选 */
const NEED_TARGET = ['click', 'drag', 'type', 'select', 'scroll', 'probe', 'stack.push', 'stack.pop', 'widget.remove']

interface Ctx {
  doc: GtScript
  objects: Obj
  out: RefIssue[]
  o: ValidateRefOptions
}

const add = (
  c: Ctx,
  at: GtPath,
  owner: GtPath | undefined,
  code: string,
  message: string,
  level: RefIssue['level'] = 'error',
) => c.out.push({ at, ...(owner ? { owner } : {}), code, message, level })

/** 值是变量或表达式：运行时才知道是什么，不查形状 */
const dynamic = (v: unknown) => typeof v === 'string' && (v.startsWith('$') || v.startsWith('='))

/** 一条判断项 / 标识项（第 3.3 节）。checkMode：条件里的对象判断（prop 可省 = :exists is true） */
export function checkItem(
  c: Ctx,
  item: unknown,
  at: GtPath,
  owner: GtPath | undefined,
  ref: unknown,
  checkMode = false,
) {
  if (!isObj(item)) return add(c, at, owner, 'bad_type', '判断项要写成 {prop, op, value}')
  const prop = item.prop
  if (prop === undefined && checkMode) return
  if (typeof prop !== 'string' || !prop)
    return add(c, at, owner, 'bad_type', '判断项缺 prop（属性路径，如 @.ShopId、@/TxtTitle:text、@:onScreen）')
  const hint = oldPathHint(prop)
  if (hint !== undefined)
    return add(
      c,
      [...at, 'prop'],
      owner,
      'path_old',
      `${prop} 是旧的路径写法，v5 不再认：改成 ${hint}（@ 对象自己，/子控件或组件，.属性，.函数()，#Lua 字段，:运行状态）`,
    )
  const parsed = parsePropPath(prop)
  if ('error' in parsed)
    return add(
      c,
      [...at, 'prop'],
      owner,
      'path_syntax',
      `${prop} 第 ${parsed.at + 1} 个字符：${parsed.error}（写法：@/子控件.属性、@.属性、@.函数()、@#Lua字段、@/子控件:状态）`,
    )
  const last = parsed.segs.at(-1)
  if (!last || last.kind === 'child')
    return add(
      c,
      [...at, 'prop'],
      owner,
      'path_syntax',
      `${prop} 只到对象 / 子控件，后面要接属性、函数、Lua 字段或状态`,
    )
  const state = last.kind === 'state' ? stateOf(last.name) : undefined
  if (last.kind === 'state' && !state)
    return add(
      c,
      [...at, 'prop'],
      owner,
      'bad_type',
      `${prop}：没有这个状态（能用 :exists :onScreen :shown :enabled :text :textKey :count :index :selected :checked :image :hovered :focused :pos :size :location :distance :hiddenInGame :class）`,
    )
  const op = item.op
  if (op !== undefined && (typeof op !== 'string' || !allOps().has(op)))
    return add(
      c,
      [...at, 'op'],
      owner,
      'op_unknown',
      `不认识的比较 ${JSON.stringify(op)}（能用的按属性类型选，见 gt.props 每项的 ops）`,
    )
  const kind = state?.kind ?? c.o.kindOf?.(ref, prop)
  const name = typeof op === 'string' ? op : kind ? implicitOp(kind) : undefined
  if (kind && name && !opsFor(kind).includes(name)) {
    const ops = opsFor(kind)
    return add(
      c,
      [...at, 'op'],
      owner,
      'op_type',
      ops.length
        ? `${prop} 是 ${kind}，不能用 ${name}${op === undefined ? '（省略 op 时按 eq 比）' : ''}：能用 ${ops.join(' ')}`
        : `${prop} 是 ${kind}，不能直接比较：展开选里面的成员`,
    )
  }
  if (!name) return
  const def = kind ? opDef(kind, name) : firstDef(name)
  const v = item.value
  if (!def || dynamic(v)) return
  if (def.value === 'pair' && !(Array.isArray(v) && v.length === 2))
    add(c, [...at, 'value'], owner, 'bad_type', `${name} 的 value 要写成 [下限, 上限]`)
  if (def.value === 'list' && !Array.isArray(v))
    add(c, [...at, 'value'], owner, 'bad_type', `${name} 的 value 要写成数组`)
  if (def.value === 'count') {
    if (item.cmp !== undefined && !(COUNT_CMPS as readonly string[]).includes(String(item.cmp)))
      add(c, [...at, 'cmp'], owner, 'op_unknown', `count 的 cmp 只能是 ${COUNT_CMPS.join(' ')}`)
    if (typeof v !== 'number') add(c, [...at, 'value'], owner, 'bad_type', 'count 的 value 要写数字')
  }
}

/**
 * ident 里的一项（协议 3.5，GameTest 2.1.6）：判断项，或 {all|any: [...], not?} 条件组（递归，最多 IDENT_GROUP_DEPTH 层）
 */
function checkIdentNode(c: Ctx, node: unknown, at: GtPath, owner: GtPath | undefined, ref: unknown, depth: number) {
  if (!isObj(node))
    return add(c, at, owner, 'bad_type', '判断项要写成 {prop, op, value}，条件组写 {all: [...]} 或 {any: [...]}')
  if (node.not !== undefined && typeof node.not !== 'boolean')
    add(c, [...at, 'not'], owner, 'bad_type', 'not 要写 true 或 false')
  const hasAll = 'all' in node
  const hasAny = 'any' in node
  if (!hasAll && !hasAny) return checkItem(c, node, at, owner, ref)
  if (hasAll && hasAny)
    return add(
      c,
      at,
      owner,
      'bad_type',
      '条件组只能写 all 或 any 其中一个：都满足写 all，任一满足写 any，混着来就套子组',
    )
  for (const k of Object.keys(node))
    if (!['all', 'any', 'not'].includes(k))
      add(c, [...at, k], owner, 'unknown_field', `条件组只认 all / any / not，不认 ${k}`)
  if (depth >= IDENT_GROUP_DEPTH) return add(c, at, owner, 'bad_type', `条件组最多套 ${IDENT_GROUP_DEPTH} 层`)
  const key = hasAll ? 'all' : 'any'
  const list = node[key]
  if (!Array.isArray(list) || !list.length)
    return add(c, [...at, key], owner, 'bad_type', `${key} 要写成非空数组：[判断项或子组…]`)
  list.forEach((k, i) => checkIdentNode(c, k, [...at, key, i], owner, ref, depth + 1))
}

/** 不知道 kind 时按 op 名字取形状：同名 op 在各个 kind 里的 value 形状一样 */
function firstDef(name: string) {
  for (const k of [
    'bool',
    'int',
    'string',
    'text',
    'enum',
    'visibility',
    'object',
    'asset',
    'vector',
    'color',
    'array',
  ] as GtPropKind[]) {
    const d = opDef(k, name)
    if (d) return d
  }
  return undefined
}

/** 一个引用（三种写法）。inObjects：objects 里的定义，只能是内联写法 */
export function checkRef(c: Ctx, ref: unknown, at: GtPath, owner: GtPath | undefined, inObjects = false) {
  const form = refForm(ref)
  if (!form) {
    if (typeof ref === 'string' && looksLikeSelector(ref))
      return add(
        c,
        at,
        owner,
        'selector_removed',
        `${ref} 是 v3 的选择器，不再支持：写成 {obj: {class: "WBP_X", ident: […]}, part: "控件名"}`,
      )
    return add(c, at, owner, 'bad_type', '引用要写成 objects 里的名字、"$变量" 或 {class, in?, ident?}')
  }
  if (inObjects && form !== 'inline')
    return add(c, at, owner, 'bad_type', 'objects 里的值要写成对象形式 {class, …}，不能再引用别的名字')
  if (form === 'name') {
    const name = ref as string
    if (looksLikeSelector(name))
      return add(c, at, owner, 'selector_removed', `${name} 是 v3 的选择器，不再支持：写成 {obj: 引用, part: "控件名"}`)
    if (!(name in c.objects))
      add(
        c,
        at,
        owner,
        'ref_not_found',
        `objects 里没有 ${name}：在场景顶层 objects 里定义，或写成内联引用 {class, ident}`,
      )
    return
  }
  if (form === 'var') return
  const r = ref as Obj
  const cls = String(r.class).trim()
  if (!cls)
    add(
      c,
      [...at, 'class'],
      owner,
      'ref_bad_class',
      '引用缺 class（类名或资源路径，如 WBP_Shop、/Game/UI/WBP_Shop；按 Lua 类认写 lua:模块名）',
    )
  else if (luaClassOf(cls) === '')
    add(c, [...at, 'class'], owner, 'ref_bad_class', 'lua: 后面要写 Lua 模块名（require 路径，如 lua:UI/Shop/Shop）')
  for (const k of ['key', 'component'])
    if (k in r)
      add(
        c,
        [...at, k],
        owner,
        'bad_type',
        k === 'key'
          ? 'key 是 v3 的写法：改成 ident: [{prop: "@.X", op: "eq", value}]'
          : 'component 是 v3 的写法：另起一个组件引用 {class: 组件类, in: {obj: Actor 引用}}',
      )
  const where = r.in
  const io = inObj(where)
  if (io) {
    checkRef(c, io.obj, [...at, 'in', 'obj'], owner)
    if (io.part !== undefined && (typeof io.part !== 'string' || !validPart(io.part)))
      add(
        c,
        [...at, 'in', 'part'],
        owner,
        'bad_type',
        `容器部件 ${JSON.stringify(io.part)} 写法不对：设计器里的控件名，嵌套 WBP 用 . 连`,
      )
  } else if (Array.isArray(where)) {
    const bad = where.filter((w) => typeof w !== 'string' || !IN_WORDS.includes(w))
    if (bad.length || !where.length)
      add(c, [...at, 'in'], owner, 'bad_type', 'in 写成数组时每项是 screen / world / lua（都不限写 "all"）')
  } else if (where !== undefined && !(typeof where === 'string' && (IN_WORDS.includes(where) || where.startsWith('@'))))
    add(
      c,
      [...at, 'in'],
      owner,
      'bad_type',
      where === 'widgets'
        ? 'in: "widgets" 是 v3 的写法，写 "screen"'
        : 'in 写 screen / world / lua / all（可以写成数组）、@来源.路径，或 {obj: 引用, part: "容器部件"}',
    )
  else if (where === undefined && cls && looksLikeComponent(cls))
    add(c, at, owner, 'ref_need_owner', `${cls} 像是组件类：写 in: {obj: 它所在的 Actor 的引用}`)
  const ident = r.ident
  if (ident !== undefined && !Array.isArray(ident))
    add(c, [...at, 'ident'], owner, 'bad_type', 'ident 要写成数组 [{prop, op, value}]')
  if (Array.isArray(ident)) {
    if (ident.length && cls && looksLikeSubsystem(cls))
      add(c, [...at, 'ident'], owner, 'bad_type', '子系统是单例，ident 要留空', 'warning')
    ident.forEach((it, i) => checkIdentNode(c, it, [...at, 'ident', i], owner, ref, 0))
  }
  if (r.many !== undefined && !MANY.includes(String(r.many)))
    add(c, [...at, 'many'], owner, 'bad_type', `many 只能是 ${MANY.join(' / ')}`)
  if (r.near !== undefined && r.near !== null && !Array.isArray(r.near) && r.near !== '@pawn')
    checkRef(c, r.near, [...at, 'near'], owner)
}

/** target 写法（第 2 节）：{obj, part?, slate?}，或直接一个引用 */
export function checkTarget(c: Ctx, v: unknown, at: GtPath, owner: GtPath | undefined) {
  if (isObj(v) && 'obj' in v) {
    checkRef(c, v.obj, [...at, 'obj'], owner)
    if (v.part !== undefined && (typeof v.part !== 'string' || !validPart(v.part)))
      add(
        c,
        [...at, 'part'],
        owner,
        'bad_type',
        `部件 ${JSON.stringify(v.part)} 写法不对：类自己的 WidgetTree 里的控件名，嵌套 WBP 用 . 连（Header.BtnClose）`,
      )
    if (v.slate !== undefined && (typeof v.slate !== 'string' || !validSlate(v.slate)))
      add(c, [...at, 'slate'], owner, 'bad_type', `Slate 段写成 类型[text=子串][序号]，多段用 / 分隔`)
    return
  }
  checkRef(c, v, at, owner)
}

/** 一棵条件里的每条判断 */
function checkCond(c: Ctx, cond: unknown, at: GtPath, owner: GtPath | undefined) {
  walkChecks(cond, (leaf, p) => {
    const here = [...at, ...p]
    if ('obj' in leaf) {
      checkRef(c, leaf.obj, [...here, 'obj'], owner)
      checkItem(c, leaf, here, owner, leaf.obj, true)
      return
    }
    const old = REMOVED_COND_KEYS.filter((k) => k in leaf)
    if (old.length || 'target' in leaf)
      add(
        c,
        here,
        owner,
        'cond_removed',
        `按控件写的判断（${['target', ...old].filter((k) => k in leaf).join('、')}）不再支持：写成 {obj: 引用, prop: "@:onScreen" / "@/部件:text" / "@.X", op, value}`,
      )
  })
}

/** 一步自己的字段里的表达式（不进子槽）：v3 的 text(sel) 这类函数报 expr_removed */
function checkExprs(c: Ctx, v: unknown, at: GtPath, owner: GtPath, skip: Set<string>) {
  const visit = (x: unknown, p: GtPath) => {
    if (typeof x === 'string') {
      const e = exprOfValue(x)
      if (e !== undefined) one(e, p)
    } else if (Array.isArray(x)) x.forEach((y, i) => visit(y, [...p, i]))
    else if (isObj(x))
      for (const [k, y] of Object.entries(x)) {
        if (p.length === at.length && skip.has(k)) continue
        if (k === 'expr' && typeof y === 'string') one(y, [...p, k])
        else visit(y, [...p, k])
      }
  }
  const one = (text: string, p: GtPath) => {
    const r = parseExpr(text)
    if ('error' in r) return
    for (const call of refsOf(r.ast).calls)
      if (!call.onSource && call.name in REMOVED_EXPR_FUNCTIONS)
        add(
          c,
          p,
          owner,
          'expr_removed',
          `${call.name}(选择器) 是 v3 的写法：改成 prop(引用, "${REMOVED_EXPR_FUNCTIONS[call.name]}")`,
        )
  }
  visit(v, at)
}

const SLOT_KEYS = new Set(['do', 'then', 'else', 'elif', 'guards'])

function checkStep(c: Ctx, s: GtStep, at: GtPath) {
  const a = s.action
  const need = (k: string, why: string) =>
    (s[k] === undefined || s[k] === '' || s[k] === null) &&
    add(c, [...at, k], at, 'param_missing', `${a} 缺 ${k}：${why}`)
  if (a in REMOVED_ACTIONS) add(c, at, at, 'action_removed', `${a} 不再支持：改用 ${REMOVED_ACTIONS[a]}`)
  if (a === 'wait' && (s.until === 'widget' || s.until === 'widgetGone'))
    add(
      c,
      at,
      at,
      'action_removed',
      `wait until=${s.until} 不再支持：改用 obj.wait 或 wait until=cond + {obj, prop: "@:exists"}`,
    )
  // target：set 设变量（有 var）时不是界面动作
  for (const k of ['target', 'toTarget']) if (s[k] !== undefined && s[k] !== '') checkTarget(c, s[k], [...at, k], at)
  if (NEED_TARGET.includes(a) && (s.target === undefined || s.target === ''))
    need('target', '{obj: 引用, part?: "控件名"}')
  if (a === 'loop' && s.each !== undefined) checkTarget(c, s.each, [...at, 'each'], at)
  if (a.startsWith('obj.') && s.obj !== undefined && s.obj !== '') {
    // obj.call 的 obj 还可以是取值来源（@sub.X、@luaMod.X），不是引用
    if (!(a === 'obj.call' && typeof s.obj === 'string' && s.obj.startsWith('@')))
      checkRef(c, s.obj, [...at, 'obj'], at)
  }
  if (a === 'obj.close') {
    need('obj', '要关掉的对象的引用')
    if (s.how !== undefined && !Array.isArray(s.how))
      add(c, [...at, 'how'], at, 'bad_type', 'how 要写成数组 [{by, …}]，按顺序试')
    ;(Array.isArray(s.how) ? s.how : []).forEach((h, i) => {
      const hp = [...at, 'how', i]
      if (!isObj(h) || !CLOSE_BY.includes(String(h.by)))
        return add(c, hp, at, 'bad_type', `how 的 by 只能是 ${CLOSE_BY.join(' / ')}`)
      if ((h.by === 'call' || h.by === 'lua') && !h.function)
        add(c, hp, at, 'param_missing', `by: ${h.by} 要写 function`)
      if (h.by === 'click' && !h.part) add(c, hp, at, 'param_missing', 'by: click 要写 part（要点的部件）')
      if (h.part !== undefined && (typeof h.part !== 'string' || !validPart(h.part)))
        add(c, [...hp, 'part'], at, 'bad_type', `部件 ${JSON.stringify(h.part)} 写法不对`)
      if (h.by === 'visibility' && h.value !== undefined && h.value !== 'Collapsed' && h.value !== 'Hidden')
        add(c, [...hp, 'value'], at, 'bad_type', 'by: visibility 的 value 只能是 Collapsed / Hidden')
    })
    if (s.verify !== undefined && !['gone', 'hidden', 'none'].includes(String(s.verify)))
      add(c, [...at, 'verify'], at, 'bad_type', 'verify 只能是 gone / hidden / none')
  }
  if (a === 'obj.set') {
    need('obj', '对象的引用')
    need('prop', '属性路径（@.X、@/部件.Text、@#x）')
    if (!('value' in s)) add(c, at, at, 'param_missing', 'obj.set 缺 value')
    else if (typeof s.prop === 'string') {
      checkItem(c, { prop: s.prop }, at, at, s.obj)
      const last = parsePropPath(s.prop)
      const seg = 'error' in last ? undefined : last.segs.at(-1)
      if (seg?.kind === 'state' || seg?.kind === 'fn')
        add(
          c,
          [...at, 'prop'],
          at,
          'prop_readonly',
          seg.kind === 'state'
            ? `${s.prop} 是算出来的状态，不能设：改设对应的属性（如 @/部件.Visibility）`
            : `${s.prop} 是取值函数，不能设：改设对应的属性，或用 obj.call 调设置函数`,
        )
    }
  }
  if (a === 'obj.call') {
    need('function', '函数名；静态函数写 类名.函数')
    if ((s.obj === undefined || s.obj === '') && typeof s.function === 'string' && !s.function.includes('.'))
      add(c, at, at, 'param_missing', 'obj.call 缺 obj：给对象引用，或静态函数把 function 写成 类名.函数')
    if (s.part !== undefined && (typeof s.part !== 'string' || !validPart(s.part)))
      add(c, [...at, 'part'], at, 'bad_type', `部件 ${JSON.stringify(s.part)} 写法不对`)
  }
  if (a === 'obj.find') {
    need('obj', '要找的对象的引用')
    need('saveAs', '存进哪个变量（之后写 "$名字"）')
  }
  if (a === 'obj.wait') {
    need('obj', '要等的对象的引用')
    checkItem(c, s, at, at, s.obj, true)
  }
  for (const cr of condsOf(s)) checkCond(c, getAt(s, cr.key), [...at, ...cr.key], at)
  checkExprs(c, s, at, at, SLOT_KEYS)
}

/** 整份 v5 场景（或 _settings.json 的守护部分）的引用检查。旧版本只报 schema_old，其余不查（不迁移，按新写法重写） */
export function validateRefs(doc: GtScript, o: ValidateRefOptions = {}): RefIssue[] {
  const c: Ctx = { doc, objects: isObj(doc.objects) ? doc.objects : {}, out: [], o }
  const v = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  if (v < SCHEMA_V5) {
    add(
      c,
      ['schemaVersion'],
      undefined,
      'schema_old',
      `这是 v${v} 格式的脚本：${SCHEMA_OLD_MESSAGE}（schemaVersion 5）`,
    )
    return c.out
  }
  if (doc.objects !== undefined && !isObj(doc.objects))
    add(c, ['objects'], undefined, 'bad_type', 'objects 要是对象 {名字: 引用}')
  for (const [name, ref] of Object.entries(c.objects)) {
    if (name.startsWith('$')) add(c, ['objects', name], undefined, 'bad_type', `引用名不能以 $ 开头：${name}`)
    checkRef(c, ref, ['objects', name], undefined, true)
  }
  const cycle = findRefCycle(c.objects)
  if (cycle) add(c, ['objects', cycle[0]], undefined, 'ref_cycle', `objects 里的 in 成环了：${cycle.join(' → ')}`)
  walk(doc, (e) => checkStep(c, e.step, e.path))
  walkGuards(doc, (g) => checkCond(c, g.guard.when, [...g.path, 'when'], g.path))
  return c.out
}

/** _settings.json（协议第 6 节）：旧的 itemKeys / objectKeys 报 settings_old（不迁移）；守护和 closeRules 照场景查 */
export function validateSettingsRefs(doc: Obj, o: ValidateRefOptions = {}): RefIssue[] {
  const out: RefIssue[] = []
  for (const k of ['itemKeys', 'objectKeys', 'blockers'])
    if (k in doc)
      out.push({
        at: [k],
        code: 'settings_old',
        message: `${k} 是旧的运行配置字段：${SCHEMA_OLD_MESSAGE}（改成 identRules / guards）`,
        level: 'error',
      })
  out.push(...validateRefs({ schemaVersion: SCHEMA_V5, guards: doc.guards as GtScript['guards'] }, o))
  const rules = (key: string) => (Array.isArray(doc[key]) ? (doc[key] as unknown[]) : [])
  rules('identRules').forEach((r, i) => {
    if (!isObj(r) || typeof r.class !== 'string' || !r.class || !Array.isArray(r.ident))
      out.push({
        at: ['identRules', i],
        code: 'bad_type',
        message: 'identRules 每条写 {class, in?, ident: [属性路径…]}',
        level: 'error',
      })
    else
      r.ident.forEach((p, k) => {
        const hint = typeof p === 'string' ? oldPathHint(p) : undefined
        if (hint !== undefined)
          out.push({
            at: ['identRules', i, 'ident', k],
            code: 'path_old',
            message: `${String(p)} 是旧的路径写法，v5 不再认：改成 ${hint}`,
            level: 'error',
          })
      })
  })
  rules('closeRules').forEach((r, i) => {
    if (!isObj(r) || typeof r.class !== 'string' || !r.class || !Array.isArray(r.how))
      out.push({
        at: ['closeRules', i],
        code: 'bad_type',
        message: 'closeRules 每条写 {class, how: [{by, …}], verify?}',
        level: 'error',
      })
  })
  return out
}

/** 给报告用的位置写法（steps.3.target.obj） */
export const issueAt = (x: RefIssue) => pathStr(x.at)
