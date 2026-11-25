/**
 * .uasset 的容器层：文件头、名字表、导入表、导出表、软引用表、资产注册表标签（设计文档 ue/docs/uasset-offline-reader.md 第 4.1 节）。
 * 只读 UE 5.4（UE5 对象版本 1012）起编辑器保存的包：5.4 起属性标签换成了带完整类型名的新格式，5.4 和 5.8 用同一种；
 * 烹饪包（去掉了编辑器数据、属性未版本化）和 5.4 以前的旧格式直接报原因，不硬读。
 * 字段顺序照文件格式写（参考 UAssetAPI 的读法核对过），不抄引擎源码。
 */
import { Bytes } from './bytes.ts'
import { UassetError } from './errors.ts'
import { t } from './i18n.ts'
import { readSubPath } from './refs.ts'

/** UE5 对象版本里会影响读法的几条（EUnrealEngineObjectUE5Version） */
export const UE5 = {
  OPTIONAL_RESOURCES: 1003,
  REMOVE_OBJECT_EXPORT_PACKAGE_GUID: 1005,
  TRACK_OBJECT_EXPORT_IS_INHERITED: 1006,
  ADD_SOFTOBJECTPATH_LIST: 1008,
  DATA_RESOURCES: 1009,
  SCRIPT_SERIALIZATION_OFFSET: 1010,
  PROPERTY_TAG_EXTENSION: 1011,
  /** 5.4：属性标签带完整类型名 */
  PROPERTY_TAG_COMPLETE_TYPE_NAME: 1012,
  ASSETREGISTRY_PACKAGEBUILDDEPENDENCIES: 1013,
  METADATA_SERIALIZATION_OFFSET: 1014,
  VERSE_CELLS: 1015,
  PACKAGE_SAVED_HASH: 1016,
  OS_SUB_OBJECT_SHADOW_SERIALIZATION: 1017,
  IMPORT_TYPE_HIERARCHIES: 1018,
} as const
/** 认得的最新版本（5.8）。更新的版本可能改了格式，先报出来回退编辑器，不硬读（设计文档第 9 节） */
export const MAX_KNOWN_UE5 = UE5.IMPORT_TYPE_HIERARCHIES

const PACKAGE_TAG = 0x9e2a83c1
const PKG_UNVERSIONED_PROPERTIES = 0x2000
const PKG_FILTER_EDITOR_ONLY = 0x80000000
export const RF_CLASS_DEFAULT_OBJECT = 0x10

export interface ImportEntry {
  classPackage: string
  className: string
  outer: number
  name: string
}

export interface ExportEntry {
  /** 导出表里的下标（从 0 起）；FPackageIndex 里是 index + 1 */
  index: number
  classIndex: number
  superIndex: number
  templateIndex: number
  outer: number
  name: string
  flags: number
  serialSize: number
  serialOffset: number
  /** 属性区在导出数据里的起止（相对 serialOffset） */
  scriptStart: number
  scriptEnd: number
}

export interface AssetRegistryEntry {
  objectPath: string
  className: string
  tags: Record<string, string>
}

export interface Package {
  bytes: Bytes
  ue5: number
  licensee: number
  /** 自定义版本：GUID（32 位十六进制，小写）→ 版本号 */
  custom: Map<string, number>
  flags: number
  packageName: string
  names: string[]
  imports: ImportEntry[]
  exports: ExportEntry[]
  softPaths: string[]
  softPackages: string[]
  registry: AssetRegistryEntry[]
}

/** 一个 FName：名字表下标 + 编号（Foo_3 存成 Foo + 4） */
export function readName(r: Bytes, names: string[]): string {
  const i = r.i32()
  const n = r.i32()
  const base = names[i]
  if (base === undefined) throw new UassetError('corrupt', t('名字表里没有第 {i} 个名字', { i }))
  return n ? `${base}_${n - 1}` : base
}

function header(r: Bytes) {
  if (r.size < 32 || r.u32() !== PACKAGE_TAG)
    throw new UassetError('not-package', t('不是 UE 资源文件（文件头对不上）'))
  const legacy = r.i32()
  if (legacy !== -4) r.i32() // UE3 兼容版本号
  const ue4 = r.i32()
  const ue5 = legacy <= -8 ? r.i32() : 0
  const licensee = r.i32()
  if (ue4 <= 0)
    throw new UassetError(
      'cooked',
      t('这是烹饪后的游戏包（属性没有写名字和类型），只能读项目 Content 里编辑器保存的资源'),
    )
  if (ue5 < UE5.PROPERTY_TAG_COMPLETE_TYPE_NAME)
    throw new UassetError(
      'old',
      t('这个资源是 UE 5.4 以前的格式（UE5 对象版本 {v}），离线读取只支持 5.4 起保存的资源：开着编辑器再看', {
        v: ue5,
      }),
    )
  if (ue5 > MAX_KNOWN_UE5)
    throw new UassetError(
      'newer',
      t('这个资源用了更新的引擎格式（UE5 对象版本 {v}，认得的最高是 {max}）：开着编辑器再看', {
        v: ue5,
        max: MAX_KNOWN_UE5,
      }),
    )
  return { ue5, licensee }
}

