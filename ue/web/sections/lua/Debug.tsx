import { DebugProfile } from './DebugProfile.tsx'
import { DebugSnaps } from './DebugSnaps.tsx'

/**
 * Lua 页「调试」页签（设计稿四.4 的快照点，要 UELink 2.4；性能采样换成去性能页录 trace 的一行入口）：
 * 「持有的已销毁 UObject」2026-11-20 挪进对象页的树（Lua对象页重设计-设计稿）。两块上下排，卡片之间用细线分开（插件里各部分贴边分隔，和别的页一致）。断点不做：桥接在游戏线程上，游戏线程一停桥接也停了
 */
export function LuaDebug() {
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:divide-y ue:divide-line ue:overflow-auto">
      <DebugSnaps />
      <DebugProfile />
    </div>
  )
}
