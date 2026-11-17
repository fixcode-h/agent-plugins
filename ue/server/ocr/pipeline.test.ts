// OCR 前后处理（pipeline.ts、png.ts）的纯计算部分：不用装 ONNX Runtime。用法：node --test ue/server/ocr/pipeline.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { decodePng } from './png.ts'
import { ctcDecode, detBoxes, detSize, recInput } from './pipeline.ts'

test('CTC 解码：去掉 blank 和连续重复，末尾下标是空格', () => {
  const dict = ['桌', '面', '2']
  const classes = dict.length + 2
  // 时间步：桌 桌 blank 面 2 空格 2
  const seq = [1, 1, 0, 2, 3, 4, 3]
  const data = new Float32Array(seq.length * classes)
  seq.forEach((k, i) => (data[i * classes + k] = 0.9))
  const r = ctcDecode({ data, dims: [1, seq.length, classes] }, dict)
  assert.equal(r.text, '桌面2 2')
  assert.ok(Math.abs(r.score - 0.9) < 1e-6)
})

test('检测：概率图里的一块连通域变成一个外扩过的框，低分的丢掉', () => {
  const w = 40
  const h = 20
  const prob = new Float32Array(w * h)
  for (let y = 5; y < 10; y++) for (let x = 10; x < 30; x++) prob[y * w + x] = 0.9
  // 一块分数低的噪点
  for (let y = 14; y < 18; y++) for (let x = 2; x < 6; x++) prob[y * w + x] = 0.4
  const boxes = detBoxes(prob, w, h)
  assert.equal(boxes.length, 1)
  const [x, y, bw, bh] = boxes[0]
  assert.ok(x < 10 && y < 5 && x + bw > 30 && y + bh > 10)
})

test('检测尺寸：小图放大、取 32 的倍数，长边不超过上限', () => {
  const [w, h] = detSize(260, 120)
  assert.equal(w % 32, 0)
  assert.equal(h % 32, 0)
  assert.ok(h >= 600 && w <= 1600)
  assert.ok(detSize(3000, 100)[0] <= 1600)
})

test('识别输入：高 48，宽至少 320，右边补 0', () => {
  const img = { width: 10, height: 10, data: new Uint8Array(400).fill(255) }
  const t = recInput(img, [0, 0, 10, 10])
  assert.deepEqual(t.dims, [1, 3, 48, 320])
  assert.equal(t.data[0], 1)
  assert.equal(t.data[319], 0)
})

test('PNG：8 位 RGB，各种行过滤', () => {
  const w = 3
  const h = 3
  const rows: number[] = []
  const px = (x: number, y: number) => [x * 10, y * 20, 7]
  for (let y = 0; y < h; y++) {
    rows.push(y) // 过滤类型 0、1、2
    for (let x = 0; x < w; x++) {
      const cur = px(x, y)
      const left = x ? px(x - 1, y) : [0, 0, 0]
      const up = y ? px(x, y - 1) : [0, 0, 0]
      rows.push(...cur.map((v, i) => (y === 0 ? v : y === 1 ? v - left[i] : v - up[i]) & 0xff))
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    return Buffer.concat([len, Buffer.from(type, 'latin1'), body, Buffer.alloc(4)])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const img = decodePng(png)
  assert.equal(img.width, 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      assert.deepEqual([...img.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)], [...px(x, y), 255])
})
