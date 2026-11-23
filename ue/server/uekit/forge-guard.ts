import path from 'node:path'
import type { McpResult } from '../../../sdk/server.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { installedIn } from './catalog.ts'
import { editedAsset } from './forge-edited.ts'
import { withTip } from '../json-result.ts'
import { ueMemo } from '../memo.ts'

/**
 * Agent 用 ue_set / ue_asset / ue_blueprint 直接改了 AssetForge 纳管的资产时，在结果后面提醒一句：
 * 配置是唯一真源，只改资产会和配置对不上，下次导入就被覆盖。只提醒不拦——试数值、临时验证照样能改。
 * 是否纳管问 forge.describe（AssetForge 自己按资产找配置，和页面同一个判据）；没装 AssetForge、问不到时不提醒。
 */

/** 装没装 AssetForge 要扫磁盘：Plugins/ 下的 .uplugin 变了才重扫，盯不住时 30 秒重扫（面板派生缓存，ADR 0074），免得每次改属性都扫 */
const installed = ueMemo<string, boolean>({
  name: 'ue.forge-installed',
  load: async (root) => !!(await installedIn(root, 'AssetForge').catch(() => undefined)),
  ttlMs: 30_000,
  watch: (root) => ({ trees: [path.join(root, 'Plugins')], exts: ['uplugin'] }),
})
const forgeInstalled = (root: string) => installed.get(root)

export async function forgeNotice(tool: string, a: Record<string, unknown>, ctx: OpCtx, r: McpResult) {
  if (r.isError) return r
  const asset = editedAsset(tool, a)
  if (!asset || !(await forgeInstalled(ctx.project.root))) return r
  const d = await runOp(ctx, 'forge.describe', { asset }, 10000).catch(() => undefined)
  const entry = d?.managed ? (d.entry as { config?: string } | undefined) : undefined
  if (!entry) return r
  const gone = tool === 'ue_asset' && (a.action === 'delete' || (a.action === 'rename' && !a.row))
  const tip = gone
    ? `注意：${asset} 由 AssetForge 配置 ${entry.config ?? ''} 管着，改名或删除后配置指向的资产就不在了：同步改配置的 asset 字段，或删掉这份配置。`
    : `注意：${asset} 由 AssetForge 配置 ${entry.config ?? ''} 管着（配置是唯一真源）。只改资产会和配置对不上，下次导入会被覆盖：要保留就改配置再 ue_forge import，或者改完用 ue_forge export 写回配置；只是试数值可以不管。`
  return withTip(r, tip)
}

export const FORGE_GUARDED = new Set(['ue_set', 'ue_asset', 'ue_blueprint'])
