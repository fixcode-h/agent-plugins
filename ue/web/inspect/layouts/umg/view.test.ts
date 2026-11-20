// 设计器画布缩放、平移的纯逻辑单测：node --test ue/web/inspect/layouts/umg/view.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actualSize,
  clampPan,
  fitView,
  gridSpec,
  stepZoom,
  toDesign,
  toScreen,
  wheelSteps,
  zoomAt,
  zoomLabel,
  ZOOM_MAX,
  ZOOM_MIN,
} from './view.ts'

test('缩放档位：上下一档、两档之间先吸到相邻档、到头不再变', () => {
  assert.equal(stepZoom(1, 1), 1.25)
  assert.equal(stepZoom(1, -1), 0.875)
  assert.equal(stepZoom(0.42, 1), 0.5)
  assert.equal(stepZoom(0.42, -1), 0.375)
  assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX)
  assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN)
})

test('缩放文字：档位用 UE 的比例写法，其他写百分比', () => {
  assert.equal(zoomLabel(1), '1:1')
  assert.equal(zoomLabel(0.125), '1:8')
  assert.equal(zoomLabel(10), '10:1')
  assert.equal(zoomLabel(0.4321), '43%')
})

test('屏幕坐标和设计坐标互相换算', () => {
  const v = { k: 0.5, x: 100, y: 40 }
  assert.deepEqual(toDesign(v, 200, 90), { x: 200, y: 100 })
  assert.deepEqual(toScreen(v, 200, 100), { x: 200, y: 90 })
})

test('以光标为中心缩放：光标下的设计点不动，且受上下限约束', () => {
  const v = { k: 0.5, x: 100, y: 40 }
  const before = toDesign(v, 333, 222)
  const z = zoomAt(v, 2, 333, 222)
  assert.equal(z.k, 2)
  const after = toDesign(z, 333, 222)
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9)
  assert.equal(zoomAt(v, 100, 0, 0).k, ZOOM_MAX)
  assert.equal(zoomAt(v, 0.001, 0, 0).k, ZOOM_MIN)
})

test('缩放到适合：整张放进去并居中；1:1 以画布中心为中心', () => {
  const room = { w: 1000, h: 600 }
  const f = fitView(room, { w: 1920, h: 1080 }, 20)
  assert.ok(Math.abs(f.k - 0.5) < 1e-9)
  assert.equal(f.x, (1000 - 960) / 2)
  assert.equal(f.y, 30)
  const one = actualSize(f, room)
  assert.equal(one.k, 1)
  const c0 = toDesign(f, 500, 300)
  const c1 = toDesign(one, 500, 300)
  assert.ok(Math.abs(c0.x - c1.x) < 1e-9 && Math.abs(c0.y - c1.y) < 1e-9)
})

test('平移边界：设计稿至少留一点在画布里', () => {
  const room = { w: 800, h: 600 }
  const size = { w: 1920, h: 1080 }
  const far = clampPan({ k: 1, x: 5000, y: -5000 }, room, size, 48)
  assert.equal(far.x, 800 - 48)
  assert.equal(far.y, 48 - 1080)
  const ok = clampPan({ k: 1, x: -100, y: -100 }, room, size, 48)
  assert.deepEqual(ok, { k: 1, x: -100, y: -100 })
})

test('网格：细线 8 单位，缩小时成倍放宽不挤在一起', () => {
  assert.deepEqual(gridSpec(1), { minor: 8, major: 64 })
  const g = gridSpec(0.125)
  assert.ok(g.minor >= 6)
  assert.equal(g.major, g.minor * 8)
})

test('滚轮累计：鼠标一格一档，触控板小量攒够才换，向上滚放大', () => {
  assert.deepEqual(wheelSteps(0, -100), { steps: 1, acc: 0 })
  assert.deepEqual(wheelSteps(0, 120), { steps: -1, acc: 0 })
  let a = wheelSteps(0, -10)
  assert.equal(a.steps, 0)
  for (let i = 0; i < 4; i++) a = wheelSteps(a.acc, -10)
  assert.equal(a.steps, 1)
  assert.equal(wheelSteps(30, 10).acc, -10)
  assert.equal(wheelSteps(0, 3, 1).steps, -1)
})
