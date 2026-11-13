/**
 * 项目的类型表（结构文件 types.json）：表头类型行里写的类型名是什么、格子里怎么存、表格页里怎么显示。
 *
 * 用户 2026-11-13 定：同一个值有两种写法——「存储样式」是表格文件里实际写的字（例如 FVector 存成 1#2#3，
 * 用模板 {X}#{Y}#{Z} 配），「显示样式」是表格页里给人看的样子（(X=1,Y=2,Z=3)）。表格文件一个字节都不因此改变：
 * 只有用户在弹窗里改了值，才按存储样式拼回去写进格子。
 *
 * 数组、集合、映射是内置的容器（TArray<T>、TSet<T>、TMap<K,V>…），它们的存储和显示样式是项目级的一份（style.formats）；
 * 结构体、别名、带范围的基础类型写在这里。UE 常用类型的预设见 table-types-ue.ts，导入后和自己加的一样能改。
 */
import { z } from 'zod'

/** 类型表最多这么多个类型 */
export const TYPES_MAX = 500
/** 结构体最多这么多个字段 */
export const FIELDS_MAX = 40

export const TYPE_KINDS = ['struct', 'alias', 'int', 'uint', 'float', 'bool', 'string'] as const
export type TypeKind = (typeof TYPE_KINDS)[number]

/** 结构体的一个字段 */
export const TypeField = z.object({
  name: z.string().trim().min(1).max(100),
  /** 字段的类型式：int32、FVector、TArray<FName>… */
  type: z.string().trim().min(1).max(200),
  min: z.number().optional(),
  max: z.number().optional(),
  /** 取值是某个通用枚举 */
  enum: z.string().max(200).optional(),
  /** 引用别的表的主键（同列结构的 ref） */
  ref: z.string().max(500).optional(),
  /** 存储时可以不写：没写就按默认值（default）显示 */
  optional: z.boolean().optional(),
  default: z.string().max(200).optional(),
  note: z.string().max(300).optional(),
})
export type TypeField = z.infer<typeof TypeField>

/** 类型表里的一个类型 */
export const TableType = z.object({
  kind: z.enum(TYPE_KINDS),
  /** 别名：表头里写哪个都认（Vector = FVector） */
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  /** 结构体的字段，按顺序 */
  fields: z.array(TypeField).max(FIELDS_MAX).optional(),
  /** 别名指向的类型式（alias）：ItemList = TArray<int32> */
  of: z.string().trim().max(200).optional(),
  /** 存储样式：结构体的模板，{字段名} 是占位，例如 {X}#{Y}#{Z}；不写就是字段按 style.formats.field 连起来 */
  store: z.string().max(300).optional(),
  /** 显示样式：同样的模板，例如 (X={X},Y={Y},Z={Z})；不写就是 UE 的写法 */
  show: z.string().max(300).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(300).optional(),
  note: z.string().max(500).optional(),
})
export type TableType = z.infer<typeof TableType>

/** 类型表：类型名 → 定义 */
export const TableTypes = z
  .record(z.string().trim().min(1).max(100), TableType)
  .refine((r) => Object.keys(r).length <= TYPES_MAX, { message: `too many types (> ${TYPES_MAX})` })
export type TableTypes = z.infer<typeof TableTypes>

/** 一种容器在格子里的写法：外面包的符号、项之间的分隔符；映射另有一项的模板（{K}、{V}） */
export const ListFormat = z.object({
  open: z.string().max(8).default(''),
  sep: z.string().min(1).max(8),
  close: z.string().max(8).default(''),
})
export type ListFormat = z.infer<typeof ListFormat>
export const MapFormat = ListFormat.extend({ entry: z.string().min(1).max(40) })
export type MapFormat = z.infer<typeof MapFormat>

/**
 * 项目级的容器写法（style.formats）。数组存储时的分隔符仍是 style.listSep（列结构里还能单独改），
 * 这里只管存储时外面包不包符号；显示样式默认照 UE 的写法
 */
export const TypeFormats = z.object({
  /** 结构体没写存储模板时，字段之间的分隔符 */
  field: z.string().min(1).max(8).default(','),
  listStore: z
    .object({
      open: z.string().max(8).default(''),
      close: z.string().max(8).default(''),
      /** 数组套在数组、映射、结构体里时（第二层起）项之间的分隔符 */
      inner: z.string().min(1).max(8).default('|'),
    })
    .default({ open: '', close: '', inner: '|' }),
  listShow: ListFormat.default({ open: '(', sep: ',', close: ')' }),
  mapStore: MapFormat.default({ open: '', sep: ';', close: '', entry: '{K}:{V}' }),
  mapShow: MapFormat.default({ open: '(', sep: ',', close: ')', entry: '({K}, {V})' }),
})
export type TypeFormats = z.infer<typeof TypeFormats>
export const defaultFormats = (): TypeFormats => TypeFormats.parse({})

/** 结构体的默认存储模板：字段按分隔符连起来 */
export const defaultStore = (fields: TypeField[], sep: string) => fields.map((f) => `{${f.name}}`).join(sep)
/** 结构体的默认显示模板：UE 的写法 (X={X},Y={Y}) */
export const defaultShow = (fields: TypeField[]) => `(${fields.map((f) => `${f.name}={${f.name}}`).join(',')})`
