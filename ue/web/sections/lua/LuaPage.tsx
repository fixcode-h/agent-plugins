import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Note, PageHead, useTargetInfo } from '../../ui.tsx'
import { LUA_HEAD_ACTIONS, LUA_TABS } from './tabs.ts'

/**
 * Lua 页（装了 UnLua 的项目才出现）：页签登记在 tabs.ts。地址是 lua/<页签>/<页签自己的子路径>，
 * 子路径给页签用（例如 GM 名、模块名），从 useUe().sub 里去掉第一段再取
 */
export function Lua() {
  const { sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { ui } = h()
  const first = sub.split('/')[0]
  const tab = LUA_TABS.find((x) => x.id === first) ?? LUA_TABS[0]
  const notRunning = !inst
    ? t('UE 没在运行：Lua 环境要在运行中的编辑器或游戏里')
    : !inst.lua
      ? t('这个进程的桥接没有编进 Lua 支持：项目里要有 UnLua，并把桥接更新到 1.1.0 以上后重新编译')
      : ''
  const View = tab.View
  // 页签列表是模块里的常量，每次渲染调用的 hook 个数和次序都一样
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  const badges = LUA_TABS.map((x) => x.useBadge?.())

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title="Lua" desc={t('UnLua 的 Lua 环境：看和改运行中的 Lua 对象、执行代码')}>
        {LUA_HEAD_ACTIONS.map((a) => (
          <a.View key={a.id} />
        ))}
      </PageHead>
      <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
        <ui.Segmented
          size="sm"
          label={t('Lua 页签')}
          value={tab.id}
          onChange={(id: string) => go('lua', id)}
          options={LUA_TABS.map((x, i) => {
            const b = badges[i]
            // 共用的分段控件只收文字：数字拼在名字后面，要紧的（报错）再加提示点
            return {
              id: x.id,
              label: b ? `${x.label()} ${b.text}` : x.label(),
              dot: b?.tone === 'danger' ? b.hint : undefined,
            }
          })}
        />
      </div>
      {inst?.lua && !inst.lua.available && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
          <Note>{inst.lua.error || t('现在拿不到 Lua 环境')}</Note>
        </div>
      )}
      {notRunning && !tab.offline ? (
        <div className="ue:p-6">
          <ui.EmptyPanel>{notRunning}</ui.EmptyPanel>
        </div>
      ) : (
        <View />
      )}
    </div>
  )
}
