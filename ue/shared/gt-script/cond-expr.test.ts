// 统一条件树的结构操作，和表达式的解析、引用、补全位置。
// 用法：node --test ue/shared/gt-script/cond-expr.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addTo,
  countChecks,
  moveIn,
  parseExpr,
  refsOf,
  removeAt,
  setKind,
  simplify,
  toEditable,
  toggleNot,
  walkChecks,
  wordAt,
  wrapGroup,
} from './index.ts'

const a = { target: 'W:A', visible: true }
const b = { target: 'W:B', enabled: true }

test('条件：只有一条判断时编辑成组、存回去不包；稳住时间留在根上', () => {
  const ed = toEditable({ ...a, settleMs: 500 })
  assert.deepEqual(ed, { all: [a], settleMs: 500 })
  assert.deepEqual(simplify(ed), { ...a, settleMs: 500 })
  assert.deepEqual(toEditable(undefined), { all: [] })
  assert.deepEqual(simplify({ all: [{ not: a }] }), { not: a })
  assert.deepEqual(simplify({ all: [{ any: [a, b] }] }), { all: [{ any: [a, b] }] })
})

test('条件：加、删、取反、换全部 / 任一、包成子组、排序', () => {
  let c = addTo({ all: [] }, [], a)!
  c = addTo(c, [], b)!
  c = toggleNot(c, ['all', 1])
  assert.deepEqual(c, { all: [a, { not: b }] })
  c = toggleNot(c, ['all', 1])
  assert.deepEqual(c, { all: [a, b] })
  c = wrapGroup(c, ['all', 1])
  c = addTo(c, ['all', 1], { expr: '1 > 0' })!
  assert.deepEqual(c, { all: [a, { any: [b, { expr: '1 > 0' }] }] })
  c = setKind(c, [], 'any')
  assert.ok(Array.isArray(c.any))
  c = moveIn(c, [], 1, 0)
  assert.deepEqual((c.any as unknown[])[1], a)
  assert.equal(countChecks(c), 3)
  const neg: boolean[] = []
  walkChecks({ all: [a, { not: { any: [b] } }] }, (_, __, n) => neg.push(n))
  assert.deepEqual(neg, [false, true])
  assert.deepEqual(removeAt({ all: [a, { not: b }] }, ['all', 1, 'not']), { all: [a] })
})

test('表达式：优先级、成员、下标、调用、三元', () => {
  const r = parseExpr('@ps.Gold >= $gold0 + 500 and not visible("W:A") ? 1 : $list[-1].x')
  assert.ok('ast' in r)
  if (!('ast' in r)) return
  assert.equal(r.ast.k, 'cond')
  const refs = refsOf(r.ast)
  assert.deepEqual([...refs.vars], ['gold0', 'list'])
  assert.deepEqual([...refs.sources], ['ps'])
  assert.deepEqual(
    refs.calls.map((c) => c.name),
    ['visible'],
  )
})

test('表达式：接口调用、@来源上的只读函数、@actor 方括号、对象字面量', () => {
  const r = parseExpr(
    'Object.Count("BP_Monster_C") > 0 or @sub.UQuestSubsystem.IsDone(3) or dist(@actor[tag=Boss], vec(1, 2, 3)) < 100 or {"X": 1}.X == 1',
  )
  assert.ok('ast' in r)
  if (!('ast' in r)) return
  const refs = refsOf(r.ast)
  assert.deepEqual(
    refs.calls.map((c) => `${c.name}${c.onSource ? '*' : ''}`),
    ['Object.Count', 'IsDone*', 'dist', 'vec'],
  )
  assert.deepEqual([...refs.sources].sort(), ['actor', 'sub'])
})

test('表达式：写错的位置和错误码', () => {
  const at = (s: string) => {
    const r = parseExpr(s)
    return 'error' in r ? `${r.error.code}@${r.error.at}` : 'ok'
  }
  assert.equal(at(''), 'empty@0')
  assert.equal(at('1 +'), 'unexpected_end@3')
  assert.equal(at('(1 + 2'), 'unexpected_end@6')
  assert.equal(at('"abc'), 'unterminated_string@0')
  assert.equal(at('1 # 2'), 'bad_char@2')
  assert.equal(at('1 2'), 'unexpected@2')
  assert.equal(at('x'.repeat(1001)), 'too_long@1000')
  // 忘了写 $ 的变量：语法没错，引用里报成单独的名字
  const r = parseExpr('gold > 1')
  assert.ok('ast' in r && refsOf(r.ast).bareIds[0].name === 'gold')
})

test('补全：光标前正在写的词；在字符串里不补', () => {
  assert.deepEqual(wordAt('1 + $go', 7), { word: '$go', from: 4 })
  assert.deepEqual(wordAt('Object.Co', 9), { word: 'Object.Co', from: 0 })
  assert.equal(wordAt('text("W:A', 9), undefined)
})