function customVersions(r: Bytes) {
  const out = new Map<string, number>()
  const n = r.i32()
  for (let i = 0; i < n; i++) {
    const g = r.guid()
    out.set(g, r.i32())
  }
  return out
}

/** 读整个容器层（不读导出对象的内容） */
export function readPackage(buf: Uint8Array): Package {
  const r = new Bytes(buf)
  const { ue5, licensee } = header(r)
  if (ue5 >= UE5.PACKAGE_SAVED_HASH) r.skip(20 + 4) // 保存哈希 + 文件头总长
  const custom = customVersions(r)
  if (ue5 < UE5.PACKAGE_SAVED_HASH) r.i32() // 文件头总长
  const packageName = r.fstring()
  const flags = r.u32()
  if (flags & PKG_FILTER_EDITOR_ONLY)
    throw new UassetError('cooked', t('这是烹饪后的游戏包（去掉了编辑器数据），只能读项目 Content 里编辑器保存的资源'))
  if (flags & PKG_UNVERSIONED_PROPERTIES)
    throw new UassetError(
      'cooked',
      t('这是烹饪后的游戏包（属性没有写名字和类型），只能读项目 Content 里编辑器保存的资源'),
    )
  const nameCount = r.i32()
  const nameOffset = r.i32()
  let softCount = 0
  let softOffset = 0
  if (ue5 >= UE5.ADD_SOFTOBJECTPATH_LIST) {
    softCount = r.i32()
    softOffset = r.i32()
  }
  r.fstring() // LocalizationId（编辑器包才有）
  r.skip(8) // 可收集文本：个数 + 位置
  const exportCount = r.i32()
  const exportOffset = r.i32()
  const importCount = r.i32()
  const importOffset = r.i32()
  if (ue5 >= UE5.VERSE_CELLS) r.skip(16)
  if (ue5 >= UE5.METADATA_SERIALIZATION_OFFSET) r.i32()
  r.i32() // DependsOffset
  const softPkgCount = r.i32()
  const softPkgOffset = r.i32()
  r.i32() // SearchableNamesOffset
  r.i32() // ThumbnailTableOffset
  if (ue5 >= UE5.IMPORT_TYPE_HIERARCHIES) r.skip(8)
  if (ue5 < UE5.PACKAGE_SAVED_HASH) r.skip(16) // 包 GUID
  r.skip(16) // PersistentGuid（编辑器包才有）
  const generations = r.i32()
  r.skip(generations * 8)
  skipEngineVersion(r)
  skipEngineVersion(r)
  r.u32() // 压缩标志
  if (r.i32() > 0) throw new UassetError('unsupported', t('包整体压缩过（很旧的格式），读不了'))
  r.u32() // PackageSource
  const cook = r.i32()
  for (let i = 0; i < cook; i++) r.fstring()
  const registryOffset = r.i32()

  r.seek(nameOffset)
  const names: string[] = []
  for (let i = 0; i < nameCount; i++) {
    const s = r.fstring()
    names.push(s)
    r.u32() // 名字哈希
  }
  const pkg: Package = {
    bytes: r,
    ue5,
    licensee,
    custom,
    flags,
    packageName,
    names,
    imports: [],
    exports: [],
    softPaths: [],
    softPackages: [],
    registry: [],
  }
  readSoftPaths(pkg, softOffset, softCount)
  readImports(pkg, importOffset, importCount)
  readExports(pkg, exportOffset, exportCount)
  r.seek(softPkgOffset > 0 ? softPkgOffset : r.pos)
  if (softPkgOffset > 0) for (let i = 0; i < softPkgCount; i++) pkg.softPackages.push(readName(r, names))
  if (registryOffset > 0) pkg.registry = readRegistry(r, registryOffset)
  return pkg
}

function skipEngineVersion(r: Bytes) {
  r.skip(2 + 2 + 2 + 4) // 主、次、修订、变更号
  r.fstring() // 分支
}

function readSoftPaths(pkg: Package, offset: number, count: number) {
  if (!(offset > 0 && count > 0)) return
  const r = pkg.bytes
  r.seek(offset)
  for (let i = 0; i < count; i++) {
    const p = readName(r, pkg.names)
    const a = readName(r, pkg.names)
    const sub = readSubPath(r, pkg)
    const top = a && a !== 'None' ? `${p}.${a}` : p === 'None' ? '' : p
    pkg.softPaths.push(sub ? `${top}:${sub}` : top)
  }
}

