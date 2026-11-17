import { inflateSync } from 'node:zlib'

/**
 * 读 PNG 成 RGBA 像素（OCR 用）：UE 的录制截图是 8 位 RGB / RGBA、不隔行。
 * 不为这一件事拉一个图片库进插件包，也不依赖面板有没有 sharp 之类的原生模块；
 * 只认 8 位真彩色和灰度，别的格式报错说清楚。
 */
export interface RgbaImage {
  width: number
  height: number
  /** RGBA，每像素 4 字节 */
  data: Uint8Array
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function decodePng(buf: Buffer): RgbaImage {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是 PNG 文件')
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!width || !height || depth !== 8 || !channels || interlace !== 0)
    throw new Error(`只支持 8 位、不隔行的真彩色或灰度 PNG（这张是位深 ${depth}、颜色类型 ${colorType}）`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[x] = v & 0xff
    }
    prev = out
  }
  if (channels === 4) return { width, height, data: pixels }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const gray = channels <= 2
    data[i * 4] = pixels[j]
    data[i * 4 + 1] = gray ? pixels[j] : pixels[j + 1]
    data[i * 4 + 2] = gray ? pixels[j] : pixels[j + 2]
    data[i * 4 + 3] = channels === 2 ? pixels[j + 1] : 255
  }
  return { width, height, data }
}
