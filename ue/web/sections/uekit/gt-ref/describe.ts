import type { GtIdentItem, GtRef, GtRefLike, GtTarget } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'
import { NO_VALUE_OPS, opLabel } from './compare-table.ts'

/**
 * 【临时本地适配】引用的人话描述（协议第 0 节「面板显示时把引用说成一句人话」）。
 * shared/gt-script/ref 的 describe 写好后换成那一份；这里只管界面上一行字怎么拼
 */

/** 类名显示用：去掉资源路径前缀、`_C` 后缀（`/Game/UI/WBP_Shop.WBP_Shop_C` → `WBP_Shop`） */
export function classShort(cls: string | undefined): string {
  const s = (cls ?? '').trim()
  const last = s.split(/[/.]/).filter(Boolean).pop() ?? s
  return last.replace(/_C$/, '')
}

const show = (v: unknown) =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => String(x)).join(', ') : JSON.stringify(v)

/** 一条标识 / 判断的一句话：`@TxtTitle:text 等于 杂货铺` */
export function identText(it: Partial<GtIdentItem>): string {
  const op = it.op ?? (it.value === undefined ? '' : 'eq')
  if (!op) return it.prop ?? ''
  if (op === 'count') return `${it.prop} ${opLabel('count')} ${opLabel(it.cmp ?? 'eq')} ${show(it.value)}`
  if (NO_VALUE_OPS.has(op)) return `${it.prop} ${opLabel(op)}`
  if (op === 'is' && typeof it.value === 'boolean') return `${it.prop} ${it.value ? t('是') : t('否')}`
  return `${it.prop} ${opLabel(op)} ${show(it.value)}`
}

/** 标识的短写（对象卡片的 chips、脚本对象列表）：属性名去掉 `@self.`，值跟在后面 */
export function identShort(it: GtIdentItem): string {
  const name = it.prop.replace(/^@self\./, '').replace(/^@/, '')
  if (NO_VALUE_OPS.has(it.op ?? '')) return `${name} ${opLabel(it.op!)}`
  const op = !it.op || it.op === 'eq' || it.op === 'is' ? '=' : opLabel(it.op)
  return `${name} ${op} ${show(it.value)}`
}

/** 引用的一句话：`WBP_Shop（标题 = 杂货铺，ShopId = 1001）`；名字引用、`$var` 原样 */
export function describeRef(ref: GtRefLike | undefined): string {
  if (ref === undefined || ref === null) return ''
  if (typeof ref === 'string') return ref
  const cls = classShort(ref.class)
  const ids = ref.ident ?? []
  return ids.length ? `${cls}（${ids.map(identShort).join('，')}）` : cls
}

/** 对象卡片的「在哪找」 */
export function inText(inn: GtRef['in']): string {
  if (inn === undefined) return t('自动')
  if (inn === 'screen') return t('屏上的界面')
  if (inn === 'world') return t('关卡里')
  if (inn === 'all') return t('所有对象')
  if (typeof inn === 'string') return inn
  return `${typeof inn.obj === 'string' ? inn.obj : classShort(inn.obj.class)}${inn.part ? ` › ${inn.part}` : ''}`
}

/** 引用对象（不是名字、不是 $var） */
export const isRefObj = (v: unknown): v is GtRef =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as GtRef).class === 'string'

/** 第 2 节的 target：`{obj, part?, slate?}`；也接受直接写引用（= {obj: 它}） */
export function asTarget(v: unknown): GtTarget | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v.startsWith('$') || /^[A-Za-z_]\w*$/.test(v) ? { obj: v } : undefined
  if (typeof v !== 'object' || Array.isArray(v)) return undefined
  if ('obj' in (v as object)) return v as GtTarget
  if (isRefObj(v)) return { obj: v }
  return undefined
}

/** v3 的选择器字符串（`WBP_X:Root/Btn`）：v4 里不认，界面上提示升级 */
export const isOldSelector = (v: unknown) => typeof v === 'string' && v !== '' && !asTarget(v)

/** 动作落点的一句话：`shop › BtnBuy`；旧选择器原样 */
export function targetText(v: unknown): string {
  if (typeof v === 'string') return v
  const tg = asTarget(v)
  if (!tg) return ''
  const obj = typeof tg.obj === 'string' ? tg.obj : describeRef(tg.obj)
  return [obj, tg.part, tg.slate].filter(Boolean).join(' › ')
}

/** 把名字引用展开成对象（gt.resolve 不认场景里的名字时，面板先展开再问）；`in.obj` 也展开，成环就停 */
export function inlineRef(ref: GtRefLike, objects: Record<string, unknown> | undefined, depth = 0): GtRefLike {
  if (depth > 8) return ref
  if (typeof ref === 'string') {
    const o = !ref.startsWith('$') ? objects?.[ref] : undefined
    return isRefObj(o) ? inlineRef(o, objects, depth + 1) : ref
  }
  if (ref.in && typeof ref.in === 'object')
    return { ...ref, in: { ...ref.in, obj: inlineRef(ref.in.obj, objects, depth + 1) } }
  return ref
}

/** 引用的类（名字查 objects）：列部件、按类读属性用 */
export function classOfRef(ref: GtRefLike | undefined, objects?: Record<string, unknown>): string {
  if (!ref) return ''
  const r = inlineRef(ref, objects)
  return typeof r === 'string' ? '' : r.class
}

/** 步骤标题里的控件名：部件名，没有部件时是对象名或类名 */
export function targetShort(v: unknown): string {
  const tg = asTarget(v)
  if (!tg) return typeof v === 'string' ? v : ''
  if (tg.part) return tg.part.split('.').pop() ?? tg.part
  return typeof tg.obj === 'string' ? tg.obj : classShort(tg.obj.class)
}