function readImports(pkg: Package, offset: number, count: number) {
  const r = pkg.bytes
  r.seek(offset)
  for (let i = 0; i < count; i++) {
    const classPackage = readName(r, pkg.names)
    const className = readName(r, pkg.names)
    const outer = r.i32()
    const name = readName(r, pkg.names)
    readName(r, pkg.names) // PackageName（编辑器包才有）
    if (pkg.ue5 >= UE5.OPTIONAL_RESOURCES) r.i32()
    pkg.imports.push({ classPackage, className, outer, name })
  }
}

function readExports(pkg: Package, offset: number, count: number) {
  const r = pkg.bytes
  r.seek(offset)
  for (let i = 0; i < count; i++) {
    const classIndex = r.i32()
    const superIndex = r.i32()
    const templateIndex = r.i32()
    const outer = r.i32()
    const name = readName(r, pkg.names)
    const flags = r.u32()
    const serialSize = r.i64()
    const serialOffset = r.i64()
    r.skip(12) // bForcedExport、bNotForClient、bNotForServer
    if (pkg.ue5 < UE5.REMOVE_OBJECT_EXPORT_PACKAGE_GUID) r.skip(16)
    if (pkg.ue5 >= UE5.TRACK_OBJECT_EXPORT_IS_INHERITED) r.skip(4)
    r.skip(4) // 包标志
    r.skip(8) // bNotAlwaysLoadedForEditorGame、bIsAsset
    if (pkg.ue5 >= UE5.OPTIONAL_RESOURCES) r.skip(4)
    r.skip(20) // 依赖表的位置和各段长度
    const scriptStart = r.i64()
    const scriptEnd = r.i64()
    if (serialOffset < 0 || serialOffset + serialSize > r.size)
      throw new UassetError('corrupt', t('导出对象 {name} 的数据超出了文件', { name }))
    pkg.exports.push({
      index: i,
      classIndex,
      superIndex,
      templateIndex,
      outer,
      name,
      flags,
      serialSize,
      serialOffset,
      scriptStart,
      scriptEnd,
    })
  }
}

function readRegistry(r: Bytes, offset: number): AssetRegistryEntry[] {
  r.seek(offset)
  r.i64() // 依赖数据的位置
  const n = r.i32()
  const out: AssetRegistryEntry[] = []
  for (let i = 0; i < n; i++) {
    const objectPath = r.fstring()
    const className = r.fstring()
    const tags: Record<string, string> = {}
    const k = r.i32()
    for (let j = 0; j < k; j++) {
      const key = r.fstring()
      tags[key] = r.fstring()
    }
    out.push({ objectPath, className, tags })
  }
  return out
}

/** FPackageIndex → 对象名：负数是导入、正数是导出、0 是空 */
export function indexName(pkg: Package, idx: number): string {
  if (idx < 0) return pkg.imports[-idx - 1]?.name ?? ''
  if (idx > 0) return pkg.exports[idx - 1]?.name ?? ''
  return ''
}

/** FPackageIndex → 完整对象路径（/Script/Engine.StaticMesh、/Game/A/B.B、/Game/A/B.B:Sub.Inner） */
export function indexPath(pkg: Package, idx: number): string {
  if (!idx) return ''
  const parts: string[] = []
  let cur = idx
  let guard = 0
  while (cur && guard++ < 64) {
    if (cur < 0) {
      const im = pkg.imports[-cur - 1]
      if (!im) break
      parts.unshift(im.name)
      cur = im.outer
    } else {
      const ex = pkg.exports[cur - 1]
      if (!ex) break
      parts.unshift(ex.name)
      cur = ex.outer
    }
  }
  // 导出对象最外层是这个包自己
  if (idx > 0) parts.unshift(pkg.packageName)
  return joinPath(parts)
}

/** 包名.对象名:子对象.孙对象（UE 的路径写法：包和顶层对象之间是点，再往里第一层是冒号） */
function joinPath(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  let s = `${parts[0]}.${parts[1]}`
  for (let i = 2; i < parts.length; i++) s += (i === 2 ? ':' : '.') + parts[i]
  return s
}

/** 导出对象的类名（StaticMesh、BP_Foo_C、K2Node_CallFunction） */
export const exportClass = (pkg: Package, e: ExportEntry) => indexName(pkg, e.classIndex) || 'Class'

/** 自定义版本号；文件里没有这个 GUID 时是 -1 */
export const customVersion = (pkg: Package, guid: string) => pkg.custom.get(guid.toLowerCase()) ?? -1
