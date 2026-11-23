import { Search } from 'lucide-react'
import { useClassSearch } from '../../catalog/class-search.ts'
import { useEffect, useState } from 'react'
import { op, pget, ppost, useAction, useLoad } from '../../api.ts'
import { isInstance } from '../../CdoNote.tsx'
import { ClassPicker, type ClassOpt } from '../../ClassPicker.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useGoneFromList, useKept } from '../../keep.ts'
import { takePending } from '../../pending.ts'
import { ErrorText, Note, useTargetInfo } from '../../ui.tsx'
import { ClassResults, type Row } from './ClassResults.tsx'

interface Local {
  recent: string[]
}
interface Query {
  cls: ClassOpt
  prefix: string
  lua: boolean
  mod: string
}

/** 默认的类型：所有对象。UE 里这个类叫 Object，界面上照大家的叫法写 UObject */
const ANY: ClassOpt = { name: 'UObject' }
const isAny = (c: ClassOpt) => c.name === 'UObject' || c.name === 'Object'
/** 类型下拉不打字时列的常用类 */
const COMMON: ClassOpt[] = [
  ANY,
  ...[
    'Actor',
    'Pawn',
    'Character',
    'PlayerController',
    'PlayerState',
    'GameModeBase',
    'GameStateBase',
    'GameInstance',
    'GameInstanceSubsystem',
    'WorldSubsystem',
    'LocalPlayerSubsystem',
    'ActorComponent',
    'UserWidget',
  ].map((name) => ({ name })),
]

/** 一次搜索记成一个字符串（最近搜过、Ctrl+K 带过来的）：「类::名字开头」，类型是 UObject 时只有名字开头 */
const enc = (c: ClassOpt, prefix: string) => (isAny(c) ? prefix : `${c.name}::${prefix}`)
function dec(s: string): { cls: ClassOpt; prefix: string } {
  const i = s.indexOf('::')
  return i < 0 ? { cls: ANY, prefix: s } : { cls: { name: s.slice(0, i) }, prefix: s.slice(i + 2) }
}

/**
 * 对象页浏览栏的「按类搜」（原来 Object 页的搜索，用户 2026-11-11 定）：先选类（可搜索的下拉，默认 UObject），
 * 再按名字前缀在这个类和它的子类里找；「我的角色」这些快捷按钮直接打开；结果按「运行时实例 / 资源 / 类」分组；
 * 底部「最近搜过」。类型是 UObject 时桥接要扫全部对象，限时 50 毫秒，超时只给部分结果并提示选具体的类
 */
