import { injectLuaFns } from '../../../shared/gt-script/luafn/inject.ts'
import { readLuaFns } from '../gt-luafn/store.ts'
import { registerScriptExpander } from './registry.ts'

// 脚本函数（luafn）和 Lua 代码节点（lua）：把函数库里用到的函数写进步骤的 lib，GameTest 不读函数库文件
registerScriptExpander({
  id: 'luafn',
  actions: ['luafn', 'lua'],
  expand: async (doc, p) => injectLuaFns(doc, (await readLuaFns(p)).store),
})
