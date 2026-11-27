/**
 * GameTest 脚本（schemaVersion 3）的数据类型。协议见 UEKit 仓库 docs/game-test-script.md。
 * 这一层只管数据：前端编辑页、流程图、服务端离线校验和 Agent 工具都用它，所以不依赖 node、不依赖面板宿主（没有 t()）。
 */

/** 一步：action 必有，其余字段按动作不同。块（group / if / loop）的子步骤在它的槽里 */
export interface GtStep {
  action: string
  id?: string
  [k: string]: unknown
}

/** 守护：当 when 成立，做 do（协议第 5 节）。可以挂在场景顶层、块上和 _settings.json */
export interface GtGuard {
  id?: string
  name?: string
  when?: unknown
  do?: GtStep[]
  [k: string]: unknown
}

/** 场景文件。v1 / v2 也照这个读（平铺步骤就是只有主流程、没有块的 v3） */
export interface GtScript {
  kind?: string
  schemaVersion?: number
  name?: string
  params?: Record<string, { default?: unknown; type?: string; note?: string }>
  vars?: Record<string, unknown>
  objects?: Record<string, unknown>
  guards?: GtGuard[]
  setup?: GtStep[]
  steps?: GtStep[]
  /** 收尾段（GameTest 2.7.0）：主流程跑完、失败、第一次按停止后都执行 */
  teardown?: GtStep[]
  [k: string]: unknown
}

/**
 * 路径：从场景根到某个值的键序列，和协议里的写法 `steps.3.do.0.then.1` 一一对应。
 * 步骤的路径以数字结尾（在槽里的下标）；槽的路径以槽名结尾（`do`、`then`、`else`）
 */
export type GtPath = (string | number)[]

/** 槽的种类：列表视图按它画「否则 / 否则如果」分隔行，流程图按它分支 */
export type SlotKind = 'steps' | 'setup' | 'teardown' | 'do' | 'then' | 'elif' | 'else'

/** 块里的一个子步骤槽：相对块本身的键路径 */
export interface SlotRef {
  key: GtPath
  kind: SlotKind
  /** 只有 elif 有：第几个「否则如果」 */
  index?: number
}

/** 块里放条件的字段（相对块本身）：if 的 cond、elif[i].cond，loop 的 until / while */
export interface CondRef {
  key: GtPath
  /** 给界面区分的名字 */
  role: 'if' | 'elif' | 'until' | 'while' | 'when' | 'expect' | 'skipIf' | 'cond'
}

/**
 * 一种块或动作（协议第 14 节的注册表）：一种一个文件，数据层只认这里的描述，不按名字写分支。
 * 界面上的名字、图标、编辑器在 web 那边另有一张表（按 action 对上）
 */
export interface BlockDef {
  action: string
  /** 自动补 id 用的前缀：s3、if1、loop2 */
  idPrefix: string
  /** 有子步骤的块返回它的槽（按显示顺序）；叶子动作不写 */
  slots?: (step: GtStep) => SlotRef[]
  /** 包成块时放进哪个槽（Ctrl+G、右键「包进如果 / 循环」） */
  wrapSlot?: GtPath
  /** 条件字段 */
  conds?: (step: GtStep) => CondRef[]
  /** 新建时的骨架（插入菜单） */
  make: () => GtStep
  /**
   * 蓝图画布上画成子图节点：包着一整段流程（段、调用另一个脚本），双击进去看里面。
   * 不写的块（如果、循环）在画布上直接摊开，子槽（是 / 否 / 每轮）是普通出口连线（用户 2026-11-19）
   */
  subgraph?: boolean
}
