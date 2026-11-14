/** 枚举扫描的代码类写法：C++（UENUM、enum class、namespace 包 enum、表达式值）、Lua（表、总表、值是表）、两个正则 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScanFrom, diffScan } from './table-enum-scan.ts'
import { evalInt, maskComments, scanCode } from './table-enum-scan-code.ts'

const from = (x: Record<string, unknown>) => ScanFrom.parse({ files: 'x', ...x }) as Parameters<typeof scanCode>[1]

const CPP = `
#pragma once
// 不是枚举：enum 出现在注释里 enum EFake { A, B };
UENUM(BlueprintType)
enum class EItemQuality : uint8
{
\tWhite = 0 UMETA(DisplayName = "白色"),
\tBlue, // 蓝色
\tPurple = 1 << 3 UMETA(ToolTip = "紫色"),
\tSecret UMETA(Hidden),
\tMAX
};

namespace EColor { enum Type { Red, Green = 5, Blue }; }

enum EPlain { P_A = 0x10, P_B };
`

test('C++：UENUM、自增、表达式、UMETA 说明（没有时退到注释）、跳过 Hidden 和 MAX', () => {
  const r = scanCode(CPP, from({ kind: 'cpp' }), 'Types.h')
  assert.deepEqual(Object.keys(r.enums).sort(), ['EColor', 'EItemQuality', 'EPlain'])
  assert.deepEqual(r.enums.EItemQuality, [
    { name: 'White', value: '0', desc: '白色' },
    { name: 'Blue', value: '1', desc: '蓝色' },
    { name: 'Purple', value: '8', desc: '紫色' },
  ])
  assert.deepEqual(
    r.enums.EColor.map((m) => `${m.name}=${m.value}`),
    ['Red=0', 'Green=5', 'Blue=6'],
  )
  assert.deepEqual(
    r.enums.EPlain.map((m) => m.value),
    ['16', '17'],
  )
})

test('C++：只要 UENUM、说明取注释', () => {
  const r = scanCode(CPP, from({ kind: 'cpp', onlyUenum: true, desc: 'comment' }), 'Types.h')
  assert.deepEqual(Object.keys(r.enums), ['EItemQuality'])
  assert.equal(r.enums.EItemQuality[1].desc, '蓝色')
})

test('表达式求值和去注释', () => {
  assert.equal(evalInt('(1 << 4) | 2', new Map()), 18)
  assert.equal(evalInt('A + 1', new Map([['A', 4]])), 5)
  assert.equal(evalInt('Unknown + 1', new Map()), undefined)
  const m = maskComments('a /* x */ b // y\n"// 不是注释"', 'cpp')
  assert.equal(m.length, 'a /* x */ b // y\n"// 不是注释"'.length)
  assert.ok(m.includes('"// 不是注释"'))
  assert.ok(!m.includes('x'))
})

const LUA = `
local EQuality = {
  White = 0, -- 白
  Blue = 1,
}
M.ESlot = { Head = 1, Body = 2 }
Config = { a = "x", b = { 1 } } -- 值里有表，不算
Enums = {
  EJob = { Warrior = { id = 1, name = "战士" }, Mage = { id = 2, name = "法师" } },
}
`

test('Lua：键都是名字、值都是数字的表算枚举，行尾注释当说明', () => {
  const r = scanCode(LUA, from({ kind: 'lua' }), 'enums.lua')
  assert.deepEqual(r.enums.EQuality, [
    { name: 'White', value: '0', desc: '白' },
    { name: 'Blue', value: '1' },
  ])
  assert.deepEqual(
    r.enums.ESlot.map((m) => m.name),
    ['Head', 'Body'],
  )
  assert.equal(r.enums.Config, undefined)
})

test('Lua：总表下每个子表一个枚举，值是表时按字段取', () => {
  const r = scanCode(LUA, from({ kind: 'lua', container: 'Enums', valueField: 'id', descField: 'name' }), 'enums.lua')
  assert.deepEqual(Object.keys(r.enums), ['EJob'])
  assert.deepEqual(r.enums.EJob, [
    { name: 'Warrior', value: '1', desc: '战士' },
    { name: 'Mage', value: '2', desc: '法师' },
  ])
})

test('正则：一个找块，一个在块里找成员', () => {
  const text = 'enum Color {\n  Red = 1;\n  Blue = 2;\n}\nenum Size {\n  Big = 0;\n}\n'
  const r = scanCode(
    text,
    from({
      kind: 'regex',
      block: String.raw`enum\s+(?<name>\w+)\s*\{(?<body>[^}]*)\}`,
      member: String.raw`(?<name>\w+)\s*=\s*(?<value>\d+)`,
    }),
    'a.proto',
  )
  assert.deepEqual(Object.keys(r.enums), ['Color', 'Size'])
  assert.deepEqual(r.enums.Color[1], { name: 'Blue', value: '2' })
})

test('改名猜测：值一样换了名字的先配上', () => {
  const d = diffScan(
    {
      E: [
        { name: 'A', value: '1' },
        { name: 'Old', value: '2' },
      ],
    },
    {
      E: [
        { name: 'A', value: '1' },
        { name: 'New', value: '2' },
      ],
    },
  )
  assert.deepEqual(d.renames, [{ enum: 'E', from: 'Old', to: 'New' }])
})
