import { Box, ChevronDown, ChevronRight, Pin, PersonStanding, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, pget, ppost, useAction, useLoad } from '../api.ts'
import { isInstance } from '../CdoNote.tsx'
import { ClassPicker, type ClassOpt } from '../ClassPicker.tsx'
import { CompTree, type Comp } from '../CompTree.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Inspect } from '../Inspect.tsx'
import { Props } from '../Props.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { takePending } from '../pending.ts'
import { Badge, Card, ErrorText, KindBadge, Note, NotRunning, PageHead, useTargetInfo } from '../ui.tsx'

interface Row {
  path: string
  name: string
  class: string
  /** 只看绑了 Lua 的对象时：它的 Lua 模块名 */
  module?: string
  /** 桥接给的分类：instance（活着的实例）、asset（资源、默认值）、class（类本身）；旧桥接没有，按路径猜 */
  kind?: 'instance' | 'asset' | 'class'
  /** 是 Actor（桥接 1.8.0 起）：带编辑器里的显示名、所在关卡、是不是玩家控制的 */
  actor?: boolean
  label?: string
  level?: string
  player?: boolean
}
interface Local {
  recent: string[]
  pinned: { path: string; label: string }[]
}
interface Query {
  cls: ClassOpt
  prefix: string
  lua: boolean
  mod: string
}

/** 搜索结果按「运行时实例 / 资源 / 类」分开：同名的蓝图资源、生成类、实例混在一起分不清该改哪个 */
const KINDS = [
  { id: 'instance', label: () => t('运行时实例'), hint: () => t('正在运行的真实对象，改了马上生效') },
  { id: 'asset', label: () => t('资源'), hint: () => t('资源和默认值，改的是以后新建出来的对象，正在显示的不会变') },
  { id: 'class', label: () => t('类'), hint: () => t('类本身，只能看') },
] as const

