/**
 * 对象引用的两种存法：硬引用是 FPackageIndex（导入 / 导出表的下标），软引用是 FSoftObjectPath。
 * 5.1 起包里的软引用统一存进文件头的软引用表，属性里只存表里的下标（表为空时才按 包名、资源名、子路径 直接存）。
 * 值照桥接的写法给完整路径字符串，空引用是空字符串（桥接给 null，比较时两边都按「空」处理）。
 */
import type { Bytes } from './bytes.ts'
import { customVersion, indexPath, readName, type Package } from './package.ts'

/** FFortniteMainBranchObjectVersion：SoftObjectPathUtf8SubPaths（5.6）起子路径存成 UTF-8 */
const FORTNITE_MAIN = '601d1886ac644f84aa16d3de0deac7d6'
const UTF8_SUB_PATHS = 192

export const readSubPath = (r: Bytes, pkg: Package) =>
  customVersion(pkg, FORTNITE_MAIN) >= UTF8_SUB_PATHS ? r.utf8string() : r.fstring()

export function readObjectRef(r: Bytes, pkg: Package): string | null {
  const idx = r.i32()
  return idx ? indexPath(pkg, idx) : null
}

export function readSoftPath(r: Bytes, pkg: Package): string {
  if (pkg.softPaths.length) {
    const i = r.i32()
    return pkg.softPaths[i] ?? ''
  }
  const p = readName(r, pkg.names)
  const a = readName(r, pkg.names)
  const sub = readSubPath(r, pkg)
  const top = p === 'None' ? '' : a && a !== 'None' ? `${p}.${a}` : p
  return sub ? `${top}:${sub}` : top
}
