// Lua 设置（lua/settings.ts）和斜杠开头的模块名找文件（gt-author/lua-files.ts）
// 用法：node --test ue/server/lua/settings.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { moduleFile } from '../uekit/gt-author/lua-files.ts'
import { normalizeLuaSettings } from './settings.ts'

test('Lua 设置：多值按行或逗号拆、去重去空，上限夹住', () => {
  const s = normalizeLuaSettings({
    classFields: 'SubModulePath\n\n SubModulePath ,ClassName',
    roots: ['_G.GameApp', ''],
    nameFields: undefined,
    objectKey: ' Object ',
    maxVisit: 10,
  })
  assert.deepEqual(s.classFields, ['SubModulePath', 'ClassName'])
  assert.deepEqual(s.roots, ['_G.GameApp'])
  assert.deepEqual(s.nameFields, [])
  assert.equal(s.objectKey, 'Object')
  assert.equal(s.maxVisit, 1000)
  assert.equal(normalizeLuaSettings(null).maxVisit, 0)
})

test('模块名斜杠开头（/Module/A/B）按脚本根找文件，不当盘符根', () => {
  const root = path.resolve('/proj/Content/Script')
  assert.equal(moduleFile(root, '/Module/Main/SM_X'), path.join(root, 'Module', 'Main', 'SM_X.lua'))
  assert.equal(moduleFile(root, 'Module.Main.SM_X'), path.join(root, 'Module', 'Main', 'SM_X.lua'))
  assert.throws(() => moduleFile(root, '../outside'))
})
