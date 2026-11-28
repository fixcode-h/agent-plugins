import { expandObjDo } from '../../../shared/gt-script/objdo/expand.ts'
import { registerScriptExpander } from './registry.ts'

// 对象调用（obj.do）：按 ops 生成 run，不用读任何库
registerScriptExpander({
  id: 'obj.do',
  actions: ['obj.do'],
  expand: async (doc) => expandObjDo(doc),
})
