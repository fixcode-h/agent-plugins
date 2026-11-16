import { useEffect, useState } from 'react'
import { ppost } from '../../api.ts'
import { t } from '../../host.ts'
import { parseDoc, retarget, templateMeta } from './forge-doc.ts'
import type { ForgeTemplate } from './forge-templates.ts'

/**
 * 项目自己的模板（用户 2026-11-16 同意的扩展）：配置根下 `_templates/` 里的 JSON，格式就是一份普通配置，
 * 可选的 `template: { label, desc }` 写显示名和说明。UEKit 扫描配置时跳过 `_` 开头的目录，模板不会被当成配置导入。
 * 生成时换掉 asset（根节点名和模板资产同名时一起换），去掉 template、修订号归零。右键配置「存为模板」会往这里放一份。
 */
export function useProjectTemplates(project: string, configRoot: string) {
  const [list, setList] = useState<ForgeTemplate[]>([])
  useEffect(() => {
    if (!configRoot) return
    let live = true
    ppost<{ templates: { path: string; text?: string; error?: string }[] }>(project, 'ext/forge/templates', {
      root: configRoot,
    })
      .then((r) => live && setList(r.templates.map(toTemplate)))
      .catch(() => live && setList([]))
    return () => {
      live = false
    }
  }, [project, configRoot])
  return list
}

function toTemplate(f: { path: string; text?: string; error?: string }): ForgeTemplate {
  const file = f.path
    .split('/')
    .pop()!
    .replace(/\.json$/i, '')
  const p = f.text !== undefined ? parseDoc(f.text) : undefined
  const doc = p?.ok ? p.doc : undefined
  const meta: { label?: string; desc?: string } = doc ? templateMeta(doc) : {}
  const kind = typeof doc?.kind === 'string' ? doc.kind : ''
  return {
    id: `project:${f.path}`,
    kind,
    source: f.path,
    bad: f.error ?? (p && !p.ok ? p.error : !kind ? t('没写 kind') : undefined),
    label: () => meta.label ?? file,
    desc: () => meta.desc ?? t('项目模板：{p}', { p: `_templates/${f.path}` }),
    prefix: '',
    build: (asset, name) => retarget(f.text ?? '{}', asset, name),
  }
}
