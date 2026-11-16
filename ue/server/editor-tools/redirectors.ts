import { existsSync } from 'node:fs'
import { BridgeError } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { run, t } from '../util.ts'

/**
 * 资源页文件夹右键「修复重定向器」（设计稿「UE 插件优化与扩展」二 P1 资源整理）：先列出来给人看，确认后修。
 * 修复会改写并保存引用方、删掉重定向器文件，所以 P4 项目先把只读的文件签出进默认变更列表，
 * 修完把删掉的重定向器改成「标记删除」（不提交）。只做成页面按钮，不给 Agent（结果主要给人看，准入四问）。
 */
export interface RedirectorItem {
  path: string
  package: string
  file: string
  readOnly: boolean
  target?: string
  broken?: boolean
  referencers: { package: string; file: string; readOnly: boolean }[]
}
interface ListResult {
  path: string
  items: RedirectorItem[]
  total: number
  more?: boolean
}

export async function listRedirectors(ctx: OpCtx, folder: string) {
  return (await runOp(ctx, 'asset.redirectors', { path: folder }, 120000)) as unknown as ListResult
}

async function p4(root: string, args: string[]) {
  const r = await run('p4', ['-d', root, ...args], { cwd: root, timeout: 120000 })
  return r.code === 0 ? '' : (r.err || r.out).trim() || `exit ${r.code}`
}

export async function fixRedirectors(ctx: OpCtx, folder: string) {
  const p = ctx.project
  const list = await listRedirectors(ctx, folder)
  if (!list.items.length) return { fixed: [], left: [], note: t('这个文件夹下没有重定向器') }
  if (list.more) throw new BridgeError(t('重定向器太多（{n} 个），选更小的文件夹分批修', { n: list.total }))

  // P4：只读的引用方和重定向器先签出（签出后才可写，引擎才能保存、删除）
  const opened: string[] = []
  if (p.vcs === 'p4') {
    const files = new Set<string>()
    for (const i of list.items) {
      if (i.readOnly) files.add(i.file)
      for (const r of i.referencers) if (r.readOnly) files.add(r.file)
    }
    if (files.size) {
      const err = await p4(p.root, ['edit', '-c', 'default', ...files])
      if (err) throw new BridgeError(t('P4 签出失败，没有修复：{msg}', { msg: err }))
      opened.push(...files)
    }
  }

  const res = (await runOp(ctx, 'asset.redirectors', { path: folder, fix: true }, 300000)) as {
    fixed?: { package: string; file: string }[]
    left?: { package: string; file: string }[]
    dirtied?: string[]
    note?: string
  }

  // P4：已经从磁盘删掉的重定向器，先撤掉签出（不动本地文件），再标记删除，留在默认变更列表里等你提交
  let p4Note = ''
  if (p.vcs === 'p4') {
    const gone = (res.fixed ?? []).map((f) => f.file).filter((f) => !existsSync(f))
    const wasOpened = gone.filter((f) => opened.includes(f))
    const err =
      (wasOpened.length ? await p4(p.root, ['revert', '-k', ...wasOpened]) : '') ||
      (gone.length ? await p4(p.root, ['delete', '-k', '-c', 'default', ...gone]) : '')
    p4Note = err
      ? t('重定向器已经修好，但 P4 标记删除失败：{msg}', { msg: err })
      : t('改过的文件和删掉的重定向器都在 P4 默认变更列表里，确认后自己提交')
  }
  return { ...res, ...(p4Note && { p4: p4Note }) }
}
