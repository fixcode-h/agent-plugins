// 对象库 objects.json：从 gm.json 一次性搬出来、GM 页整份存时拆开写、没改不动文件。
// 用法：node --test ue/server/obj-lib/store.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { gmFile, readGm, writeGm } from '../store.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { objLibFile } from './store.ts'

let base = ''
const proj = (id: string) => ({ id, root: path.join(base, id, 'Game') }) as UeProject
const read = async (f: string) => JSON.parse(await readFile(f, 'utf8')) as Record<string, unknown>

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-objlib-'))
  setCtx({ dataDir: path.join(base, 'data'), t: (zh: string) => zh } as unknown as PluginServerContext)
})

test('gm.json 里的对象列表第一次读时搬进 objects.json，gm.json 里删掉', async () => {
  const p = proj('a')
  const gm = gmFile(p)
  await mkdir(path.dirname(gm), { recursive: true })
  const objects = [{ name: '商店', ref: { class: 'WBP_Shop_C' }, folder: 'UI' }]
  await writeFile(gm, JSON.stringify({ version: 2, macros: [], objects, objFolders: ['UI', '空的'] }))
  const g = await readGm(p)
  assert.deepEqual(g.objects, objects)
  assert.deepEqual(g.objFolders, ['UI', '空的'])
  const lib = await read(objLibFile(p))
  assert.equal(lib.version, 1)
  assert.deepEqual(lib.objects, objects)
  const left = await read(gm)
  assert.equal('objects' in left, false)
  assert.equal('objFolders' in left, false)
  assert.deepEqual(left.macros, [])
})

test('整份存：对象写 objects.json，其余写 gm.json；对象没变时不动 objects.json', async () => {
  const p = proj('b')
  const g = await readGm(p)
  await writeGm(p, { ...g, objects: [{ name: '我', src: '@pawn' }] })
  assert.deepEqual((await read(objLibFile(p))).objects, [{ name: '我', src: '@pawn' }])
  assert.equal('objects' in (await read(gmFile(p))), false)
  const t0 = (await stat(objLibFile(p))).mtimeMs
  await new Promise((r) => setTimeout(r, 20))
  await writeGm(p, { ...(await readGm(p)), macros: [] })
  assert.equal((await stat(objLibFile(p))).mtimeMs, t0)
  assert.deepEqual((await readGm(p)).objects, [{ name: '我', src: '@pawn' }])
})
