/**
 * POST ext/gt/library 的参数（GameTest 场景库整理）。路径都相对场景根、用 / 分隔；root 是场景根（gt.scenarios 的 absoluteRootDir）。
 * - list：全部文件夹
 * - mkdir / create：在 dir 里新建文件夹 / 空白脚本，名字 name
 * - deletePlan / delete：删 path（文件夹或脚本）之前看影响 / 真删
 * - movePlan / move：把 path 移进 toDir，或改名成 name（二选一）；先看要跟着改的 call，确认后一起改
 */
export interface LibArgs {
  root: string
  action: string
  path?: string
  dir?: string
  toDir?: string
  name?: string
}

/** 一种整理动作：一个动作一个处理函数，在 index.ts 的表里登记 */
export type LibHandler = (projectRoot: string, a: LibArgs) => Promise<Record<string, unknown>>
