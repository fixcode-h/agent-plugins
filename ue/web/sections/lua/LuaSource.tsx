import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { SrcLink } from './DebugViews.tsx'
import { useOpenLua } from './open-file.ts'

interface Src {
  module: string
  file?: string
  line?: number
}

/**
 * 对象属性面板「Lua」页签顶上的一行（设计稿四.4「从对象跳到文件」）：绑了 Lua 的对象直接给模块文件和行号，点了用编辑器打开。
 * UELink 2.4 有 lua.inspect：取自己或元表链上第一个 Lua 函数的定义位置（文件 + 行）；旧桥接只有 lua.get 的模块名，
 * 按模块名在 Content/Script 下拼文件（行号没有）
 */
async function loadSrc(project: string, path: string, target: Parameters<typeof op>[3]): Promise<Src | null> {
  try {
    const r = await op<{
      chain?: { name?: string }[]
      functions?: { file?: string; line?: number }[]
    }>(project, 'lua.inspect', { path, limit: 1 }, target)
    const fn = (r.functions ?? []).find((f) => f.file)
    const module = (r.chain ?? []).find((c) => c.name)?.name ?? ''
    if (fn?.file || module) return { module, file: fn?.file ?? module, line: fn?.line }
    return null
  } catch {
    // 旧桥接没有 lua.inspect（或对象没进过 Lua）：退回 lua.get 的模块名
  }
  const g = await op<{ object?: { module?: string } }>(project, 'lua.get', { path, keys: [], limit: 1 }, target)
  const module = g.object?.module ?? ''
  return module ? { module, file: module } : null
}

export function LuaSource({ path }: { path: string }) {
  const { project, target } = useUe()
  const open = useOpenLua()
  const src = useLoad(() => loadSrc(project.id, path, target), [path, target.instance, target.world])
  if (!src.data) return null
  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-footnote">
      <span className="ue:shrink-0 ue:text-subtle">{t('Lua 模块')}</span>
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{src.data.module || '—'}</span>
      {src.data.file && (
        <span className="ue:ml-auto ue:min-w-0">
          <SrcLink file={src.data.file} src={src.data.file} line={src.data.line} onOpen={open} />
        </span>
      )}
    </div>
  )
}
