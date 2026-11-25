/**
 * 单测用：按 UE 5.4（UE5 对象版本 1012）编辑器包的格式拼一个最小的 .uasset，不带第三方资源文件进仓库。
 * 只写读取器会读的字段（顺序照 package.ts），属性用带完整类型名的标签。
 */

/** 小端字节缓冲 */
class W {
  private parts: number[] = []
  get pos() {
    return this.parts.length
  }
  u8(v: number) {
    this.parts.push(v & 0xff)
    return this
  }
  i32(v: number) {
    for (let i = 0; i < 4; i++) this.parts.push((v >>> (i * 8)) & 0xff)
    return this
  }
  i64(v: number) {
    this.i32(v)
    return this.i32(v < 0 ? -1 : Math.floor(v / 2 ** 32))
  }
  f32(v: number) {
    const b = new Uint8Array(new Float32Array([v]).buffer)
    for (const x of b) this.parts.push(x)
    return this
  }
  fstring(s: string) {
    if (!s) return this.i32(0)
    this.i32(s.length + 1)
    for (const c of s) this.parts.push(c.charCodeAt(0) & 0xff)
    return this.u8(0)
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.parts.push(0)
    return this
  }
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i])
    return this
  }
  /** 回填一个 i32 / i64 */
  patch32(at: number, v: number) {
    for (let i = 0; i < 4; i++) this.parts[at + i] = (v >>> (i * 8)) & 0xff
  }
  patch64(at: number, v: number) {
    this.patch32(at, v)
    this.patch32(at + 4, 0)
  }
  done() {
    return new Uint8Array(this.parts)
  }
}

/** 属性的类型树：['IntProperty'] 或 ['ArrayProperty', [['IntProperty']]] 或 ['StructProperty', [['Vector'], ['/Script/CoreUObject']]] */
export type TypeSpec = [string, TypeSpec[]?]

export interface PropSpec {
  name: string
  type: TypeSpec
  /** 值的字节（由 v.* 帮手生成）；BoolProperty 用 bool */
  value?: (w: W, n: Names) => void
  bool?: boolean
  /** 结构体按二进制存（标签标志 0x08） */
  binary?: boolean
}

export interface ExportSpec {
  name: string
  /** 类：负数是导入下标（-1 起），正数是导出 */
  classIndex: number
  outer?: number
  cdo?: boolean
  props: PropSpec[]
  /** 属性区之后类自己追加的数据（数据表的行） */
  tail?: (w: W, n: Names) => void
}

export interface ImportSpec {
  classPackage: string
  className: string
  outer: number
  name: string
}

export interface PackSpec {
  packageName: string
  ue5?: number
  flags?: number
  imports: ImportSpec[]
  exports: ExportSpec[]
  registry?: { objectPath: string; className: string; tags: Record<string, string> }[]
}

/** 名字表：用到的名字先收集，写 FName 时按下标 */
export class Names {
  list: string[] = ['None']
  idx(s: string) {
    let i = this.list.indexOf(s)
    if (i < 0) i = this.list.push(s) - 1
    return i
  }
  write(w: W, s: string) {
    w.i32(this.idx(s)).i32(0)
  }
}

function writeType(w: W, n: Names, t: TypeSpec) {
  n.write(w, t[0])
  const ps = t[1] ?? []
  w.i32(ps.length)
  for (const p of ps) writeType(w, n, p)
}

function collectType(n: Names, t: TypeSpec) {
  n.idx(t[0])
  for (const p of t[1] ?? []) collectType(n, p)
}

export function writeTagged(w: W, n: Names, props: PropSpec[]) {
  for (const p of props) {
    n.write(w, p.name)
    writeType(w, n, p.type)
    const sizeAt = w.pos
    w.i32(0)
    w.u8((p.bool ? 0x10 : 0) | (p.binary ? 0x08 : 0))
    const start = w.pos
    p.value?.(w, n)
    w.patch32(sizeAt, w.pos - start)
  }
  n.write(w, 'None')
}

/** 值的帮手 */
export const v = {
  int: (x: number) => (w: W) => void w.i32(x),
  float: (x: number) => (w: W) => void w.f32(x),
  str: (s: string) => (w: W) => void w.fstring(s),
  name: (s: string) => (w: W, n: Names) => n.write(w, s),
  /** FPackageIndex */
  ref: (i: number) => (w: W) => void w.i32(i),
  ints: (xs: number[]) => (w: W) => {
    w.i32(xs.length)
    for (const x of xs) w.i32(x)
  },
  /** 带标签的结构体（不标二进制） */
  struct: (props: PropSpec[]) => (w: W, n: Names) => writeTagged(w, n, props),
}

