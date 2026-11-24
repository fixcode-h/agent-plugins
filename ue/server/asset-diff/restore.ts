import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileAt } from '@panel/server/exec/vcs-history'
import { BridgeError, liveCards, rpc } from '../instances.ts'
import { p4EditFiles } from '../p4-checkout.ts'
import { runOp } from '../ops.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { assetFile } from './snapshot.ts'

/**
 * 「还原到这一版」（设计稿「UE资源版本差异-修复与强化」3.3）：只有你在页面上点（不做成 Agent 工具）。
 * P4 先签出（进默认变更列表，不提交），用那一版的字节覆盖本地文件，编辑器开着就让它从磁盘重新加载这个资源。
 * 编辑器里这个资源有没保存的改动时先回 dirty，网页确认后带 force 再来（还原会丢掉它们）
 */
export async function restoreAsset(
  project: UeProject,
  pkg: string,
  rev: string,
  force: boolean,
): Promise<{ dirty?: true; restored?: string; reloaded?: boolean }> {
  const file = await assetFile(project.root, pkg)
  const rel = path.relative(project.root, file).replaceAll('\\', '/')
  const editor = (await liveCards(project.root)).find((x) => x.kind === 'editor')
  if (editor && !force) {
    const d = (await rpc(editor, 'asset.dirty', {}).catch(() => ({}))) as { items?: { package: string }[] }
    if ((d.items ?? []).some((i) => i.package === pkg)) return { dirty: true }
  }
  const data = await fileAt(project.root, rel, rev)
  if (!data) throw new BridgeError(t('{rev} 里没有这个资源文件，不能还原到这一版', { rev }))
  if (project.vcs === 'p4') {
    const bad = await p4EditFiles(project.root, [file])
    if (bad) throw new BridgeError(t('P4 签出失败：{msg}', { msg: bad }))
  }
  try {
    await writeFile(file, data)
  } catch (e) {
    throw new BridgeError(t('写不了 {f}：{msg}（文件只读的话先签出）', { f: rel, msg: (e as Error).message }))
  }
  if (!editor) return { restored: rel }
  // 编辑器里加载着这个资源时从磁盘重新加载（没加载的 asset.revert 什么都不做）
  await runOp(
    { project, actor: { kind: 'user' }, target: { instance: editor.pid } },
    'asset.revert',
    { packages: [pkg] },
    120000,
  )
  return { restored: rel, reloaded: true }
}
