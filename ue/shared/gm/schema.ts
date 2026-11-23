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

/** 对象列表里的一项（对象调用左栏）。folder 是放在哪个文件夹（用 / 分层）；没有的是加文件夹之前存的，显示在最外层 */
export const GmObject = z
  .object({
    name: z.string().min(1),
    ...objFields,
    folder: z.string().optional(),
    by: z.literal('agent').optional(),
  })
  .refine(oneOf, ONE_OF)
export type GmObject = z.infer<typeof GmObject>

/** 自定义 GM 自带的对象（保存时从对象列表复制进来，之后改对象列表不影响它） */
export const GmCustomObj = z.object(objFields).refine(oneOf, ONE_OF)
export type GmCustomObj = z.infer<typeof GmCustomObj>

/**
 * 自定义 GM 调的函数的一个参数（保存时从函数签名抄进来）。只存 args 的话，保存时没填、留给函数默认值的参数就丢了，
 * 详情页显示「没有参数」、执行时也没法再填（用户 2026-11-23 报）。obj 有值时是对象参数（cls 类名，lua 表示 Lua 类）
 */
export const GmCustomParam = z.object({
  name: z.string().min(1),
  type: z.string().default(''),
  obj: z.object({ cls: z.string(), lua: z.boolean().default(false) }).optional(),
})
export type GmCustomParam = z.infer<typeof GmCustomParam>

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
  /** 函数的全部参数，按签名顺序（没存的旧数据按 args 的键）；args 里没有的参数不传，用函数的默认值 */
  params: z.array(GmCustomParam).optional(),
  /** 执行时能改的参数（GM 页表单里只有这些能填，ue_gm run 也只能改这些） */
  editable: z.array(z.string()).default([]),
  many: GmMany.default('error'),
  /** kind=get 读的属性路径（v5 写法，`@/TxtTitle.Text`） */
  props: z.array(z.string()).optional(),
})
export type GmCustom = z.infer<typeof GmCustom>
export type GmCustomInput = z.input<typeof GmCustom>

/** 宏的一步：C++ GM（gm）、Lua GM（lua）、控制台命令（console）、自定义 GM（custom，args 按参数名）、等几秒（wait，GM 页梳理 F5） */
export const GmMacroStep = z.object({
  gm: z.string().optional(),
  /** 等这么多秒再做下一步（等加载、等动画）；最多 600 秒 */
  wait: z.number().min(0).max(600).optional(),
  lua: z.string().optional(),
  console: z.string().optional(),
  custom: z.string().optional(),
  args: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
})
export type GmMacroStep = z.infer<typeof GmMacroStep>

export const GmMacro = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(GmMacroStep),
  /** 某步失败时：停下（默认）或跳过接着做后面的 */
  onFail: z.enum(['stop', 'skip']).optional(),
})
export type GmMacro = z.infer<typeof GmMacro>

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

/**
 * 「常用」里的一条（用户 2026-11-22：四个分类的收藏合成一份）：条目键 + 那组参数 + 所在分组。
 * 键：`lua:<名>`、`cpp:<类>.<函数>`、`custom:<id>`、`console:<命令>`、`macro:<id>`、`obj:<对象名>`；宏和对象只有键
 */
export const GmFav = z.object({
  key: z.string().min(1),
  args: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  /** 分组名（「常用」树里的文件夹，/ 分层）；不写放最外层 */
  group: z.string().optional(),
})
export type GmFav = z.infer<typeof GmFav>

/** 一组起了名字的参数（参数预设）：扫描出来的 GM 按顺序，自定义 GM 按参数名 */
export const GmArgPreset = z.object({
  name: z.string().min(1),
  args: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]),
})
export type GmArgPreset = z.infer<typeof GmArgPreset>

/** GM 页左栏的分类（常用 · GM · 引擎命令 · 宏 · 对象调用） */
export const GM_CATS = ['common', 'gm', 'engine', 'macro', 'objcall'] as const
export type GmCat = (typeof GM_CATS)[number]

export const GmStore = z.object({
  version: z.literal(GM_VERSION),
  modules: z.array(GmModule).default([]),
  /** 手动移过模块的 GM：条目键 → 模块 id（没移过的按分组第一段归模块） */
  moduleOf: z.record(z.string(), z.string()).default({}),
  objects: z.array(GmObject).default([]),
  /** 对象列表的文件夹（含空的；有对象的文件夹不一定在这里，按对象的 folder 推出来） */
  objFolders: z.array(z.string()).default([]),
  custom: z.array(GmCustom).default([]),
  /**
   * 常用（GM 页左栏「常用」分类、概览「常用」、控制台页的星标、双击 Shift 都读这一份）。
   * 2026-11-22 取代按分类分开的 favs 和没用上的 presets：旧数据按用户说的不处理，读时整段丢掉
   */
  common: z.array(GmFav).default([]),
  /** 常用里的分组（含空的；有条目的分组按条目的 group 推出来） */
  commonGroups: z.array(z.string()).default([]),
  macros: z.array(GmMacro).default([]),
  /** 参数预设（GM 页梳理 F7）：条目键 → 起了名字的几组参数，详情表单上方一点就填好 */
  argPresets: z.record(z.string(), z.array(GmArgPreset)).default({}),
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
