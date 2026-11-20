// 蓝图节点图 UE 外观的纯函数单测：node --test ue/web/inspect/layouts/blueprint/ue-style.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GNode, GPin } from './graph.ts'
import { defaultText, nodeSize, nodeStyle, pinColor, pinContainer, pinKind, pinLabel, wirePath } from './ue-style.ts'
import { UE_PIN } from './ue-theme.ts'

test('引脚类型 → UE 配色（TypeToText 的写法，含容器和复数）', () => {
  const cases: [string, keyof typeof UE_PIN][] = [
    ['exec', 'exec'],
    ['Boolean', 'bool'],
    ['Integer', 'int'],
    ['Integer64', 'int64'],
    ['Float', 'float'],
    ['Float (double-precision)', 'float'],
    ['String', 'string'],
    ['Name', 'name'],
    ['Text', 'text'],
    ['Byte', 'byte'],
    ['Net Role Enum', 'enum'],
    ['Vector Structure', 'vector'],
    ['Vector 2D Structure', 'struct'],
    ['Rotator Structure', 'rotator'],
    ['Transform Structure', 'transform'],
    ['Hit Result Structure', 'struct'],
    ['Actor Object Reference', 'object'],
    ['Actor Class Reference', 'class'],
    ['Static Mesh Soft Object Reference', 'softObject'],
    ['Actor Soft Class Reference', 'softClass'],
    ['Multicast Delegate', 'delegate'],
    ['Wildcard', 'wildcard'],
    ['Array of Integers', 'int'],
    ['Array of Actor Object References', 'object'],
    ['Set of Names', 'name'],
    ['Map of Strings to Integers', 'string'],
    ['Something Odd', 'default'],
  ]
  for (const [type, kind] of cases) assert.equal(pinKind(type), kind, type)
  assert.equal(pinColor('Boolean'), UE_PIN.bool)
  assert.equal(pinContainer('Array of Integers'), 'array')
  assert.equal(pinContainer('Map of Strings to Integers'), 'map')
  assert.equal(pinContainer('Integer'), undefined)
})

test('引脚显示名：bool 去 b、驼峰拆词、执行引脚不写名字、self 交给界面', () => {
  const pin = (name: string, type: string, dir = 'in'): GPin => ({ name, type, dir })
  assert.equal(pinLabel(pin('bSweep', 'Boolean')), 'Sweep')
  assert.equal(pinLabel(pin('bIsOpen', 'Boolean')), 'Is Open')
  assert.equal(pinLabel(pin('NewRotation', 'Rotator Structure')), 'New Rotation')
  assert.equal(pinLabel(pin('ReturnValue', 'Float', 'out')), 'Return Value')
  assert.equal(pinLabel(pin('bomb', 'Integer')), 'bomb')
  assert.equal(pinLabel(pin('execute', 'exec')), '')
  assert.equal(pinLabel(pin('then', 'exec', 'out')), '')
  assert.equal(pinLabel(pin('PlayFromStart', 'exec')), 'Play From Start')
  assert.equal(pinLabel(pin('self', 'Actor Object Reference')), null)
})

test('默认值：浮点写短、对象路径只留名字', () => {
  assert.equal(defaultText('0.000000'), '0.0')
  assert.equal(defaultText('110.500000'), '110.5')
  assert.equal(defaultText('1.0'), '1.0')
  assert.equal(defaultText('10.05'), '10.05')
  assert.equal(defaultText('0, 0, 0'), '0, 0, 0')
  assert.equal(defaultText('/Game/AgentTest/C_DoorEase.C_DoorEase'), 'C_DoorEase')
})

const x = (name: string, dir: string): GPin => ({ name, dir, type: 'exec' })
const d = (name: string, dir: string, type: string): GPin => ({ name, dir, type })
const node = (kind: string, title: string, pins: GPin[], member?: string): GNode => ({
  id: 'n',
  kind,
  title,
  pins,
  member,
})

test('节点外形和标题色：事件红、调用蓝、纯函数绿、流程控制灰、Cast 青、变量胶囊、转换小圆点', () => {
  assert.deepEqual(nodeStyle(node('event', 'Event BeginPlay', [x('then', 'out')])), {
    look: 'full',
    title: 'event',
    icon: 'event',
  })
  assert.deepEqual(nodeStyle(node('custom_event', 'Open', [x('then', 'out')])).subtitle, { kind: 'custom' })
  const call = nodeStyle(
    node('call', 'SetRelativeRotation', [x('execute', 'in'), d('self', 'in', 'Scene Component Object Reference')]),
  )
  assert.equal(call.title, 'call')
  assert.deepEqual(call.subtitle, { kind: 'target', name: 'Scene Component' })
  assert.equal(nodeStyle(node('call', 'Make Rotator', [d('ReturnValue', 'out', 'Rotator Structure')])).title, 'pure')
  assert.equal(
    nodeStyle(
      node('call', 'To String (Integer)', [d('InInt', 'in', 'Integer')], 'KismetStringLibrary.Conv_IntToString'),
    ).look,
    'dot',
  )
  assert.equal(nodeStyle(node('branch', 'Branch', [])).title, 'flow')
  assert.equal(nodeStyle(node('other', 'Sequence', [x('execute', 'in')])).title, 'flow')
  assert.equal(nodeStyle(node('macro', 'ForEachLoop', [])).title, 'macro')
  assert.equal(nodeStyle(node('cast', 'Cast To Character', [])).title, 'cast')
  assert.equal(nodeStyle(node('entry', 'ToggleDoor', [])).title, 'terminator')
  assert.equal(nodeStyle(node('get', 'Get bIsOpen', [])).look, 'var')
  assert.equal(nodeStyle(node('set', 'SET bIsOpen', [])).look, 'var')
  assert.equal(nodeStyle(node('other', 'Reroute Node', [])).look, 'knot')
})

test('节点尺寸：有副标题更高、长标题更宽、变量胶囊和转换点更小，宽度有上下限', () => {
  const rows = [{ in: x('execute', 'in'), out: x('then', 'out') }]
  const plain = nodeSize(node('event', 'Event BeginPlay', [x('then', 'out')]), rows)
  const custom = nodeSize(node('custom_event', 'Event BeginPlay', [x('then', 'out')]), rows)
  assert.ok(custom.h > plain.h)
  const long = nodeSize(node('event', 'On Component Begin Overlap (Trigger) With A Very Very Long Name', []), rows)
  assert.equal(long.w, 320)
  assert.ok(plain.w >= 112 && plain.w < long.w)
  const get = nodeSize(node('get', 'Get bIsOpen', [], 'bIsOpen'), [{ out: d('bIsOpen', 'out', 'Boolean') }])
  assert.ok(get.h < plain.h)
  assert.deepEqual(nodeSize(node('call', 'To String', [], 'Conv_IntToString'), [{ in: d('A', 'in', 'Integer') }]), {
    w: 44,
    h: 24,
  })
})

test('UE 的连线：往前连是水平出入的 S 形，往回连绕一个更大的弯', () => {
  const [fwd, mx, my] = wirePath(0, 0, 300, 100)
  // 切线 = 水平 300 + 垂直 100，控制点各偏 400/3
  assert.equal(fwd, 'M0,0 C133.3,0 166.7,100 300,100')
  assert.equal(mx, 150)
  assert.equal(my, 50)
  const [back] = wirePath(300, 0, 0, 100)
  // 往回：水平 min(300,200)*3 + 垂直 min(100,200)*1.5 = 750，控制点偏 250：先往右出、再从左边进
  assert.equal(back, 'M300,0 C550,0 -250,100 0,100')
})
