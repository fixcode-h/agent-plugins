// 存盘、运行前的脚本展开：注册表在 registry.ts，内置的几种在这里登记（顺序：先生成 run，再带函数库）
import './gm.ts'
import './objdo.ts'
import './luafn.ts'

export { expandDoc, expandInline, expandScriptText, refreshBeforeRun, type ExpandIssue } from './registry.ts'
export { gmLib } from './gm.ts'
