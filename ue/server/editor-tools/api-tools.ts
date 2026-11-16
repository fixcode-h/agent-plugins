import type { OpCtx } from '../ops.ts'
import { configView } from './config.ts'
import { diagnose } from './diagnose.ts'
import { fixRedirectors, listRedirectors } from './redirectors.ts'
import { listTags, tagRefs } from './tags.ts'

/**
 * 编辑器小工具的接口（挂在 /api/plugins/ue/p/<项目>/tools/ 下）：UELink 卡片的连接诊断、配置和 GameplayTag 页、
 * 资源页的修复重定向器。读写 UE 的部分都走 runOp（ops.ts 按操作分权限、记操作记录）。
 */
type Body = Record<string, unknown>
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))

export async function toolsRoute(ctx: OpCtx, route: string, b: Body): Promise<Body | undefined> {
  switch (route) {
    case 'GET tools/diagnose':
      return diagnose(ctx.project)
    case 'POST tools/config':
      return configView(ctx, {
        file: s(b.file) || undefined,
        section: s(b.section) || undefined,
        key: s(b.key) || undefined,
        filter: s(b.filter) || undefined,
        query: s(b.query) || undefined,
      })
    case 'POST tools/tags':
      return listTags(ctx, s(b.filter))
    case 'POST tools/tags/refs':
      return tagRefs(ctx, s(b.tag))
    case 'POST tools/redirectors':
      return { ...(await listRedirectors(ctx, s(b.path))) }
    case 'POST tools/redirectors/fix':
      return fixRedirectors(ctx, s(b.path))
    default:
      return undefined
  }
}
