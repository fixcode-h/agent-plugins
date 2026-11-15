/** 版本差异的说明：当前表没变时，分清是改了别的工作表还是整个文件内容都没变 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { revNote } from './history-note'

const A = [
  {
    name: '道具',
    rows: [
      ['id', 'name'],
      ['1', '剑'],
    ],
  },
  { name: '技能', rows: [['id'], ['10']] },
]

test('所有工作表都一样（只差末尾空格子、空行）算完全没变', () => {
  const b = [
    {
      name: '道具',
      rows: [
        ['id', 'name', ''],
        ['1', '剑'],
        ['', ''],
      ],
    },
    { name: '技能', rows: [['id'], ['10']] },
  ]
  assert.deepEqual(revNote(A, b, '道具'), { others: [], allSame: true })
})

test('当前表没变、别的表改了或新加了：列出那些表', () => {
  const b = [A[0], { name: '技能', rows: [['id'], ['11']] }, { name: '新表', rows: [['x']] }]
  assert.deepEqual(revNote(A, b, '道具'), { others: ['技能', '新表'], allSame: false })
})

test('只有当前表变了：没有其他表要提', () => {
  const b = [
    {
      name: '道具',
      rows: [
        ['id', 'name'],
        ['1', '刀'],
      ],
    },
    A[1],
  ]
  assert.deepEqual(revNote(A, b, '道具'), { others: [], allSame: false })
})
