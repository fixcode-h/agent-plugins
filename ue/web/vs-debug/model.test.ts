import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VsDebugState } from '../../server/types.ts'
import { canDo, EMPTY_PARAMS, phaseOf, startArgs } from './model.ts'

const st = (s: Partial<NonNullable<VsDebugState['status']>>): VsDebugState => ({
  available: true,
  status: { mode: 'design', building: false, ...s },
})

test('编译、启动中优先于 mode：F5 之后 mode 还是 design，不能显示成「没在调试」', () => {
  assert.equal(phaseOf(undefined), 'off')
  assert.equal(phaseOf({ available: false, reason: 'no-vs' }), 'off')
  assert.equal(phaseOf(st({})), 'design')
  assert.equal(phaseOf(st({ building: true })), 'building')
  assert.equal(phaseOf(st({ launchPending: true })), 'launching')
  assert.equal(phaseOf(st({ mode: 'run' })), 'run')
  assert.equal(phaseOf(st({ mode: 'break' })), 'break')
})

test('按状态禁用：没在调试才能启动 / 附加，停下才能单步，编译中能取消', () => {
  assert.deepEqual(canDo('design'), {
    start: true,
    attach: true,
    stop: false,
    restart: false,
    pause: false,
    resume: false,
    step: false,
  })
  assert.equal(canDo('run').pause, true)
  assert.equal(canDo('run').step, false)
  assert.equal(canDo('break').step, true)
  assert.equal(canDo('break').resume, true)
  assert.equal(canDo('building').stop, true)
  assert.equal(canDo('building').start, false)
})

test('启动参数：空的不传，免得覆盖 VS 当前的配置和命令参数', () => {
  assert.deepEqual(startArgs(EMPTY_PARAMS, false), {})
  assert.deepEqual(
    startArgs({ map: ' /Game/Maps/Test ', game: true, args: '-log', configuration: 'DebugGame Editor' }, true),
    { noDebug: true, configuration: 'DebugGame Editor', map: '/Game/Maps/Test', game: true, args: '-log' },
  )
})
