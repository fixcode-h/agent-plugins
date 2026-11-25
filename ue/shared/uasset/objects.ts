/**
 * 读出包里每个导出对象：带标签的属性 + 类自己追加的数据（目前只有图表节点的引脚，注册表 tails）。
 * 一个对象读不通只影响它自己（记进 error），别的对象照读。
 */
import { Bytes } from './bytes.ts'
import { UassetError } from './errors.ts'
import { t } from './i18n.ts'
import { exportClass, indexPath, RF_CLASS_DEFAULT_OBJECT, UE5, type ExportEntry, type Package } from './package.ts'
import { hasPins, readPins, type RawPin } from './pins.ts'
import { readTagged, type RawProp } from './props.ts'

export interface UObj {
  /** FPackageIndex（导出表下标 + 1） */
  ref: number
  name: string
  class: string
  /** 外层对象的 FPackageIndex；0 是包本身 */
  outer: number
  path: string
  isCdo: boolean
  props: RawProp[]
  pins?: RawPin[]
  /** 读不通的原因（只影响这个对象） */
  error?: string
}

/** 类自己在属性之后追加的数据：按类名认，读到的东西挂在对象上 */
type Tail = (r: Bytes, pkg: Package, obj: UObj, end: number) => void
const tails: { match: (cls: string, outerCls: string) => boolean; read: Tail }[] = []

export function registerTail(match: (cls: string, outerCls: string) => boolean, read: Tail) {
  tails.push({ match, read })
}

// 图表节点：外层是图（EdGraph、AnimationGraph、MaterialGraph……），自己不是图
registerTail(
  (cls, outerCls) => /Graph$/.test(outerCls) && !/Graph$/.test(cls),
  (r, pkg, obj) => {
    if (hasPins(pkg)) obj.pins = readPins(r, pkg)
  },
)

export function readObjects(pkg: Package): UObj[] {
  const out: UObj[] = []
  for (const e of pkg.exports) out.push(readObject(pkg, e))
  return out
}

function readObject(pkg: Package, e: ExportEntry): UObj {
  const cls = exportClass(pkg, e)
  const obj: UObj = {
    ref: e.index + 1,
    name: e.name,
    class: cls,
    outer: e.outer,
    path: indexPath(pkg, e.index + 1),
    isCdo: !!(e.flags & RF_CLASS_DEFAULT_OBJECT),
    props: [],
  }
  const r = new Bytes(pkg.bytes.buf.subarray(e.serialOffset, e.serialOffset + e.serialSize))
  // 5.4 的包里非 CDO 对象的属性区前面可能多 4 个 0 字节（UAssetAPI 也这么认，原因不明）：两种都试，取结尾对得上的那种
  const lead =
    pkg.ue5 > UE5.DATA_RESOURCES && pkg.ue5 < UE5.ASSETREGISTRY_PACKAGEBUILDDEPENDENCIES && !obj.isCdo ? [4, 0] : [0]
  let why = ''
  for (const skip of lead) {
    try {
      r.seek(e.scriptStart)
      if (skip && r.i32() !== 0) continue
      obj.props = scriptProps(r, pkg, e)
      why = ''
      break
    } catch (err) {
      why = (err as Error).message
    }
  }
  if (why) {
    obj.error = why
    return obj
  }
  const outerCls = e.outer > 0 ? exportClass(pkg, pkg.exports[e.outer - 1]) : ''
  const tail = tails.find((x) => x.match(cls, outerCls))
  if (tail) {
    try {
      r.seek(e.scriptEnd)
      if (!obj.isCdo && r.bool32()) r.skip(16) // 对象 GUID
      tail.read(r, pkg, obj, e.serialSize)
    } catch (err) {
      obj.error = t('{cls} 自己存的数据没读通：{why}', { cls, why: (err as Error).message })
    }
  }
  return obj
}

function scriptProps(r: Bytes, pkg: Package, e: ExportEntry): RawProp[] {
  if (pkg.ue5 >= UE5.PROPERTY_TAG_EXTENSION && r.u8() & 0x02) r.u8() // 可覆盖序列化的控制字节
  const props = readTagged(r, pkg, e.scriptEnd)
  if (r.pos !== e.scriptEnd) throw new UassetError('corrupt', t('属性区的结尾和导出表记的对不上'))
  return props
}

/** 按名字取一条属性的值 */
export const prop = (o: UObj | undefined, name: string): unknown => o?.props.find((p) => p.name === name)?.value
