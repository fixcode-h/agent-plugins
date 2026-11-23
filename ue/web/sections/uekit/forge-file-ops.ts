import { BookmarkPlus, CopyPlus, Sparkles } from 'lucide-react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import type { MenuItem } from '@panel/web/src/components/ui/item-menu'
import type { ForgeEntry } from './Forge.tsx'
import { parseDoc } from './forge-doc.ts'

/**
 * 一份配置上的「复制一份…」「让 AI 改…」「存为模板」（用户 2026-11-16 同意的扩展）：
 * 左栏右键和右栏头部 ⋯ 共用，弹窗由页面（Forge.tsx）挂，这里只是一组回调。
 */
export interface ForgeFileOps {
  copy: (e: ForgeEntry) => void
  aiEdit?: (e: ForgeEntry) => void
  saveTemplate: (e: ForgeEntry) => void
}

/**
 * 存为模板：整份原文读出来，加上 template 说明（显示名 = 文件名），放进配置根 _templates/ 下同样的相对路径。
 * UEKit 扫描配置时跳过 `_` 开头的目录，模板不会被当成配置导入。已有同名模板不覆盖。
 */
export async function saveAsTemplate(project: string, configRoot: string, e: ForgeEntry) {
  const rel = (e.config ?? '').replace(/\\/g, '/')
  try {
    const r = await ppost<{ text: string }>(project, 'ext/forge/read', { root: configRoot, path: rel })
    const p = parseDoc(r.text)
    if (!p.ok) throw new Error(t('读不懂这份配置，先修好再存为模板：{e}', { e: p.error }))
    const name = rel
      .split('/')
      .pop()!
      .replace(/\.json$/i, '')
    const doc = { template: { label: name, desc: t('从 {p} 存的模板', { p: rel }) }, ...p.doc, revision: 0 }
    const out = await ppost<{ path: string }>(project, 'ext/forge/create', {
      root: configRoot,
      path: `_templates/${rel}`,
      text: JSON.stringify(doc, null, 2) + '\n',
    })
    h().toast.success(t('已存为模板：{p}', { p: out.path }))
  } catch (err) {
    h().toast.error((err as Error).message)
  }
}

/** 菜单里的三项（左栏右键、右栏 ⋯ 共用） */
export function fileOpItems(ops: ForgeFileOps | undefined, e: ForgeEntry): MenuItem[] {
  if (!ops || !e.config) return []
  return [
    'sep',
    { label: t('复制一份…'), icon: CopyPlus, onClick: () => ops.copy(e) },
    ...(ops.aiEdit ? [{ label: t('让 AI 改…'), icon: Sparkles, onClick: () => ops.aiEdit!(e) }] : []),
    { label: t('存为模板'), icon: BookmarkPlus, onClick: () => ops.saveTemplate(e) },
  ]
}
