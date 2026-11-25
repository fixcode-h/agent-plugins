/**
 * FText：先是标志（uint32）和历史类型（int8），再按类型往下读。编辑器保存的属性和引脚里绝大多数是
 * None（空或文化无关的字符串）、Base（命名空间 + 键 + 原文）、StringTableEntry（字符串表 + 键）三种；
 * 格式化类（{0} 拼接、大小写转换）也读出原文；日期、数字格式化这些少见的报 unsupported，属性那一层按字节数跳过。
 */
import type { Bytes } from './bytes.ts'
import { UassetError } from './errors.ts'
import { t } from './i18n.ts'
import { customVersion, readName, type Package } from './package.ts'

/** FFortniteMainBranchObjectVersion：AddDevNotesToFText 起 Base 文本多存一段开发备注 */
const FORTNITE_MAIN = '601d1886ac644f84aa16d3de0deac7d6'
const ADD_DEV_NOTES_TO_FTEXT = 260

export function readText(r: Bytes, pkg: Package): string {
  r.u32() // 标志
  const kind = r.i8()
  switch (kind) {
    case -1: {
      // None：可能带一段文化无关的字符串
      return r.bool32() ? r.fstring() : ''
    }
    case 0: {
      r.fstring() // 命名空间
      r.fstring() // 键
      const source = r.fstring()
      if (customVersion(pkg, FORTNITE_MAIN) >= ADD_DEV_NOTES_TO_FTEXT) r.fstring()
      return source
    }
    case 1: {
      // NamedFormat：格式 + {名字: 值}
      let fmt = readText(r, pkg)
      const n = r.i32()
      for (let i = 0; i < n; i++) {
        const key = r.fstring()
        fmt = fmt.replaceAll(`{${key}}`, argValue(r, pkg))
      }
      return fmt
    }
    case 2: {
      // OrderedFormat：格式 + [值]
      let fmt = readText(r, pkg)
      const n = r.i32()
      for (let i = 0; i < n; i++) fmt = fmt.replaceAll(`{${i}}`, argValue(r, pkg))
      return fmt
    }
    case 10: {
      // Transform：原文 + 转换方式（0 小写、1 大写）
      const src = readText(r, pkg)
      return r.u8() === 1 ? src.toUpperCase() : src.toLowerCase()
    }
    case 11: {
      // StringTableEntry：字符串表 ID + 键，原文在字符串表资源里
      const table = readName(r, pkg.names)
      const key = r.fstring()
      return `LOCTABLE("${table}", "${key}")`
    }
    default:
      throw new UassetError('unsupported', t('文本用了不常见的格式（类型 {k}），这一项没读', { k: kind }))
  }
}

function argValue(r: Bytes, pkg: Package): string {
  const type = r.i8()
  switch (type) {
    case 0:
      return String(r.i64Value())
    case 1:
      return String(r.u64Value())
    case 2:
      return String(r.f32())
    case 3:
      return String(r.f64())
    case 4:
      return readText(r, pkg)
    case 5:
      return String(r.u64Value())
    default:
      throw new UassetError('unsupported', t('文本格式化参数的类型认不出（{k}）', { k: type }))
  }
}
