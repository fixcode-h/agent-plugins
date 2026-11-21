import { z } from 'zod'

/**
 * gm.json v2 的契约（GM 页重设计规格第 8 节，用户 2026-11-21 确认）。团队共用的文件：GM 页、ue_gm 工具、宏执行都按它读写。
 * 默认存在项目文档根的 AgentPanel/UE/gm.json（和 Lua GM 扫描设置同一个目录），项目设置选「只在本机」时存插件数据目录。
 * 没有 `version: 2` 的文件按空的新格式处理（不迁移：旧的 favGm / favConsole 不再读，规格第 1 节）；
 * 只有从旧位置 .agent-panel/ue/gm.json 搬到文档根那一次，保留预设、宏和表格关联（server/store.ts）。
 *
 * 条目的键：`lua:<GM 名>`、`cpp:<类>.<函数>`、`custom:<id>`、`console:<命令>`；最近执行、收藏、宏、moduleOf 都按它认。
 */
export const GM_VERSION = 2

/** GameTest 对象引用（匹配规则，UEKit docs/game-test-ref.md 第 1 节）：这里只要求有 class，其余字段原样存 */
export const GmRef = z.looseObject({ class: z.string() })
export type GmRef = z.infer<typeof GmRef>

export const GmModule = z.object({ id: z.string().min(1), name: z.string().min(1) })
export type GmModule = z.infer<typeof GmModule>

/** 一个对象：匹配规则 ref，或来源字符串 src（`@pawn`、`@sub.X`、`@luaMod.X`），二选一 */
const objFields = {
  ref: GmRef.optional(),
  src: z.string().optional(),
}
const oneOf = (o: { ref?: unknown; src?: string }) => !!o.ref !== !!o.src
const ONE_OF = { message: 'ref 和 src 要写一个且只写一个' }

/** 对象列表里的一项（对象调用左栏） */
export const GmObject = z
  .object({ name: z.string().min(1), ...objFields, by: z.literal('agent').optional() })
  .refine(oneOf, ONE_OF)
export type GmObject = z.infer<typeof GmObject>

/** 自定义 GM 自带的对象（保存时从对象列表复制进来，之后改对象列表不影响它） */
export const GmCustomObj = z.object(objFields).refine(oneOf, ONE_OF)
export type GmCustomObj = z.infer<typeof GmCustomObj>

/** 命中多个时：报错 / 只调第一个（Ref many=first）/ 对每个都调一遍（obj.call each） */
export const GmMany = z.enum(['error', 'first', 'each'])
export type GmMany = z.infer<typeof GmMany>

/**
 * 自定义 GM：对象调用「保存为 GM」或 Agent 的 ue_gm save 存下的。kind=call 调 obj 上的 function；
 * kind=get 取 obj 命中的每个实例的 props 此刻的值。args 里对象参数写 `{"$obj": 名字}`（名字在 objects 里）或来源字符串
 */
export const GmCustom = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  module: z.string().min(1),
  note: z.string().optional(),
  by: z.literal('agent').optional(),
  kind: z.enum(['call', 'get']).default('call'),
  obj: z.string().min(1),
  objects: z.record(z.string(), GmCustomObj),
  function: z.string().optional(),
  part: z.string().nullable().optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  /** 执行时能改的参数（GM 页表单里只有这些能填，ue_gm run 也只能改这些） */
  editable: z.array(z.string()).default([]),
  many: GmMany.default('error'),
  /** kind=get 读的属性路径（v5 写法，`@/TxtTitle.Text`） */
  props: z.array(z.string()).optional(),
})
export type GmCustom = z.infer<typeof GmCustom>
export type GmCustomInput = z.input<typeof GmCustom>

/** 宏的一步：C++ GM（gm）、Lua GM（lua）、控制台命令（console）、自定义 GM（custom，args 按参数名） */
export const GmMacroStep = z.object({
  gm: z.string().optional(),
  lua: z.string().optional(),
  console: z.string().optional(),
  custom: z.string().optional(),
  args: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
})
export type GmMacroStep = z.infer<typeof GmMacroStep>

export const GmMacro = z.object({ id: z.string(), name: z.string(), steps: z.array(GmMacroStep) })
export type GmMacro = z.infer<typeof GmMacro>

export const GmPreset = z.object({
  id: z.string(),
  name: z.string(),
  gm: z.string().optional(),
  console: z.string().optional(),
  args: z.array(z.string()).optional(),
})
export type GmPreset = z.infer<typeof GmPreset>

/**
 * 参数关联的表格列。table 存相对路径（正斜杠）：项目在版本管理里时相对版本管理根（.git / .svn / .hg / .plastic / P4 工作区根），
 * 不在时相对 UE 项目根；表格在这个根之外时存绝对路径。读时按同样的根拼回去，旧数据里的绝对路径照样能用（table-path.ts）
 */
export const GmTableBinding = z.object({
  table: z.string(),
  sheet: z.string().optional(),
  key: z.string(),
  label: z.string().optional(),
  extra: z.array(z.string()).optional(),
})
export type GmTableBinding = z.infer<typeof GmTableBinding>

/** 收藏的一条：条目键 + 那组参数（宏、对象调用只有键：`macro:<id>`、`obj:<对象名>`） */
export const GmFav = z.object({
  key: z.string().min(1),
  args: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
})
export type GmFav = z.infer<typeof GmFav>

export const GM_CATS = ['gm', 'engine', 'macro', 'objcall'] as const
export type GmCat = (typeof GM_CATS)[number]

export const GmStore = z.object({
  version: z.literal(GM_VERSION),
  presets: z.array(GmPreset).default([]),
  modules: z.array(GmModule).default([]),
  /** 手动移过模块的 GM：条目键 → 模块 id（没移过的按分组第一段归模块） */
  moduleOf: z.record(z.string(), z.string()).default({}),
  objects: z.array(GmObject).default([]),
  custom: z.array(GmCustom).default([]),
  /** 每个分类一份收藏（GM 页左栏最下面） */
  favs: z
    .object({
      gm: z.array(GmFav).default([]),
      engine: z.array(GmFav).default([]),
      macro: z.array(GmFav).default([]),
      objcall: z.array(GmFav).default([]),
    })
    .default({ gm: [], engine: [], macro: [], objcall: [] }),
  macros: z.array(GmMacro).default([]),
  /** 旧的 C++ GM 参数绑 DataTable：键 <GM 名>.<参数名>，值是 DataTable 路径 */
  bindings: z.record(z.string(), z.string()).optional(),
  /** C++ GM 参数关联表格的列：键 <GM 名>.<参数名> */
  tableBindings: z.record(z.string(), GmTableBinding).optional(),
})
export type GmStore = z.infer<typeof GmStore>

export const emptyGm = (): GmStore => GmStore.parse({ version: GM_VERSION })

/** 读到的文件内容 → v2：不是 v2（旧格式、坏文件）按空的新格式；字段不合格式的抛错，原样给页面和 Agent */
export function parseGm(raw: unknown): GmStore {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== GM_VERSION) return emptyGm()
  return GmStore.parse(raw)
}

/** 自定义 GM 的条目键 */
export const customKey = (id: string) => `custom:${id}`
