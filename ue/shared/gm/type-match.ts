/**
 * 抓取值的类型匹配（用户 2026-11-22：抓取的值类型得对得上，类型不符合的不列出来）。
 * 把 UE 的 C++ 类型字符串（int32、FName、TArray<FName>、UWidget*、FVector、ESlateVisibility）和
 * Lua 注解类型（number、string、boolean、table、any）归成同一套「形状」，再按形状比。
 * 对象只比是不是对象（继承关系面板拿不到，交给 UE 写的时候报错）
 */
export type TypeShape =
  | { k: 'any' }
  /** int：整数（int32、uint8…），填整数的地方不收小数 */
  | { k: 'num'; int?: boolean }
  | { k: 'bool' }
  | { k: 'str' }
  | { k: 'enum'; name: string }
  | { k: 'obj' }
  | { k: 'arr'; of: TypeShape }
  | { k: 'struct'; name: string }
  /** Lua 的 table：数组、结构体、表都能放 */
  | { k: 'table' }

const INT = /^(u?int(8|16|32|64)?|integer|byte)$/i
const NUM = /^(float|double|number|real)$/i
const STR = /^(FString|FName|FText|string)$/i

/** 类型字符串 → 形状；看不懂的当 any（宁可多列，写的时候 UE 会说类型不对） */
export function shapeOf(type: string | undefined): TypeShape {
  let s = (type ?? '')
    .trim()
    .replace(/^(const\s+|class\s+|struct\s+|enum\s+)+/, '')
    .replace(/&$/, '')
    .trim()
  if (!s || /^(any|unknown|nil|\?)$/i.test(s)) return { k: 'any' }
  // Lua 注解的可空写法 number? / number|nil
  s = s.replace(/\?$/, '').replace(/\|nil$/, '')
  if (/^bool(ean)?$/i.test(s)) return { k: 'bool' }
  if (INT.test(s)) return { k: 'num', int: true }
  if (NUM.test(s)) return { k: 'num' }
  if (STR.test(s)) return { k: 'str' }
  if (/^table$/i.test(s)) return { k: 'table' }
  const arr = /^TArray<(.+)>$/.exec(s) ?? /^(.+)\[\]$/.exec(s)
  if (arr) return { k: 'arr', of: shapeOf(arr[1]) }
  const wrapped = /^(TEnumAsByte)<(.+)>$/.exec(s)
  if (wrapped) return shapeOf(wrapped[2])
  if (
    /\*$/.test(s) ||
    /^(TObjectPtr|TWeakObjectPtr|TSoftObjectPtr|TSubclassOf|TSoftClassPtr|TScriptInterface)</.test(s)
  )
    return { k: 'obj' }
  if (/^E[A-Z]\w*$/.test(s)) return { k: 'enum', name: s }
  if (/^F[A-Z]\w*$/.test(s)) return { k: 'struct', name: s }
  // Lua 类名（UI.Shop、BP_Game）：Lua 里实例就是 table
  return { k: 'table' }
}

/** src 的值能不能填进 dst（目标变量的类型） */
export function shapeFits(dst: TypeShape, src: TypeShape): boolean {
  if (dst.k === 'any' || src.k === 'any') return true
  if (dst.k === 'table') return src.k === 'table' || src.k === 'arr' || src.k === 'struct' || src.k === 'obj'
  if (dst.k === 'arr') return src.k === 'arr' ? shapeFits(dst.of, src.of) : src.k === 'table'
  if (dst.k === 'struct') return (src.k === 'struct' && src.name === dst.name) || src.k === 'table'
  if (dst.k === 'enum') return src.k === 'enum' && src.name === dst.name
  // 整数不收小数（float → int32 会截断）；小数、Lua number 收整数
  if (dst.k === 'num') return src.k === 'num' && (!dst.int || !!src.int)
  return dst.k === src.k
}

export const typeFits = (dst: string | undefined, src: string | undefined) => shapeFits(shapeOf(dst), shapeOf(src))

/** 目标是不是对象（左栏的实例本身能不能抓） */
export const wantsObject = (dst: string | undefined) => {
  const k = shapeOf(dst).k
  return k === 'obj' || k === 'any' || k === 'table'
}

/** 值本身的形状（展开后的子项没有类型，按值推） */
export function shapeOfValue(v: unknown): TypeShape {
  if (typeof v === 'number') return Number.isInteger(v) ? { k: 'num', int: true } : { k: 'num' }
  if (typeof v === 'boolean') return { k: 'bool' }
  if (typeof v === 'string') return { k: 'str' }
  if (Array.isArray(v)) return { k: 'arr', of: v.length ? shapeOfValue(v[0]) : { k: 'any' } }
  if (v && typeof v === 'object')
    return typeof (v as { $obj?: unknown }).$obj === 'string' ? { k: 'obj' } : { k: 'table' }
  return { k: 'any' }
}

/** 按值判断能不能填（展开出来的子项用）：枚举的值是名字字符串，填枚举时放行文字 */
export function valueFits(dst: string | undefined, v: unknown): boolean {
  const d = shapeOf(dst)
  const s = shapeOfValue(v)
  if (d.k === 'enum') return s.k === 'str'
  if (d.k === 'struct') return s.k === 'table'
  return shapeFits(d, s)
}

/** 结构体 / 数组本身对不上时，展开后里面的成员可能对得上：留着这一行让人展开 */
export function mayContain(dst: string | undefined, src: string | undefined): boolean {
  const s = shapeOf(src)
  if (s.k === 'struct' || s.k === 'table' || s.k === 'any') return true
  if (s.k === 'arr') return shapeFits(shapeOf(dst), s.of) || s.of.k === 'struct' || s.of.k === 'table'
  return false
}
