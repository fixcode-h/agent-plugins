import { useState } from 'react'
import { parseLuaPath, type LuaKey } from '../../../server/luapath.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { LuaTable } from '../../Lua.tsx'
import { Card, ErrorText, SearchBox } from '../../ui.tsx'

/**
 * Lua 页「对象」页签：现在是按路径看全局表里纯 Lua 的单例和管理器（原 Lua 页右半边）。
 * 设计稿四.1 的检视区（左栏单例 / 绑定对象 / 全局表、字段可改、函数可调、元表链、监视）要桥接的 lua.inspect / lua.call，
 * 由 UELink 2.4 那个工作包在这个文件上接着做
 */
export function LuaObjects() {
  const { go } = useUe()
  const [root, setRoot] = useState<{ keys: LuaKey[]; n: number }>({ keys: [], n: 0 })
  const [pathError, setPathError] = useState('')

  const openPath = (s: string) => {
    try {
      setRoot((r) => ({ keys: parseLuaPath(s), n: r.n + 1 }))
      setPathError('')
    } catch (e) {
      setPathError((e as Error).message)
    }
  }

  return (
    <Card
      className="ue:m-4 ue:flex ue:min-h-0 ue:flex-1 ue:flex-col"
      title={t('全局表')}
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      <div className="ue:flex ue:flex-col ue:gap-1 ue:border-b ue:border-line ue:p-3">
        <SearchBox
          placeholder={t('Lua 路径，例如 GameSystemManager 或 package.loaded["Game.Core"]')}
          onSearch={openPath}
          allowEmpty
        />
        <ErrorText>{pathError}</ErrorText>
      </div>
      <LuaTable
        key={root.n}
        path=""
        initial={root.keys}
        onOpen={(p) => go(p.startsWith('/Game') && !p.includes(':') ? 'assets' : 'objects', p)}
      />
    </Card>
  )
}
