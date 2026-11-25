import assert from 'node:assert/strict'
import test from 'node:test'
import type { FindRequest } from '../../sdk/server.ts'
import { ueFindSources } from './find-sources.ts'

const req = (o: Partial<FindRequest>): FindRequest => ({
  kind: 'symbol',
  query: 'X',
  lang: 'cpp',
  limit: 50,
  offset: 0,
  ...o,
})
const by = (id: string) => ueFindSources().find((s) => s.id === id)!

test('UE 的查找路：参数照 UEToVS、lua_code 的形状拼，分页交给面板（要 offset + limit 条）', () => {
  assert.deepEqual(by('uetovs.search_symbols').args(req({ query: 'AActor::Tick', wide: true, offset: 50 })), {
    query: 'AActor::Tick',
    scope: 'all',
    limit: 100,
  })
  assert.equal(by('uetovs.get_file_outline').args(req({ kind: 'outline', query: 'Content/Script/a.lua' })), null)
  assert.deepEqual(
    by('emmylua.lua_code.references').args(req({ kind: 'refs', lang: 'lua', query: 'M:Init', file: 'a.lua', line: 3 })),
    {
      action: 'references',
      query: 'M:Init',
      file: 'a.lua',
      line: 3,
      limit: 50,
    },
  )
  assert.deepEqual(by('emmylua.lua_code.outline').args(req({ kind: 'outline', lang: 'lua', query: 'UI.MainPanel' })), {
    action: 'outline',
    path: 'UI.MainPanel',
    limit: 50,
  })
})

test('UEToVS 引用按文件分组、头文件建议：读成统一的命中，声明排前', () => {
  const refs = by('uetovs.find_references').parse!(
    {
      files: [
        { file: 'D:/P/Source/A.h', hits: [{ line: 3, kind: 'declaration', text: 'void Tick();' }] },
        { file: 'D:/P/Source/B.cpp', hits: [{ line: 9, kind: 'call', text: 'A->Tick();' }] },
      ],
      hasMore: true,
    },
    req({ kind: 'refs' }),
  )
  assert.deepEqual(
    refs.hits.map((h) => [h.file, h.line, h.rank]),
    [
      ['D:/P/Source/A.h', 3, 0],
      ['D:/P/Source/B.cpp', 9, 1],
    ],
  )
  assert.equal(refs.more, true)
  const inc = by('uetovs.suggest_include').parse!(
    {
      header: 'E:/UE/Engine/Source/Runtime/UMG/Public/Blueprint/UserWidget.h',
      include: '#include "Blueprint/UserWidget.h"',
      module: 'UMG',
    },
    req({ kind: 'include' }),
  )
  assert.match(inc.hits[0].text ?? '', /#include "Blueprint\/UserWidget.h"  模块 UMG/)
})
