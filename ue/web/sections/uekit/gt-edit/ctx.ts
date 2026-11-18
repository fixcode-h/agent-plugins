import { createContext, useContext } from 'react'
import type { GtScript } from '../../../../shared/gt-script/index.ts'
import type { ApiItem } from '../gt-api/model.ts'

/**
 * 编辑页里各部件共用的上下文：哪个项目、编辑器连没连着（连着才能「现在核对」、抓控件、列代码变量）、
 * 当前场景（补全 $名字）、接口清单（补全、条件里挑接口）。检查器、条件编辑器、表达式框都从这里取，不层层传参
 */
export interface EditCtx {
  project: string
  /** 场景根（相对项目根）：调用脚本挑文件、读 _api.json、_vars.json 用 */
  root: string
  /** 正在编辑的场景（相对场景根）：「转成平铺」另存一份时用 */
  path?: string
  live: boolean
  doc?: GtScript
  apis: ApiItem[]
  /** _vars.json 的常用名 */
  aliases: string[]
}

export const EditContext = createContext<EditCtx>({ project: '', root: '', live: false, apis: [], aliases: [] })

export const useEditCtx = () => useContext(EditContext)