function kindOf(r: Row): 'instance' | 'asset' | 'class' {
  if (r.kind) return r.kind
  if (/Class$/.test(r.class)) return 'class'
  if (/^\/(Engine\/Transient|Temp)\b|:PersistentLevel\.|UEDPIE_/.test(r.path)) return 'instance'
  return 'asset'
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
 * Object：先选类（可搜索的下拉，默认 UObject），再按名字前缀在这个类和它的子类里找活着的对象；不做场景树，点搜索才搜。
 * 原来分成「Actor」和「运行时对象」两页，其实是同一件事（Actor 就是类选 Actor），用户 2026-11-11 定合成一页。
 * 选中的是 Actor 时中间多一栏组件树（照 UE 组件面板），其他对象右边直接是属性（UMG 控件带控件树）。
 * 类型是 UObject 时桥接要扫全部对象，限时 50 毫秒，超时只给部分结果并提示选具体的类
 */
export function Objects() {
  const { project, target, sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { cn, ui } = h()
  const [path, comp] = sub.split('|')
  const [cls, setCls] = useState<ClassOpt>(ANY)
  const [prefix, setPrefix] = useState('')
  const [lua, setLua] = useState(false)
  const [mod, setMod] = useState('')
  const [q, setQ] = useState<Query>()
  // 装了 UnLua 的项目：可以只看绑了 Lua 模块的对象、按模块名搜（桥接遍历 UnLua 的对象表，不扫全部 UObject，空条件也能搜）
  const hasLua = !!inst?.lua
  // 对象列表、组件两栏宽度可拖，属性占剩下的、至少留 352px
  const listPane = usePane('objects', '30%', 220)
  const compPane = usePane('actors.comps', '22%', 180)
  const listRef = useRef<HTMLElement>(null)
  const compRef = useRef<HTMLElement>(null)
  const widthOf = (r: { current: HTMLElement | null }) => r.current?.getBoundingClientRect().width ?? 0
  const local = useLoad(() => pget<Local>(project.id, 'local'), [project.id])
  const found = useLoad(() => {
    if (!q) return Promise.resolve(undefined)
    // UObject 不当类名发：桥接拿到类名会把这个类的对象全取出来，UObject 就是几百万个；空类名走它限时的全表扫描
    const c = isAny(q.cls) ? '' : q.cls.path || q.cls.name
    return op<{ items: Row[]; more: boolean; partial?: boolean }>(
      project.id,
      q.lua ? 'lua.objects' : 'objects',
      q.lua ? { class: c, prefix: q.prefix, module: q.mod, limit: 200 } : { class: c, prefix: q.prefix, limit: 200 },
      target,
    )
  }, [q, target.instance, target.world])
  // 选中的是不是 Actor：能读出组件的就是。不是 Actor 时桥接报错，这里当成「没有组件栏」，不显示成错误
  const comps = useLoad(
    () =>
      path
        ? op<{ items: Comp[] }>(project.id, 'components', { path }, target).then(
            (r) => ({ path, items: r.items as Comp[] | null }),
            () => ({ path, items: null }),
          )
        : Promise.resolve(undefined),
    [path, target.instance, target.world],
  )
  const ready = comps.data?.path === path
  const actorItems = ready ? comps.data?.items : null
  // 资源默认值和类默认收起（界面优化第 1 条）：同名的 Default__ 夹在实例中间最容易点错；选中的就在里面、或者没有实例时自动展开
  const [others, setOthers] = useState(false)

  const luaOn = lua && hasLua
  const can = (c: ClassOpt, p: string) => luaOn || !isAny(c) || !!p.trim()
  function search(c = cls, p = prefix) {
    if (!can(c, p)) return
    const pp = p.trim()
    setQ({ cls: c, prefix: pp, lua: luaOn, mod: mod.trim() })
    const key = enc(c, pp)
    const recent = [key, ...(local.data?.recent ?? []).filter((x) => x !== key)].slice(0, 12)
    local.setData({ ...(local.data ?? { pinned: [] }), recent } as Local)
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
  const pinned = local.data?.pinned ?? []
  const isPinned = pinned.some((p) => p.path === path)
  const togglePin = () => {
    const next = isPinned
      ? pinned.filter((p) => p.path !== path)
      : [...pinned, { path, label: path.split(/[.:]/).pop() ?? path }]
    local.setData({ ...(local.data ?? { recent: [] }), pinned: next } as Local)
    void ppost(project.id, 'local', { pinned: next })
  }

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
        go('objects', p)
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
  const onOpen = (p: string) => go(p.startsWith('/Game') ? 'assets' : 'objects', p)

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title="Object" desc={t('选类，再按名字前缀搜索；不列场景树')}>
        {path && (
          <ui.Button size="sm" variant="secondary" onClick={togglePin}>
            {isPinned ? <X className="ue:h-3.5 ue:w-3.5" /> : <Pin className="ue:h-3.5 ue:w-3.5" />}
            {isPinned ? t('取消固定') : t('固定这个对象')}
          </ui.Button>
        )}
        <ui.Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void found.reload()
            void comps.reload()
          }}
        >
          <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
        </ui.Button>
      </PageHead>
      {!inst ? (
        <NotRunning icon={Box} what={t('对象要在运行中的编辑器或游戏里找；资源在「资源」里看。')} />
      ) : (
        <div className={SPLIT_ROW}>
          <Card
            ref={listRef}
            className={PANE_FIXED}
            style={listPane.style(actorItems ? `calc(100% - ${compPane.size} - 352px)` : 'calc(100% - 376px)')}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
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
                load={(s) =>
                  s
                    ? op<{ items: { name: string; path: string; parent?: string }[] }>(
                        project.id,
                        'classes',
                        { q: s, limit: 50 },
                        target,
                      ).then((r) =>
                        r.items
                          .filter((c) => c.name !== 'Object')
                          .map((c) => ({ name: c.name, path: c.path, note: c.parent })),
                      )
                    : Promise.resolve([])
                }
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
              {(() => {
                const items = found.data?.items ?? []
                const inst = items.filter((o) => kindOf(o) === 'instance')
                const rest = items.filter((o) => kindOf(o) !== 'instance')
                const nAsset = rest.filter((o) => kindOf(o) === 'asset').length
                const show = others || !inst.length || rest.some((o) => o.path === path)
                const row = (o: Row) => (
                  <li key={o.path}>
                    <button
                      type="button"
                      onClick={() => go('objects', o.path)}
                      title={o.path}
                      className={cn(
                        'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                        path === o.path && 'ue:bg-sel',
                      )}
                    >
                      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
                        {o.actor && <PersonStanding className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />}
                        <span className="ue:truncate ue:text-body ue:text-fg">{o.label || o.name}</span>
                        {o.module && <Badge tone="accent">{o.module}</Badge>}
                        {o.player && <span className="ue:ml-auto ue:text-caption ue:text-subtle">{t('玩家')}</span>}
                      </span>
                      <span className="ue:truncate ue:text-caption ue:text-subtle">
                        {o.class} · {o.actor && o.level ? o.level : o.path}
                      </span>
                    </button>
                  </li>
                )
                const head = (id: (typeof KINDS)[number]['id'], n: number) => {
                  const k = KINDS.find((x) => x.id === id)!
                  return (
                    <div className="ue:flex ue:items-center ue:gap-2 ue:px-2.5 ue:pt-1.5 ue:pb-1" title={k.hint()}>
                      <KindBadge kind={id} />
                      <span className="ue:truncate ue:text-caption ue:text-subtle">
                        {n} · {k.hint()}
                      </span>
                    </div>
                  )
                }
                return (
                  <>
                    {inst.length > 0 && (
                      <section className="ue:mb-2">
                        {head('instance', inst.length)}
                        <ul>{inst.map(row)}</ul>
                      </section>
                    )}
                    {rest.length > 0 && inst.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOthers((v) => !v)}
                        aria-expanded={show}
                        className="ue:mx-1 ue:mb-2 ue:flex ue:w-[calc(100%-0.5rem)] ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-dashed ue:border-line-strong ue:px-2.5 ue:py-2 ue:text-left ue:hover:bg-hover"
                      >
                        {show ? (
                          <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                        ) : (
                          <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                        )}
                        <span className="ue:min-w-0">
                          <span className="ue:block ue:text-footnote ue:text-fg">
                            {t('资源和默认值 {a} · 类 {c}', { a: nAsset, c: rest.length - nAsset })}
                          </span>
                          <span className="ue:block ue:text-caption ue:text-subtle">
                            {t('改的是以后新建的对象，正在跑的不会变')}
                          </span>
                        </span>
                      </button>
                    )}
                    {show &&
                      (['asset', 'class'] as const).map((id) => {
                        const rows = rest.filter((o) => kindOf(o) === id)
                        return rows.length ? (
                          <section key={id} className="ue:mb-2">
                            {head(id, rows.length)}
                            <ul>{rows.map(row)}</ul>
                          </section>
                        ) : null
                      })}
                  </>
                )
              })()}
              {found.data && !found.data.items.length && (
                <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">{t('没有找到')}</p>
              )}
              {!q && (
                <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                  {t('选类、输入名字开头点「搜索」；不列全部对象')}
                </p>
              )}
            </div>
            {(!!pinned.length || !!local.data?.recent.length) && (
              <div className="ue:flex ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:p-3">
                {!!pinned.length && <span className="ue:text-footnote ue:text-subtle">{t('固定的对象')}</span>}
                <div className="ue:flex ue:flex-wrap ue:gap-1.5">
                  {pinned.map((p) => (
                    <button
                      key={p.path}
                      type="button"
                      className={chip}
                      onClick={() => go('objects', p.path)}
                      title={p.path}
                    >
                      <Pin className="ue:h-3 ue:w-3 ue:text-subtle" /> <span className="ue:truncate">{p.label}</span>
                    </button>
                  ))}
                </div>
                {!!local.data?.recent.length && (
                  <span className="ue:text-footnote ue:text-subtle">{t('最近搜过')}</span>
                )}
                <div className="ue:flex ue:flex-wrap ue:gap-1.5">
                  {local.data?.recent.map((r) => (
                    <button key={r} type="button" className={chip} onClick={() => replay(r)}>
                      {r.replace('::', ' · ').replace(/ · $/, '')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <SplitHandle pane={listPane} paneRef={listRef} reserve={() => (actorItems ? widthOf(compRef) + 352 : 376)} />
          {actorItems && (
            <>
              <Card
                ref={compRef}
                className={PANE_FIXED}
                style={compPane.style(`calc(100% - ${listPane.size} - 352px)`)}
                title={t('组件')}
                aside={<span className="ue:max-w-32 ue:truncate">{path.split('.').pop()}</span>}
                bodyClass="ue:overflow-auto"
              >
                <CompTree
                  actor={path}
                  items={actorItems}
                  selected={comp ?? ''}
                  onSelect={(c) => go('objects', c ? `${path}|${c}` : path)}
                />
              </Card>
              <SplitHandle pane={compPane} paneRef={compRef} reserve={() => widthOf(listRef) + 352} />
            </>
          )}
          <Card className={PANE_FILL} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
            {!path ? (
              <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('选中对象后在这里看和改属性')}</p>
            ) : !ready ? (
              // 先等「是不是 Actor」回来再决定布局，免得属性先按两栏读一遍、再换成三栏又读一遍
              <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
            ) : actorItems ? (
              <Props key={comp || path} path={comp || path} onOpen={onOpen} />
            ) : (
              <Inspect key={path} path={path} cdo onOpen={onOpen} />
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
