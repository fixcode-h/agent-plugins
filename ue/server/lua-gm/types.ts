/**
 * Lua GM（设计稿 designs/UE插件优化与扩展-设计稿.md 4.2）：项目的 Lua GM 文件由「扫描脚本」列成 GM 列表。
 * 扫描脚本是 AI 第一次读 GM 文件后总结写出的 .mjs，存在项目里；之后都由脚本扫，不再调 AI。
 */

/** 参数关联的表格列：下拉里按 key 或 label 搜 */
export interface LuaGmBinding {
  /** 表格路径（表格插件 table.list 列出来的写法，相对项目目录） */
  table: string
  /** 填进参数的那一列（一般是 Id） */
  key: string
  /** 名字列：和 key 一起搜、一起显示；不写时下拉里只有 key */
  label?: string
  /** 下拉里多显示的一两列（品质等） */
  extra?: string[]
}

export interface LuaGmParam {
  name: string
  /** 类型：integer / number / string / boolean，其它（table、any…）按 Lua 表达式原样填 */
  type: string
  /** 默认值（Lua 字面量文字），参数留空时用它 */
  default?: string
  desc?: string
  /**
   * 扫描脚本给的关联提示，写成 <表名>.<列名>（例如 Item.Id，来自注释 ---@param itemId integer Item.Id）。
   * 项目 GM 设置里改过的关联（LuaGmConfig.bindings）优先
   */
  table?: string
}

export interface LuaGmItem {
  name: string
  group: string
  desc: string
  params: LuaGmParam[]
  /** 相对项目根的文件路径和行号（从 1 数） */
  file: string
  line: number
  /**
   * 调用写法：{参数名} 换成参数值，{args} 换成全部参数逗号连起来。
   * 不写时是 <name>(参数, …)；GM 挂在表上（GM.AddItem）、要用冒号调用（GMMgr:AddItem）都由脚本写在这里
   */
  call?: string
}

/** 存在项目里的 GM 扫描设置（和资源页收藏同一个存放位置：docs/AgentPanel/UE 或 .agent-panel/ue） */
export interface LuaGmConfig {
  /** GM 文件：相对项目根的路径，可以带 * 和 **（Content/Script/GM/**\/*.lua） */
  files: string[]
  /** 改过的参数关联：键是 <GM 名>.<参数名>；值 null 表示去掉脚本给的关联 */
  bindings: Record<string, LuaGmBinding | null>
}

/** 一次扫描的结果（只在内存里：脚本扫一遍是毫秒级的，面板重启后第一次用到再扫） */
export interface LuaGmScan {
  items: LuaGmItem[]
  /** 扫描用到的 GM 文件（相对项目根） */
  files: string[]
  /** 脚本的位置（绝对路径）和在不在 */
  script: string
  hasScript: boolean
  /** 设置文件的位置 */
  config: string
  /** 脚本跑出错、输出不合格式：原样给页面和 Agent，不退回旧结果 */
  error?: string
  /** 个别条目不合格式被丢掉时的说明（最多几条） */
  warnings: string[]
  scannedAt: string
  ms: number
}
