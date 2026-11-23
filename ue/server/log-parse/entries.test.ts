// 日志按条解析（entries.ts）：多行消息的续行并进第一行，时间、分类、级别只看第一行。
// 用法（在 ue/ 下，不依赖面板模块）：node --test server/log-parse/entries.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entryReader, type LogLine } from './entries.ts'

function read(text: string) {
  const r = entryReader((n) => `+${n}`)
  const out: LogLine[] = []
  text.split('\n').forEach((raw, i) => {
    const l = raw && r.push(raw, i + 1)
    if (l) out.push(l)
  })
  const last = r.end()
  if (last) out.push(last)
  return out
}

test('崩溃 JSON 的续行并成一条，时间和级别沿用第一行', () => {
  const out = read(
    [
      '[2026.11.23-11.49.52:001][  0]LogTemp: Display: before',
      '[2026.11.23-11.49.53:123][  0]LogD3D12RHI: Error: GPU crash dump:',
      '{',
      '"Device info": {',
      '"Device state": "Hung",',
      '}',
      '}',
      '[2026.11.23-11.49.54:000][  1]LogTemp: after',
    ].join('\n'),
  )
  assert.equal(out.length, 3)
  assert.deepEqual(out[1], {
    seq: 2,
    time: '2026.11.23-11.49.53:123',
    category: 'LogD3D12RHI',
    verbosity: 'Error',
    text: 'GPU crash dump:\n{\n"Device info": {\n"Device state": "Hung",\n}\n}',
  })
  assert.equal(out[2].text, 'after')
})

test('续行看起来像「分类: 」也不拆开（文件在用时间前缀时只认前缀）', () => {
  const out = read('[2026.11.23-11.49.53:123][  0]LogScript: Error: stack\nLogFoo: not a new entry')
  assert.equal(out.length, 1)
  assert.equal(out[0].text, 'stack\nLogFoo: not a new entry')
})

test('没开时间前缀的日志按「分类: 」分条，认不出的并进上一条', () => {
  const out = read('Log file open\nLogInit: Display: hello\n  at foo()\nLogInit: bye')
  assert.deepEqual(
    out.map((l) => [l.category, l.text]),
    [
      ['', 'Log file open'],
      ['LogInit', 'hello\n  at foo()'],
      ['LogInit', 'bye'],
    ],
  )
})

test('-LogTimes=SinceStart 的秒数前缀也认', () => {
  const out = read('[   12.34][  0]LogTemp: Warning: a\nb')
  assert.equal(out.length, 1)
  assert.equal(out[0].time, '12.34')
  assert.equal(out[0].verbosity, 'Warning')
  assert.equal(out[0].text, 'a\nb')
})

test('超长的多行消息只并前 400 行，多的记个数', () => {
  const lines = [
    '[2026.11.23-11.49.53:123][  0]LogTemp: Error: dump',
    ...Array.from({ length: 500 }, (_, i) => `x${i}`),
  ]
  const [l] = read(lines.join('\n'))
  const parts = l.text.split('\n')
  assert.equal(parts.length, 401)
  assert.equal(parts.at(-1), '+101')
})