function collect(n: Names, spec: PackSpec) {
  const walk = (ps: PropSpec[]) => {
    for (const p of ps) {
      n.idx(p.name)
      collectType(n, p.type)
    }
  }
  for (const im of spec.imports) [im.classPackage, im.className, im.name].forEach((s) => n.idx(s))
  for (const e of spec.exports) {
    n.idx(e.name)
    walk(e.props)
  }
}

export function buildPackage(spec: PackSpec): Uint8Array {
  const n = new Names()
  collect(n, spec)
  // 先把每个导出对象的数据写好（名字可能在写值时才加进名字表，所以要在写名字表之前）
  const datas = spec.exports.map((e) => {
    const w = new W()
    w.u8(0) // 可覆盖序列化的控制字节
    writeTagged(w, n, e.props)
    const scriptEnd = w.pos
    if (!e.cdo) w.i32(0) // 没有对象 GUID
    e.tail?.(w, n)
    return { bytes: w.done(), scriptEnd }
  })
  const ue5 = spec.ue5 ?? 1012
  const w = new W()
  w.i32(0x9e2a83c1).i32(-8).i32(864).i32(522).i32(ue5).i32(0)
  w.i32(0) // 自定义版本个数
  const headerSizeAt = w.pos
  w.i32(0)
  w.fstring(spec.packageName)
  w.i32(spec.flags ?? 0)
  const nameAt = w.pos
  w.i32(0).i32(0) // 名字个数、位置
  w.i32(0).i32(0) // 软路径表
  w.fstring('') // LocalizationId
  w.zeros(8)
  const exportAt = w.pos
  w.i32(0).i32(0)
  const importAt = w.pos
  w.i32(0).i32(0)
  w.i32(0) // DependsOffset
  const softPkgAt = w.pos
  w.i32(0).i32(0)
  w.i32(0).i32(0) // 可搜索名字、缩略图
  w.zeros(16).zeros(16) // 包 GUID、PersistentGuid
  w.i32(0) // generations
  for (let i = 0; i < 2; i++) w.zeros(10).fstring('')
  w.i32(0).i32(0).i32(0).i32(0) // 压缩标志、压缩块、PackageSource、烹饪信息
  const registryAt = w.pos
  w.i32(0)

  w.patch32(nameAt, n.list.length)
  w.patch32(nameAt + 4, w.pos)
  for (const s of n.list) w.fstring(s).i32(0)

  w.patch32(importAt, spec.imports.length)
  w.patch32(importAt + 4, w.pos)
  for (const im of spec.imports) {
    n.write(w, im.classPackage)
    n.write(w, im.className)
    w.i32(im.outer)
    n.write(w, im.name)
    n.write(w, 'None')
    w.i32(0)
  }

  w.patch32(exportAt, spec.exports.length)
  w.patch32(exportAt + 4, w.pos)
  const fix: { size: number; offset: number; start: number; end: number }[] = []
  for (const e of spec.exports) {
    w.i32(e.classIndex)
      .i32(0)
      .i32(0)
      .i32(e.outer ?? 0)
    n.write(w, e.name)
    w.i32(e.cdo ? 0x10 : 0)
    const size = w.pos
    w.i64(0)
    const offset = w.pos
    w.i64(0)
    w.zeros(12).zeros(4).zeros(4).zeros(8).zeros(4).zeros(20)
    const start = w.pos
    w.i64(0)
    const end = w.pos
    w.i64(0)
    fix.push({ size, offset, start, end })
  }
  w.patch32(softPkgAt + 4, w.pos) // 软引用包：0 个
  if (spec.registry) {
    w.patch32(registryAt, w.pos)
    w.i64(0).i32(spec.registry.length)
    for (const r of spec.registry) {
      w.fstring(r.objectPath).fstring(r.className)
      const tags = Object.entries(r.tags)
      w.i32(tags.length)
      for (const [k, x] of tags) w.fstring(k).fstring(x)
    }
  }
  w.patch32(headerSizeAt, w.pos)
  datas.forEach((d, i) => {
    w.patch64(fix[i].size, d.bytes.length)
    w.patch64(fix[i].offset, w.pos)
    w.patch64(fix[i].start, 0)
    w.patch64(fix[i].end, d.scriptEnd)
    w.bytes(d.bytes)
  })
  return w.done()
}
