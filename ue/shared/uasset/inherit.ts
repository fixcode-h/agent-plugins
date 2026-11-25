/**
 * 文件里每个对象只存「和它的原型（archetype）不一样的」属性，结构体成员也只存改过的那几个。要看全，得把原型链上的值一层层
 * 垫在下面：类默认对象的原型是父类的类默认对象；类默认对象下面的子对象（C++ 组件）的原型是父类默认对象下面的同名子对象；
 * 父蓝图组件在子蓝图里的改动（InheritableComponentHandler）的原型是父蓝图里同名的组件模板；其余的是自己类的默认对象。
 * 这里只算「原型在哪」和「怎么合」，按路径去哪儿取（父蓝图的文件、编辑器记下的 C++ 默认值）由服务端决定。
 */
import type { Asset } from './asset.ts'
import { indexPath } from './package.ts'
import type { UObj } from './objects.ts'

/** 类路径 → 它的类默认对象：/Script/Engine.Character → /Script/Engine.Default__Character */
export function defaultObjectPath(classPath: string): string {
  const i = classPath.lastIndexOf('.')
  return i < 0 ? '' : `${classPath.slice(0, i)}.Default__${classPath.slice(i + 1)}`
}

/** 对象路径下面的子对象：顶层对象后面用 :，再往下用 .（和 UE 的写法一样） */
export const subPath = (base: string, name: string) => (base.includes(':') ? `${base}.${name}` : `${base}:${name}`)

/** 对象的类的完整路径（导入的 /Script/Engine.CapsuleComponent，或这个包里的 /Game/A/B.B_C） */
export const classPathOf = (a: Asset, o: UObj) => indexPath(a.pkg, a.pkg.exports[o.ref - 1]?.classIndex ?? 0)

const isGenClass = (o: UObj) => /GeneratedClass$/.test(o.class)

/** 生成类的父类路径：导出表上的 SuperIndex */
const superOf = (a: Asset, gen: UObj) => indexPath(a.pkg, a.pkg.exports[gen.ref - 1]?.superIndex ?? 0)

/**
 * 对象「按位置」的原型路径：生成类 → 父类；类默认对象 → 父类的类默认对象；它们下面的子对象 → 原型下面的同名子对象。
 * 返回 undefined 表示没有按位置的原型，直接用自己类的默认对象（classDefaultOf）
 */
export function archetypePath(a: Asset, o: UObj, depth = 0): string | undefined {
  if (depth > 16) return undefined
  if (isGenClass(o)) return superOf(a, o) || undefined
  if (o.isCdo) {
    const cls = a.byRef.get(a.pkg.exports[o.ref - 1]?.classIndex ?? 0)
    const sup = cls && isGenClass(cls) ? superOf(a, cls) : ''
    return sup ? defaultObjectPath(sup) : undefined
  }
  const outer = o.outer > 0 ? a.byRef.get(o.outer) : undefined
  if (!outer) return undefined
  const base = archetypePath(a, outer, depth + 1)
  return base ? subPath(base, o.name) : undefined
}

/** 自己类的默认对象（原型链走不通时的兜底） */
export const classDefaultOf = (a: Asset, o: UObj) => defaultObjectPath(classPathOf(a, o))

/** 一层属性：照 UELink props 的一条（name、type、category、displayName……），value 是合好的值 */
export type LayerProp = Record<string, unknown> & { name: string; value: unknown }

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !('_truncated' in (v as object))

/** 结构体按成员合（文件里的结构体只存改过的成员），其余（数组、映射、标量）上层整个盖掉下层 */
export function mergeValue(base: unknown, over: unknown, depth = 0): unknown {
  if (depth > 32 || !plain(base) || !plain(over)) return over
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    // 成员名大小写可能不一致（桥接和读取器都是首字母小写，老数据不一定）
    const key = k in base ? k : (Object.keys(base).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k)
    out[key] = mergeValue(base[key], v, depth + 1)
  }
  return out
}

/** 这个对象自己文件里的一条属性（值已经整理成 JSON） */
export interface OwnProp {
  name: string
  type: string
  arrayIndex: number
  value: unknown
}

/**
 * 下层（原型合好的）+ 本层（文件里改过的）：顺序按下层（编辑器给的反射顺序），本层多出来的接在后面。
 * 静态数组（int32 A[4]）在文件里一项一条，带下标：合回一条数组，和桥接一样。这一层改过的标 changed: true
 */
export function mergeLayer(base: LayerProp[], own: OwnProp[], ownMeta: (p: OwnProp) => Record<string, unknown>) {
  // 下层自己的 changed 是相对更下层说的，到这一层不算
  const out = base.map(({ changed: _, ...p }) => p as LayerProp)
  const at = new Map(out.map((p, i) => [p.name.toLowerCase(), i]))
  for (const p of own) {
    const i = at.get(p.name.toLowerCase())
    const prev = i === undefined ? undefined : out[i]
    let value: unknown
    if (p.arrayIndex > 0 || (prev && Array.isArray(prev.value) && !Array.isArray(p.value) && !prev.container)) {
      const arr = Array.isArray(prev?.value) ? [...prev.value] : prev ? [prev.value] : []
      arr[p.arrayIndex] = mergeValue(arr[p.arrayIndex], p.value)
      value = arr
    } else value = mergeValue(prev?.value, p.value)
    if (prev) out[i!] = { ...prev, value, changed: true }
    else {
      at.set(p.name.toLowerCase(), out.length)
      out.push({ ...ownMeta(p), name: p.name, value, changed: true })
    }
  }
  return out
}
