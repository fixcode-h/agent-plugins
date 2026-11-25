/**
 * 读好的一个资源：容器层 + 全部导出对象，带按路径、按下标的索引。快照（snap.ts）和离线操作（asset.describe、props、
 * bp.outline……）都从它取数据，同一份读取结果，不各自再读一遍文件。
 */
import { readObjects, type UObj } from './objects.ts'
import { readPackage, type Package } from './package.ts'

export interface Asset {
  pkg: Package
  objs: UObj[]
  byRef: Map<number, UObj>
  byPath: Map<string, UObj>
  /** 资源本体：和包同名的顶层对象 */
  main: UObj | undefined
  /** 读不通的对象数（快照里提一句） */
  failed: number
}

export function readAsset(buf: Uint8Array): Asset {
  const pkg = readPackage(buf)
  const objs = readObjects(pkg)
  const byRef = new Map(objs.map((o) => [o.ref, o]))
  const byPath = new Map(objs.map((o) => [o.path, o]))
  const short = pkg.packageName.split('/').pop() ?? ''
  const top = objs.filter((o) => o.outer === 0)
  const main =
    top.find((o) => o.name === short && !o.isCdo && !o.class.endsWith('GeneratedClass')) ??
    top.find((o) => !o.isCdo && o.class !== 'MetaData' && !o.class.endsWith('GeneratedClass'))
  return { pkg, objs, byRef, byPath, main, failed: objs.filter((o) => o.error).length }
}

/** 路径（属性里存的对象引用）→ 这个包里的对象 */
export const objAt = (a: Asset, path: unknown) => (typeof path === 'string' && path ? a.byPath.get(path) : undefined)

/** 直接挂在某个对象下面的子对象 */
export const childrenOf = (a: Asset, o: UObj) => a.objs.filter((x) => x.outer === o.ref)

/** 某个对象下面的全部子对象（含孙对象） */
export function nestedOf(a: Asset, o: UObj): UObj[] {
  const out: UObj[] = []
  const walk = (p: UObj) => {
    for (const c of childrenOf(a, p)) {
      out.push(c)
      walk(c)
    }
  }
  walk(o)
  return out
}

/** 对象相对某个外层的路径（Sub、Sub.Inner），两版资源包名不同也能配对 */
export function relPath(a: Asset, o: UObj, stop: UObj): string {
  const parts: string[] = []
  let cur: UObj | undefined = o
  let guard = 0
  while (cur && cur.ref !== stop.ref && guard++ < 64) {
    parts.unshift(cur.name)
    cur = cur.outer > 0 ? a.byRef.get(cur.outer) : undefined
  }
  return parts.join('.')
}

/** 资源路径最后一段的对象名（/Game/A/B.B_C → B_C） */
export const shortName = (path: unknown) => (typeof path === 'string' ? (path.split(/[.:]/).pop() ?? path) : '')
