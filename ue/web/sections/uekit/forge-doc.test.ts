/** 配置文本工具：去注释不碰字符串里的 //，解析出错给行号，换资产时根节点名跟着换 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDoc, retarget, stripComments } from './forge-doc.ts'

test('去掉注释，字符串里的 // 留着，行数不变', () => {
  const src = '{\n  // 注释\n  "a": "http://x", /* 块\n注释 */ "b": 1\n}'
  const out = stripComments(src)
  assert.equal(out.split('\n').length, src.split('\n').length)
  assert.deepEqual(JSON.parse(out), { a: 'http://x', b: 1 })
})

test('解析出错时给出大概的行号', () => {
  const p = parseDoc('{\n  "a": 1,\n  "b": \n}')
  assert.equal(p.ok, false)
  if (!p.ok) assert.ok(p.line && p.line >= 3)
})

test('换资产：asset 换掉、和旧资产同名的根节点名跟着换、去掉模板说明、修订号归零', () => {
  const doc = retarget(
    '{"template":{"label":"x"},"kind":"material","revision":5,"asset":"/Game/M/M_A","root":{"class":"Material","name":"M_A"}}',
    '/Game/M/M_B',
    'M_B',
  ) as Record<string, unknown>
  assert.equal(doc.asset, '/Game/M/M_B')
  assert.equal(doc.revision, 0)
  assert.equal((doc.root as { name: string }).name, 'M_B')
  assert.equal('template' in doc, false)
  // 根节点名和资产名不一样（UMG 的 RootCanvas）：不动
  const umg = retarget('{"asset":"/Game/UI/W","root":{"name":"RootCanvas"}}', '/Game/UI/W2', 'W2') as {
    root: { name: string }
  }
  assert.equal(umg.root.name, 'RootCanvas')
})
