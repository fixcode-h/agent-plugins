import type { FeishuKind } from '../../../shared/feishu/links.ts'

/**
 * 飞书操作注册表的类型（设计稿：飞书插件 第 3、4 节）。
 * 工具、权限闸、审计都按这张表走：加一个飞书能力就是加一条 OpDef，不另写分支。
 *
 * 级别以 lark-cli 自带的风险分级为基础（read / write / high-risk-write），再加一级 discover：
 * - read：读一篇确定的文档（在范围内直接放行，否则弹卡）
 * - write：改一篇确定的文档（只写在卡上允许过的）
 * - discover：搜索、列举这类看不出是哪篇的（每次弹卡，结果里的文档不自动授权）
 * high-risk-write（删除、改权限、改分享）不进注册表：工具里根本没有
 */
export type OpLevel = 'read' | 'write' | 'discover'

export type OpArgs = Record<string, unknown>

/** 一次调用交给 lark-cli 的参数：args 不含 --as user（执行器统一加），stdin 给大段内容用 */
export interface CliCall {
  args: string[]
  stdin?: string
}

/** 归一后的目标（经 drive +inspect）：url 是 lark-cli 给的规范链接 */
export interface Target {
  kind: string
  token: string
  url: string
  title: string
  /** wiki 节点所在的知识库（信任范围按它判） */
  spaceId?: string
  /** 给的是 wiki 链接时：节点自己的 token（解开前的），列子页面用 */
  nodeToken?: string
}

/** 结果怎么交给 Agent：doc 正文（抽引用、长了写文件）、list 列表（搜索结果，标出没授权的）、json 原样（截短） */
export type OpOutput = 'doc' | 'list' | 'json'

export interface OpDef {
  tool: string
  action: string
  level: OpLevel
  /**
   * 目标参数：Agent 给的链接或 token 在哪个参数里，kind 是裸 token 按什么类型解析；accept 是这个操作认的类型
   * （例如 feishu_doc 只认文档，传了表格链接直接说改用 feishu_sheet）。discover 类可以没有目标（全局搜索）
   */
  target?: { arg: string; kind: FeishuKind; accept: string[]; optional?: boolean }
  /** 给人看的动作名（卡片标题、审计）：「读取文档」 */
  label: () => string
  /** 拼 lark-cli 参数；target 是归一后的目标（没有目标的操作为空） */
  cli: (a: OpArgs, target?: Target) => CliCall
  /** 卡片正文里的摘要：写入改了什么、搜索搜什么 */
  summary?: (a: OpArgs) => string
  /** 写入的差异（卡片上按行上色） */
  diff?: (a: OpArgs) => string
  output: OpOutput
  /** 不走 lark-cli、由插件自己算的操作（feishu_doc links：读一遍正文抽引用） */
  local?: 'links'
  /** 新建文档：结果里的新文档自动进这个对话的可读可写名单 */
  creates?: boolean
}
