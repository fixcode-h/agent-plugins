import { Cpu, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Inspect } from '../Inspect.tsx'
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

/** 常用的运行时对象：点一下按类搜 */
const QUICK = [
  'GameInstance',
  'GameStateBase',
  'PlayerController',
  'GameModeBase',
  'PlayerState',
  'GameInstanceSubsystem',
  'WorldSubsystem',
]

/**
 * 运行时对象：按类名和名字前缀找活着的 UObject（子系统、GameInstance、GameState…），右边看和改属性。
 * 不写类名时桥接要扫全部对象，限时 50 毫秒，超时只给部分结果并提示加类名
 */
export function Objects() {
  const { project, target, sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { cn, ui } = h()
  const [cls, setCls] = useState('')
  const [prefix, setPrefix] = useState('')
  const [lua, setLua] = useState(false)
  const [mod, setMod] = useState('')
  const [q, setQ] = useState<{ cls: string; prefix: string; lua: boolean; mod: string }>()
  // 装了 UnLua 的项目：可以只看绑了 Lua 模块的对象、按模块名搜（桥接遍历 UnLua 的对象表，不扫全部 UObject，空条件也能搜）
  const hasLua = !!inst?.lua
  // 左边对象列表的宽度可拖；右边属性表至少留 360px
  const pane = usePane('objects', '36%', 240)
  const left = useRef<HTMLElement>(null)
  const found = useLoad(
    () =>
      q
        ? op<{ items: Row[]; more: boolean; partial?: boolean; bound?: number }>(
            project.id,
            q.lua ? 'lua.objects' : 'objects',
            q.lua
              ? { class: q.cls, prefix: q.prefix, module: q.mod, limit: 200 }
              : { class: q.cls, prefix: q.prefix, limit: 200 },
            target,
          )
        : Promise.resolve(undefined),
    [q, target.instance],
  )
  // 资源默认值和类默认收起（界面优化第 1 条）：同名的 Default__ 夹在实例中间最容易点错；选中的就在里面、或者没有实例时自动展开
  const [others, setOthers] = useState(false)
  // Ctrl+K 带过来的类名：进来就搜
  useEffect(() => {
    const p = takePending('objects')
    if (p) {
      setCls(p)
      setQ({ cls: p, prefix: '', lua: false, mod: '' })
    }
  }, [])
  const luaOn = lua && hasLua
  const canSearch = luaOn || !!cls.trim() || !!prefix.trim()
  const search = (c = cls, p = prefix) => {
    if (luaOn || c.trim() || p.trim()) setQ({ cls: c.trim(), prefix: p.trim(), lua: luaOn, mod: mod.trim() })
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('运行时对象')}
        desc={t('按类和名字找活着的 UObject：子系统、GameInstance、GameState、单例管理器…')}
      ></PageHead>
      {!inst ? (
        <NotRunning icon={Cpu} what={t('运行时对象要在运行中的编辑器或游戏里找；资源在「资源」里看。')} />
      ) : (
        <div className={SPLIT_ROW}>
          <Card
            ref={left}
            className={PANE_FIXED}
            style={pane.style('calc(100% - 376px)')}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
            <form
              className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3"
              onSubmit={(e) => {
                e.preventDefault()
                search()
              }}
            >
              <ui.Input
                size="sm"
                value={cls}
                placeholder={t('类名，例如 MyInventorySubsystem')}
                onChange={(e: { target: { value: string } }) => setCls(e.target.value)}
              />
              <div className="ue:flex ue:gap-2">
                <ui.Input
                  size="sm"
                  className="ue:flex-1"
                  value={prefix}
                  placeholder={t('名字开头（可选）')}
                  onChange={(e: { target: { value: string } }) => setPrefix(e.target.value)}
                />
                <ui.Button size="sm" variant="secondary" type="submit" disabled={found.loading || !canSearch}>
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
                {QUICK.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCls(c)
                      search(c, prefix)
                    }}
                    className="ue:h-6 ue:cursor-pointer ue:rounded-md ue:bg-hover ue:px-1.5 ue:font-mono ue:text-caption ue:text-muted ue:hover:text-fg"
                  >
                    {c}
                  </button>
                ))}
              </div>
              <ErrorText>{found.error}</ErrorText>
              {found.data?.partial && (
                <Note>{t('只写了名字没写类名：对象太多，只搜了一部分。加上类名搜得更快也更全。')}</Note>
              )}
              {found.data?.more && (
                <span className="ue:text-footnote ue:text-subtle">
                  {t('超过 {n} 个，只列前 {n} 个', { n: found.data.items.length })}
                </span>
              )}
            </form>
            <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
              {(() => {
                const items = found.data?.items ?? []
                const inst = items.filter((o) => kindOf(o) === 'instance')
                const rest = items.filter((o) => kindOf(o) !== 'instance')
                const nAsset = rest.filter((o) => kindOf(o) === 'asset').length
                const show = others || !inst.length || rest.some((o) => o.path === sub)
                const row = (o: Row) => (
                  <li key={o.path}>
                    <button
                      type="button"
                      onClick={() => go('objects', o.path)}
                      className={cn(
                        'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                        sub === o.path && 'ue:bg-sel',
                      )}
                    >
                      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
                        <span className="ue:truncate ue:text-body ue:text-fg">{o.name}</span>
                        {o.module && <Badge tone="accent">{o.module}</Badge>}
                      </span>
                      <span className="ue:truncate ue:text-caption ue:text-subtle" title={o.path}>
                        {o.class} · {o.path}
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
            </div>
          </Card>
          <SplitHandle pane={pane} paneRef={left} reserve={() => 376} />
          <Card className={PANE_FILL} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
            {sub ? (
              <Inspect key={sub} path={sub} cdo onOpen={(p) => go(p.startsWith('/Game') ? 'assets' : 'objects', p)} />
            ) : (
              <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('选中对象后在这里看和改属性')}</p>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