export function ClassSearch({ selected, onOpen }: { selected: string; onOpen: (path: string) => void }) {
  const { project, target, go } = useUe()
  const { inst } = useTargetInfo()
  const { ui } = h()
  // 搜索条件、结果切页面时留着（keep.ts）
  const kk = `${project.id}/objects`
  // 打字搜类走本地类索引（catalog/，和 GameTest 选类同一份）：马上出结果、UE 没开也能选；索引还没到时才问 UE
  const loadClasses = useClassSearch(project.id, {
    fallback: (s) =>
      op<{ items: { name: string; path: string; parent?: string }[] }>(
        project.id,
        'classes',
        { q: s, limit: 50 },
        target,
      ).then((r) =>
        r.items.filter((c) => c.name !== 'Object').map((c) => ({ name: c.name, path: c.path, note: c.parent })),
      ),
  })
  const [cls, setCls] = useKept<ClassOpt>(`${kk}/cls`, ANY)
  const [prefix, setPrefix] = useKept(`${kk}/prefix`, '')
  const [lua, setLua] = useKept(`${kk}/lua`, false)
  const [mod, setMod] = useKept(`${kk}/mod`, '')
  const [q, setQ] = useKept<Query | undefined>(`${kk}/q`, undefined)
  // 装了 UnLua 的项目：可以只看绑了 Lua 模块的对象、按模块名搜（桥接遍历 UnLua 的对象表，不扫全部 UObject，空条件也能搜）
  const hasLua = !!inst?.lua
  const local = useLoad(() => pget<Local>(project.id, 'local'), [project.id])
  const found = useLoad(
    () => {
      if (!q) return Promise.resolve(undefined)
      // UObject 不当类名发：桥接拿到类名会把这个类的对象全取出来，UObject 就是几百万个；空类名走它限时的全表扫描
      const c = isAny(q.cls) ? '' : q.cls.path || q.cls.name
      return op<{ items: Row[]; more: boolean; partial?: boolean }>(
        project.id,
        q.lua ? 'lua.objects' : 'objects',
        q.lua ? { class: c, prefix: q.prefix, module: q.mod, limit: 200 } : { class: c, prefix: q.prefix, limit: 200 },
        target,
      )
    },
    [q, target.instance, target.world],
    0,
    `${kk}/found`,
  )
  useGoneFromList(found.data?.items, q, selected, () => go('objects'))
  // 资源默认值和类默认收起（界面优化第 1 条）：同名的 Default__ 夹在实例中间最容易点错；选中的就在里面、或者没有实例时自动展开
  const [others, setOthers] = useKept(`${kk}/others`, false)

  const luaOn = lua && hasLua
  const can = (c: ClassOpt, p: string) => luaOn || !isAny(c) || !!p.trim()
  function search(c = cls, p = prefix) {
    if (!can(c, p)) return
    const pp = p.trim()
    setQ({ cls: c, prefix: pp, lua: luaOn, mod: mod.trim() })
    const key = enc(c, pp)
    const recent = [key, ...(local.data?.recent ?? []).filter((x) => x !== key)].slice(0, 12)
    local.setData({ ...local.data, recent })
    void ppost(project.id, 'local', { recent })
  }
  /** 最近搜过、Ctrl+K 带过来的：把类和名字填回去再搜 */
  const replay = (s: string) => {
    const r = dec(s)
    setCls(r.cls)
    setPrefix(r.prefix)
    search(r.cls, r.prefix)
  }
  useEffect(() => {
    const p = takePending('objects')
    if (p) replay(p)
    // 只在进来时取一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 常去的几个对象一键打开（界面优化第 9 条）：和上面选的类无关，直接按固定的类找目标世界里的实例并打开，
  // 「我的角色」再读控制器的 Pawn。不动类型和搜索框：点它是「去看那个对象」，不是换搜索条件
  const quickRun = useAction()
  const [quickErr, setQuickErr] = useState('')
  const quick = (key: string, c: string, prop?: string) => () =>
    quickRun.run(key, async () => {
      setQuickErr('')
      try {
        const r = await op<{ items: Row[] }>(project.id, 'objects', { class: c, prefix: '', limit: 20 }, target)
        const hit = r.items.find(isInstance)
        if (!hit) throw new Error(t('目标世界里没有 {c}，游戏开始（PIE）后才有', { c }))
        let p = hit.path
        if (prop) {
          const v = await op<{ value: unknown }>(project.id, 'get', { path: p, prop }, target)
          if (typeof v.value !== 'string' || !v.value || v.value === 'None')
            throw new Error(t('玩家控制器现在没有控制角色'))
          p = v.value
        }
        onOpen(p)
      } catch (e) {
        setQuickErr((e as Error).message)
      }
    })
  const quicks = [
    { key: 'pawn', label: t('我的角色'), run: quick('pawn', 'PlayerController', 'Pawn') },
    { key: 'pc', label: t('玩家控制器'), run: quick('pc', 'PlayerController') },
    { key: 'gs', label: 'GameState', run: quick('gs', 'GameStateBase') },
    { key: 'gm', label: 'GameMode', run: quick('gm', 'GameModeBase') },
    { key: 'gi', label: 'GameInstance', run: quick('gi', 'GameInstance') },
  ]
  const chip =
    'ue:flex ue:h-7 ue:max-w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:border-line ue:px-2 ue:font-mono ue:text-footnote ue:text-fg ue:hover:bg-hover'

  return (
    <>
      <form
        className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3"
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
      >
        <ClassPicker
          value={isAny(cls) ? ANY : cls}
          common={COMMON}
          placeholder={t('搜类名，例如 Character、MyInventorySubsystem')}
          load={loadClasses}
          onChange={(c) => {
            setCls(c)
            // 换了类就按现在的名字开头重搜：下面的搜索始终是「在这个类里」
            search(c, prefix)
          }}
        />
        <div className="ue:flex ue:items-center ue:gap-2">
          <label className="ue:flex ue:h-8 ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-line-strong ue:bg-field ue:px-2.5 ue:focus-within:border-focus">
            <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder={isAny(cls) ? t('名字开头，例如 BP_Hero') : t('名字开头（可选）')}
              aria-label={t('名字开头')}
              className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle"
            />
            <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('前缀')}</span>
          </label>
          <ui.Button size="sm" variant="secondary" type="submit" disabled={found.loading || !can(cls, prefix)}>
            {t('搜索')}
          </ui.Button>
        </div>
        {hasLua && (
          <div className="ue:flex ue:items-center ue:gap-2">
            <label className="ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-muted">
              <input
                type="checkbox"
                checked={lua}
                onChange={(e) => setLua(e.target.checked)}
                className="ue:accent-accent"
              />
              {t('只看绑了 Lua 的')}
            </label>
            {lua && (
              <ui.Input
                size="sm"
                className="ue:flex-1"
                value={mod}
                placeholder={t('Lua 模块名包含（可选）')}
                onChange={(e: { target: { value: string } }) => setMod(e.target.value)}
              />
            )}
          </div>
        )}
        <div className="ue:flex ue:flex-wrap ue:gap-1">
          {quicks.map((x) => (
            <button
              key={x.key}
              type="button"
              disabled={!!quickRun.busy}
              onClick={() => void x.run()}
              className="ue:h-6 ue:cursor-pointer ue:rounded-md ue:border ue:border-line ue:px-2 ue:text-footnote ue:text-muted ue:hover:bg-hover ue:hover:text-fg ue:disabled:opacity-50"
            >
              {quickRun.busy === x.key ? t('找…') : x.label}
            </button>
          ))}
        </div>
        <ErrorText>{quickErr}</ErrorText>
        <ErrorText>{found.error}</ErrorText>
        {found.data?.partial && (
          <Note>{t('类型是 UObject 时对象太多，只搜了一部分。在上面选具体的类搜得更快也更全。')}</Note>
        )}
        {found.data && (
          <span className="ue:text-footnote ue:text-subtle">
            {found.data.more
              ? t('超过 {n} 个，只列前 {n} 个，再多输几个字', { n: found.data.items.length })
              : t('{c} 里找到 {n} 个', {
                  c: q && !isAny(q.cls) ? q.cls.name : 'UObject',
                  n: found.data.items.length,
                })}
          </span>
        )}
      </form>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
        <ClassResults
          items={found.data?.items ?? []}
          selected={selected}
          onOpen={onOpen}
          others={others}
          onOthers={() => setOthers((v) => !v)}
        />
        {found.data && !found.data.items.length && (
          <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">{t('没有找到')}</p>
        )}
        {!q && (
          <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
            {t('选类、输入名字开头点「搜索」；不列全部对象')}
          </p>
        )}
      </div>
      {!!local.data?.recent.length && (
        <div className="ue:flex ue:shrink-0 ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:p-3">
          <span className="ue:text-footnote ue:text-subtle">{t('最近搜过')}</span>
          <div className="ue:flex ue:flex-wrap ue:gap-1.5">
            {local.data.recent.map((r) => (
              <button key={r} type="button" className={chip} onClick={() => replay(r)}>
                {r.replace('::', ' · ').replace(/ · $/, '')}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
