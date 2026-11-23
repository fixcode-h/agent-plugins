// 保存 UE 资源前的 P4 签出计划（p4-checkout.ts）：可写但没打开的也签出，已在 pending 里的不动，库里没有的保存后 add。
// 用法（在 ue/ 下）：node --test server/p4-checkout.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { gameFileOf, p4SavePlan, type P4Exec } from './p4-checkout.ts'

const root = path.resolve('/proj')
const f = (n: string) => path.join(root, 'Content', n)

/** 假 p4：depot 里有哪些文件、哪些已经打开；照 -ztag fstat 的格式答 */
function fake(
  depot: Record<string, { action?: string; headAction?: string; type?: string; have?: number; head?: number }>,
  err = '',
) {
  const calls: string[][] = []
  const exec: P4Exec = async (args) => {
    calls.push(args)
    const out: string[] = []
    const errs: string[] = err ? [err] : []
    for (const a of args.filter((x) => path.isAbsolute(x))) {
      const d = depot[a]
      if (!d) {
        errs.push(`${a} - no such file(s).`)
        continue
      }
      out.push(
        `... clientFile ${a}`,
        `... headAction ${d.headAction ?? 'edit'}`,
        `... headType ${d.type ?? 'binary+l'}`,
      )
      out.push(`... headRev ${d.head ?? 4}`, `... haveRev ${d.have ?? 4}`)
      if (d.action) out.push(`... action ${d.action}`)
    }
    return { code: 0, out: out.join('\n'), err: errs.join('\n') }
  }
  return { exec, calls }
}

test('可写但没打开的资源也签出（以前只签只读的，改动不进变更列表）', async () => {
  const p = fake({ [f('A.uasset')]: {}, [f('B.uasset')]: {} })
  const plan = await p4SavePlan(p.exec, [f('A.uasset'), f('B.uasset')])
  assert.deepEqual(plan, { edit: [f('A.uasset'), f('B.uasset')], add: [], stale: [] })
})

test('已经在某个 pending 里的留在原处；库里没有、库里已删除的保存后 add', async () => {
  const p = fake({ [f('Open.uasset')]: { action: 'edit' }, [f('Gone.uasset')]: { headAction: 'delete' } })
  const plan = await p4SavePlan(p.exec, [f('Open.uasset'), f('Gone.uasset'), f('Local.uasset')])
  assert.deepEqual(plan, { edit: [], add: [f('Gone.uasset'), f('Local.uasset')], stale: [] })
})

test('不在 client 视图里的不管；连不上、没登录原样报错', async () => {
  const out = path.resolve('/elsewhere/X.uasset')
  const view = fake({}, `${out} - file(s) not in client view.`)
  assert.deepEqual(await p4SavePlan(view.exec, [out]), { edit: [], add: [], stale: [] })
  const down: P4Exec = async () => ({ code: 1, out: '', err: 'Perforce password (P4PASSWD) invalid or unset.' })
  assert.match((await p4SavePlan(down, [f('A.uasset')])).error ?? '', /P4PASSWD/)
  assert.deepEqual(await p4SavePlan(down, []), { edit: [], add: [], stale: [] })
})

test('本地落后的二进制资源列出来让调用方先问；落后的文本文件不算（代码不看远端）', async () => {
  const p = fake({
    [f('Old.uasset')]: { have: 2, head: 5 },
    [f('New.uasset')]: { have: 5, head: 5 },
    [f('Cfg.ini')]: { type: 'text', have: 1, head: 3 },
  })
  const plan = await p4SavePlan(p.exec, [f('Old.uasset'), f('New.uasset'), f('Cfg.ini')])
  assert.deepEqual(plan.edit, [f('Old.uasset'), f('New.uasset'), f('Cfg.ini')])
  assert.deepEqual(plan.stale, [{ file: f('Old.uasset'), have: 2, head: 5 }])
  assert.ok(!p.calls.some((c) => c[0] === 'sync'), '不替用户更新')
})

test('/Game 包名换成 Content 下的文件：资源 .uasset、关卡 .umap，插件里的包不管', () => {
  const has = new Set([f('UI/WBP_Bag.uasset'), f('Maps/L1.umap')])
  const ex = (x: string) => has.has(x)
  assert.equal(gameFileOf(root, '/Game/UI/WBP_Bag', ex), f('UI/WBP_Bag.uasset'))
  assert.equal(gameFileOf(root, '/Game/UI/WBP_Bag.WBP_Bag', ex), f('UI/WBP_Bag.uasset'))
  assert.equal(gameFileOf(root, '/Game/Maps/L1', ex), f('Maps/L1.umap'))
  assert.equal(gameFileOf(root, '/MyPlugin/X', ex), undefined)
})
