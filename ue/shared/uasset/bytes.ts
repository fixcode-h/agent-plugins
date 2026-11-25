/**
 * 按小端序读 .uasset 字节的游标（UE 的 FArchive 读法）。只用 Uint8Array / DataView，不碰 Node 的 Buffer，
 * 所以服务端和演示版能用同一份。越界一律抛 UassetError，调用方按「这一段读不了」降级，不让整个快照失败。
 */
import { UassetError } from './errors.ts'
import { t } from './i18n.ts'

const utf16 = new TextDecoder('utf-16le')
const latin1 = new TextDecoder('latin1')
const utf8 = new TextDecoder('utf-8')

export class Bytes {
  readonly view: DataView
  pos = 0
  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  get size() {
    return this.buf.byteLength
  }
  need(n: number) {
    if (n < 0 || this.pos + n > this.buf.byteLength)
      throw new UassetError(
        'corrupt',
        t('读到第 {pos} 字节时要再读 {n} 字节，超出了文件（{size} 字节）', {
          pos: this.pos,
          n,
          size: this.buf.byteLength,
        }),
      )
  }
  seek(p: number) {
    if (p < 0 || p > this.buf.byteLength) throw new UassetError('corrupt', t('跳到第 {pos} 字节超出了文件', { pos: p }))
    this.pos = p
  }
  skip(n: number) {
    this.need(n)
    this.pos += n
  }
  u8() {
    this.need(1)
    return this.buf[this.pos++]
  }
  i8() {
    this.need(1)
    return this.view.getInt8(this.pos++)
  }
  i16() {
    this.need(2)
    const v = this.view.getInt16(this.pos, true)
    this.pos += 2
    return v
  }
  u16() {
    this.need(2)
    const v = this.view.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  i32() {
    this.need(4)
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  u32() {
    this.need(4)
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  /** 64 位整数：超过 2^53 的按字符串给，免得 JSON 里悄悄丢精度 */
  i64(): number {
    this.need(8)
    const v = this.view.getBigInt64(this.pos, true)
    this.pos += 8
    return Number(v)
  }
  i64Value(): number | string {
    this.need(8)
    const v = this.view.getBigInt64(this.pos, true)
    this.pos += 8
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString()
  }
  u64Value(): number | string {
    this.need(8)
    const v = this.view.getBigUint64(this.pos, true)
    this.pos += 8
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
  }
  f32() {
    this.need(4)
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }
  f64() {
    this.need(8)
    const v = this.view.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }
  /** UE 的布尔是 4 字节 */
  bool32() {
    return this.i32() !== 0
  }
  /** FString：长度为负是 UTF-16，长度含结尾的 0 */
  fstring(): string {
    const n = this.i32()
    if (n === 0) return ''
    if (n < 0) {
      const bytes = -n * 2
      this.need(bytes)
      const s = utf16.decode(this.buf.subarray(this.pos, this.pos + bytes - 2))
      this.pos += bytes
      return s
    }
    this.need(n)
    const s = latin1.decode(this.buf.subarray(this.pos, this.pos + n - 1))
    this.pos += n
    return s
  }
  /** FUtf8String：长度是字节数、不含结尾的 0；有的版本会多存几个 0，去掉 */
  utf8string(): string {
    const n = this.i32()
    if (n <= 0) return ''
    this.need(n)
    const s = utf8.decode(this.buf.subarray(this.pos, this.pos + n))
    this.pos += n
    return s.replace(/\0+$/, '')
  }
  /** FGuid：4 个 uint32，按 UE 的 Digits 格式（32 位十六进制，小写）给 */
  guid(): string {
    let s = ''
    for (let i = 0; i < 4; i++) s += this.u32().toString(16).padStart(8, '0')
    return s
  }
  bytes(n: number) {
    this.need(n)
    const b = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }
}
