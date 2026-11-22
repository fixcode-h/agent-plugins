import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box } from 'lucide-react'
import { fromComps, mergeComps } from './actor-comps.ts'

const self = { key: '@', part: '', depth: 0, name: 'BP_Hero_C', class: 'BP_Hero_C', icon: Box, kids: false }

test('组件按挂接关系嵌套，gt.props 里多出来的补上', () => {
  const comps = mergeComps(
    [
      { path: 'a', name: 'Capsule', class: 'CapsuleComponent', parent: '', root: true, scene: true },
      { path: 'b', name: 'SpringArm', class: 'SpringArmComponent', parent: 'a', root: false, scene: true },
      { path: 'c', name: 'Camera', class: 'CameraComponent', parent: 'b', root: false, scene: true },
    ],
    [
      { id: 'self', title: '自己', items: [] },
      { id: 'p1', title: 'Camera', part: 'Camera', class: 'CameraComponent', items: [] },
      { id: 'p2', title: 'Move', part: 'CharMoveComp', class: 'CharacterMovementComponent', items: [] },
    ],
  )!
  assert.equal(comps.length, 4)
  assert.equal(comps[3].scene, false)
  const nodes = fromComps(comps, self)
  assert.deepEqual(
    nodes.map((n) => [n.part, n.depth]),
    [
      ['', 0],
      ['Capsule', 1],
      ['SpringArm', 2],
      ['Camera', 3],
      ['CharMoveComp', 1],
    ],
  )
})

test('读不到组件树时按部件组平铺；都没有时 undefined', () => {
  assert.equal(mergeComps(null, [{ id: 'self', title: '自己', items: [] }]), undefined)
  const flat = mergeComps(null, [{ id: 'p', title: 'Arrow', part: 'Arrow', class: 'ArrowComponent', items: [] }])!
  assert.deepEqual(
    flat.map((c) => [c.name, c.scene]),
    [['Arrow', true]],
  )
})
