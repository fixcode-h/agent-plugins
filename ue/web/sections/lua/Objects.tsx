import { useState } from 'react'
import { parseLuaPath, type LuaKey } from '../../../server/luapath.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { LuaTable } from '../../Lua.tsx'
import { Card, ErrorText, SearchBox } from '../../ui.tsx'
import { rootKey, type LuaRoot } from './inspect-data.ts'
import { LuaInspector } from './Inspector.tsx'
import { useLuaOp } from './lua-data.ts'
import { LuaObjectsNav } from './ObjectsNav.tsx'

/**
 * Lua 页「对象」页签（设计稿「UE 插件优化与扩展」四.1、效果图 3）：左栏挑对象（全局单例 / 绑定对象 / 模块、按路径跳、监视），
 * 右边检视区看字段、函数、upvalue、元表链，字段可改、函数可调。
 * 进程的 UELink 早于 2.4（没有 lua.inspect）时退回原来的「按路径看全局表」
 */
export function LuaObjects() {
  const ok = useLuaOp('lua.inspect')
  return ok ? <Inspect /> : <LegacyGlobals />
}

function Inspect() {
  const { project, go } = useUe()
  const kk = `${project.id}/lua`
  const [root, setRoot] = useKept<LuaRoot>(`${kk}/inspRoot`, { path: '', keys: [] })
  const [watch, setWatch] = useKept<LuaRoot[]>(`${kk}/watch`, [])
  // 改字段、调函数之后加一，检视区和监视都重读
  const [tick, setTick] = useState(0)
  const bump = () => setTick((n) => n + 1)
  const openObj = (p: string) => go(p.startsWith('/Game') && !p.includes(':') ? 'assets' : 'objects', p)
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:bg-card">
      <LuaObjectsNav
        current={root}
        tick={tick}
        watch={watch}
        onPick={setRoot}
        onUnwatch={(r) => setWatch((w) => w.filter((x) => rootKey(x) !== rootKey(r)))}
      />
      <LuaInspector
        root={root}
        tick={tick}
        onNav={(keys: LuaKey[]) => setRoot({ ...root, keys })}
        onOpenObj={openObj}
        onWatch={(r) => setWatch((w) => (w.some((x) => rootKey(x) === rootKey(r)) ? w : [...w, r].slice(-30)))}
        onChanged={bump}
      />
    </div>
  )
}

/** 旧 UELink（2.3 及以前）：只能按路径看全局表、改标量 */
function LegacyGlobals() {
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
        <p className="ue:text-caption ue:text-subtle">
          {t('把项目里的 UELink 升到 2.4 以上，这里能看函数、调函数、看元表链和加监视')}
        </p>
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
