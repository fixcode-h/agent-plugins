/** 这次工具调用改了哪个资源（forge-guard.ts 用；不带别的依赖，单测直接引） */

/** 对象路径 → 资源包路径；PIE 里的运行时对象（UEDPIE_）和不是资源的路径返回空 */
export function assetPackage(p: unknown) {
  const s = typeof p === 'string' ? p.trim() : ''
  if (!s.startsWith('/') || s.includes('UEDPIE_')) return ''
  return s.split(/[.:]/)[0]
}

/** 这次调用改了哪个资源：只读、演练、Lua 字段、新建都不算 */
export function editedAsset(tool: string, a: Record<string, unknown>) {
  if (a.dryRun) return ''
  if (tool === 'ue_set') return a.lua !== undefined ? '' : assetPackage(a.path)
  if (tool === 'ue_blueprint') return a.action === 'edit' ? assetPackage(a.path) : ''
  if (tool !== 'ue_asset') return ''
  // duplicate 带 row 时是复制行（改了这张表），不带时是复制资源（原资源不变）
  if (a.action === 'duplicate') return a.row ? assetPackage(a.path) : ''
  return ['set', 'add', 'remove', 'rename', 'delete'].includes(String(a.action)) ? assetPackage(a.path) : ''
}
