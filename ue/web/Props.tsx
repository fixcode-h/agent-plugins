import { ArrowLeft, ChevronDown, ChevronRight, Copy, MessageSquare, Pin, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { op, pget, ppost, show, useAction, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { LuaTable } from './Lua.tsx'
import { Badge, ErrorText, KindBadge, Note, SearchBox, useTargetInfo, worldLabel } from './ui.tsx'
import { useToChat } from './chat.tsx'
import { CdoNote } from './CdoNote.tsx'
import { Functions } from './Functions.tsx'
import { ValueEdit, VecEdit, vecKeys } from './PropValue.tsx'
import type { World } from '../server/types.ts'

export interface Prop {
  name: string
  type: string
  category?: string
  tooltip?: string
  replicated?: boolean
  readOnly?: boolean
  /** 不能改的原因（桥接给的：EditConst、内部状态、只能在默认值 / 实例上改…） */
  readOnlyWhy?: string
  enum?: string[]
  value: unknown
}

/** 这次在网页上改过的值（对象路径 + 属性 → 原值），换分区也保留，高亮「原 80」 */
const changed = new Map<string, unknown>()

/** 和服务端 isRuntimePath 一样：关卡里的、PIE 的、临时包里的对象（资源没有 Lua 实例） */
const isRuntimePath = (p: string) =>
  !p.startsWith('/') || /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/i.test(p)

const looksLikePath = (s: string) => /^\/(Game|Script|Engine|Temp)\/|:PersistentLevel\./.test(s)

/** 分类菜单的名字：UE 的 Category 用 | 分层（Appearance|Brush），菜单按第一层分，第二层在菜单里分小节 */
function splitCategory(c: string | undefined) {
  const [top, ...rest] = (c || t('其他')).split('|').map((x) => x.trim())
  return { top: top || t('其他'), sub: rest.join(' · ') }
}

/**
 * 属性面板（图 4 右栏）：按 Category 分菜单，一次只看一个分类（用户 2026-11-10 定：不要全堆在一起；搜索时跨分类列出），改值、改过的高亮原值、同步属性在客户端改时提示切服务器、
 * 对象引用可点跳转、固定到监视、复制路径；旁边「函数」页签列出能调的函数。
 * 性能：属性列表一次取（大的值是摘要，展开时按路径单独取全量），按名字筛选点「搜索」才发请求
 */
export function Props({
  path: root,
  title,
  onOpen,
  readOnlyHint,
  cdo,
  viewOnly,
}: {
  path: string
  title?: string
  onOpen?: (path: string) => void
  readOnlyHint?: string
  /** 运行时对象页：选到资源默认值（Default__）时醒目提示，给「改运行中的实例」（界面优化第 2 条） */
  cdo?: boolean
  /** 只看不改（对话里点 .uasset 弹出的查看窗口，那里没有保存、放弃改动的地方）：不出改值、函数、固定到监视 */
  viewOnly?: boolean
}) {
  const { project, target, setTarget } = useUe()
  // 面包屑：在面板里点运行时对象的引用，就在这里往下看，← 回到上一个（以前跳到别的页回不来，界面优化第 8 条）
  const [trail, setTrail] = useState<string[]>([])
  const path = trail.at(-1) ?? root
  const chat = useToChat()
  const { inst, world } = useTargetInfo()
  const { ui, cn, toast } = h()
  const [tab, setTab] = useState<'props' | 'fns' | 'lua'>('props')
  // 装了 UnLua 的项目（桥接编进了 Lua 支持）：运行时对象多一个「Lua」页签看它的 Lua 实例表
  const hasLua = !!inst?.lua && isRuntimePath(path)
  const [filter, setFilter] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [full, setFull] = useState<Record<string, unknown>>({})
  const [warn, setWarn] = useState('')
  const [menu, setMenu] = useState('')
  const { busy, run } = useAction()
  const data = useLoad(
    () =>
      op<{
        object: { path: string; name: string; class: string }
        kind?: 'instance' | 'asset' | 'class'
        readOnlyWhy?: string
        props: Prop[]
      }>(project.id, 'props', { path, filter, maxChars: 400 }, target),
    [path, filter, target.instance, target.world],
  )
  // 类本身（WidgetBlueprintGeneratedClass 这种）整个只读
  const lockAll = data.data?.readOnlyWhy
  const props = (data.data?.props ?? [])
    .filter((p) => !onlyChanged || changed.has(`${path}|${p.name}`))
    .map((p) => (lockAll ? { ...p, readOnly: true, readOnlyWhy: lockAll } : p))
    .map((p) =>
      viewOnly
        ? { ...p, readOnly: true, readOnlyWhy: p.readOnlyWhy ?? t('这里只看不改，要改去 UE 页的资源分区') }
        : p,
    )
  // 分类按属性多少排（多的在前），换行显示不横向滚；改过的属性单独一个「改过的」分类（界面优化第 9 条）
  const menus = useMemo(() => {
    const m = new Map<string, Prop[]>()
    for (const p of props) {
      const g = splitCategory(p.category).top
      m.set(g, [...(m.get(g) ?? []), p])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [props])
  const changedCount = (data.data?.props ?? []).filter((p) => changed.has(`${path}|${p.name}`)).length
  // 搜索或「只看改过的」时跨分类列出；平时只列选中的分类（选的分类没了就回到第一个）
  const across = !!filter || onlyChanged
  const cur = menus.some(([g]) => g === menu) ? menu : (menus[0]?.[0] ?? '')
  const groups = useMemo(() => {
    const m = new Map<string, Prop[]>()
    for (const [g, ps] of menus) {
      if (!across && g !== cur) continue
      for (const p of ps) {
        const { sub } = splitCategory(p.category)
        const key = across ? [g, sub].filter(Boolean).join(' · ') : sub
        m.set(key, [...(m.get(key) ?? []), p])
      }
    }
    return [...m.entries()]
  }, [menus, across, cur])

  const set = (p: Prop, raw: string) =>
    run(p.name, async () => {
      if (p.readOnly) return
      let value: unknown = raw
      if (p.type === 'bool') value = raw === 'true'
      else if (
        /^(int|float|double|uint|int64|uint8|int8|int16|uint16|uint32|uint64)/.test(p.type) &&
        raw.trim() !== '' &&
        !isNaN(Number(raw))
      )
        value = Number(raw)
      else if (/^[[{]/.test(raw.trim())) {
        try {
          value = JSON.parse(raw)
        } catch {
          // 不是 JSON 就按 UE 的文本格式交给桥接（ImportText）
        }
      }
      const r = await op<{ prev: unknown; value: unknown; replicated?: boolean; client?: boolean }>(
        project.id,
        'set',
        { path, prop: p.name, value },
        target,
      )
      const k = `${path}|${p.name}`
      if (!changed.has(k)) changed.set(k, r.prev)
      if (r.replicated && r.client) setWarn(p.name)
      void data.reload()
    })

  const pin = (prop: string) =>
    run('pin', async () => {
      const local = await pget<{ watch: { path: string; prop: string }[] }>(project.id, 'local')
      if (local.watch.some((w) => w.path === path && w.prop === prop)) return toast.success(t('已经在监视里了'))
      await ppost(project.id, 'local', { watch: [...local.watch, { path, prop }] })
      toast.success(t('已固定到监视：{p}', { p: prop }))
    })

  const expand = (p: Prop) =>
    run(`x${p.name}`, async () => {
      if (open[p.name]) return setOpen((o) => ({ ...o, [p.name]: false }))
      const r = await op<{ value: unknown }>(project.id, 'get', { path, prop: p.name }, target)
      setFull((f) => ({ ...f, [p.name]: r.value }))
      setOpen((o) => ({ ...o, [p.name]: true }))
    })

  // 运行时对象页选到资源默认值：改值时提醒一句正在跑的对象不会变
  const editNote = cdo && data.data?.kind === 'asset' ? t('回车后改的是默认值，正在跑的对象不会变') : undefined
  /** 点对象引用：运行时对象在这里往下看（面包屑能回来），资源交给外面（跳到资源页） */
  const openRef = (p: string) => {
    if (isRuntimePath(p)) {
      setTrail((x) => [...x, p])
      setTab('props')
      setMenu('')
      setOnlyChanged(false)
      setFilter('')
    } else onOpen?.(p)
  }

  const server = inst?.worlds.find((w) => w.netMode === 'ListenServer' || w.netMode === 'DedicatedServer')

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
        {trail.length > 0 && (
          <ui.IconButton
            icon={ArrowLeft}
            label={t('返回上一个')}
            size="sm"
            onClick={() => setTrail((x) => x.slice(0, -1))}
          />
        )}
        <nav aria-label={t('对象路径')} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
          {[root, ...trail].slice(0, -1).map((p, i) => (
            <span key={`${i}:${p}`} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
              <button
                type="button"
                title={p}
                onClick={() => setTrail((x) => x.slice(0, i))}
                className="ue:max-w-40 ue:cursor-pointer ue:truncate ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:underline"
              >
                {shortName(p)}
              </button>
              <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
            </span>
          ))}
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg" title={path}>
            {(!trail.length && title) || data.data?.object.name || shortName(path)}
          </span>
        </nav>
        <KindBadge kind={data.data?.kind} />
        {data.data && <Badge>{data.data.object.class}</Badge>}
        <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          {!viewOnly && (
            <ui.Segmented
              size="sm"
              label={t('属性 / 函数')}
              value={tab}
              onChange={setTab}
              options={[
                { id: 'props', label: t('属性') },
                { id: 'fns', label: t('函数') },
                ...(hasLua ? [{ id: 'lua' as const, label: 'Lua' }] : []),
              ]}
            />
          )}
          <ui.IconButton
            icon={Copy}
            label={t('复制路径')}
            size="sm"
            onClick={() => void navigator.clipboard.writeText(path).then(() => toast.success(t('已复制')))}
          />
          {chat.available && (
            <ui.Button
              size="sm"
              variant="secondary"
              onClick={() => chat.send(describeObject(path, data.data, props, world))}
            >
              <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
            </ui.Button>
          )}
        </div>
      </header>
      {cdo && data.data?.kind === 'asset' && <CdoNote cls={data.data.object.class} />}
      {(readOnlyHint || lockAll) && (
        <div className="ue:px-4 ue:pt-3">
          <Note tone="info">{readOnlyHint || lockAll}</Note>
        </div>
      )}
      {tab === 'lua' && hasLua ? (
        <LuaTable path={path} onOpen={onOpen} />
      ) : tab === 'fns' ? (
        <Functions path={path} />
      ) : (
        <>
          <div className="ue:flex ue:items-center ue:gap-2 ue:px-4 ue:pt-3">
            <div className="ue:flex-1">
              <SearchBox
                placeholder={t('属性名前缀')}
                hint={t('前缀')}
                onSearch={setFilter}
                allowEmpty
                busy={data.loading}
              />
            </div>
          </div>
          {!filter && (menus.length > 1 || changedCount > 0) && (
            <nav
              aria-label={t('属性分类')}
              className="ue:flex ue:flex-wrap ue:gap-1 ue:border-b ue:border-line ue:px-4 ue:pt-3 ue:pb-2"
            >
              {menus.map(([g, ps]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setMenu(g)
                    setOnlyChanged(false)
                  }}
                  aria-current={!onlyChanged && g === cur ? 'true' : undefined}
                  className={cn(
                    'ue:inline-flex ue:h-7 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-md ue:px-2 ue:text-footnote',
                    !onlyChanged && g === cur
                      ? 'ue:bg-sel ue:font-medium ue:text-fg'
                      : 'ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
                  )}
                >
                  {g}
                  <span className="ue:text-caption ue:text-subtle">{ps.length}</span>
                </button>
              ))}
              {changedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOnlyChanged((v) => !v)}
                  aria-current={onlyChanged ? 'true' : undefined}
                  className={cn(
                    'ue:inline-flex ue:h-7 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-md ue:px-2 ue:text-footnote ue:text-accent-text',
                    onlyChanged ? 'ue:bg-accent-soft ue:font-medium' : 'ue:hover:bg-hover',
                  )}
                >
                  {t('改过的')}
                  <span className="ue:text-caption">{changedCount}</span>
                </button>
              )}
            </nav>
          )}
          {warn && (
            <div className="ue:px-4 ue:pt-3">
              <Note
                action={
                  server && (
                    <ui.Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setTarget(inst!.pid, inst!.kind, server.id)
                        setWarn('')
                      }}
                    >
                      {t('切到服务器')}
                    </ui.Button>
                  )
                }
              >
                {t('{p} 是同步属性，客户端改了会被服务器的值盖掉。要改真实值，把目标切到服务器世界。', { p: warn })}
              </Note>
            </div>
          )}
          <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-2">
            <div className="ue:px-4">
              <ErrorText>{data.error}</ErrorText>
            </div>
            {data.loading && !data.data && <p className="ue:px-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>}
            {groups.map(([g, ps]) => (
              <section key={g || '-'}>
                {g && (
                  <div className="ue:bg-hover/60 ue:px-4 ue:py-1.5 ue:text-footnote ue:font-medium ue:text-muted">
                    {g}
                  </div>
                )}
                {ps.map((p) => {
                  const k = `${path}|${p.name}`
                  const was = changed.has(k)
                  const vec = vecKeys(p.value)
                  const complex = typeof p.value === 'object' && p.value !== null && !vec
                  const str = show(p.value)
                  return (
                    <div key={p.name} className="ue:group ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5">
                      <div className="ue:flex ue:items-center ue:gap-3">
                        <div
                          className="ue:flex ue:w-[38%] ue:min-w-0 ue:shrink-0 ue:items-center ue:gap-1.5"
                          title={[p.type, p.tooltip, p.readOnly && p.readOnlyWhy].filter(Boolean).join('\n')}
                        >
                          {complex ? (
                            <button
                              type="button"
                              onClick={() => void expand(p)}
                              className="ue:cursor-pointer ue:text-subtle"
                            >
                              {open[p.name] ? (
                                <ChevronDown className="ue:h-3.5 ue:w-3.5" />
                              ) : (
                                <ChevronRight className="ue:h-3.5 ue:w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="ue:w-3.5" />
                          )}
                          <span className="ue:truncate ue:text-body ue:text-fg">{p.name}</span>
                          {p.replicated && <Badge tone="run">{t('同步')}</Badge>}
                        </div>
                        <div className="ue:min-w-0 ue:flex-1">
                          {typeof p.value === 'string' &&
                          looksLikePath(p.value) &&
                          (onOpen || isRuntimePath(p.value)) ? (
                            <button
                              type="button"
                              onClick={() => openRef(p.value as string)}
                              className="ue:max-w-full ue:cursor-pointer ue:truncate ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:underline"
                            >
                              {p.value}
                            </button>
                          ) : vec && !p.readOnly ? (
                            <VecEdit
                              p={p}
                              keys={vec}
                              was={was ? show(changed.get(k)) : undefined}
                              busy={busy === p.name}
                              onSet={(v) => void set(p, v)}
                              note={editNote}
                            />
                          ) : complex ? (
                            <span
                              className="ue:block ue:truncate ue:font-mono ue:text-footnote ue:text-muted"
                              title={str}
                            >
                              {str}
                            </span>
                          ) : (
                            <ValueEdit
                              p={p}
                              was={was ? show(changed.get(k)) : undefined}
                              busy={busy === p.name}
                              onSet={(v) => void set(p, v)}
                              note={editNote}
                            />
                          )}
                        </div>
                        <div className="ue:flex ue:w-14 ue:shrink-0 ue:justify-end ue:gap-0.5 ue:opacity-0 ue:group-hover:opacity-100">
                          {was && !p.readOnly && (
                            <ui.IconButton
                              icon={Undo2}
                              label={t('撤回修改')}
                              size="xs"
                              onClick={() => void set(p, show(changed.get(k))).then(() => changed.delete(k))}
                            />
                          )}
                          {!viewOnly && (
                            <ui.IconButton
                              icon={Pin}
                              label={t('固定到监视')}
                              size="xs"
                              onClick={() => void pin(p.name)}
                            />
                          )}
                        </div>
                      </div>
                      {open[p.name] && (
                        <pre
                          className={cn(
                            'ue:mt-1.5 ue:ml-5 ue:max-h-72 ue:overflow-auto ue:rounded-lg ue:bg-hover ue:p-2 ue:font-mono ue:text-caption ue:text-fg',
                          )}
                        >
                          {JSON.stringify(full[p.name], null, 2)}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
            {data.data && !props.length && (
              <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
                {onlyChanged ? t('这次还没有改过的属性') : t('没有匹配的属性')}
              </p>
            )}
          </div>
          {world && (
            <div className="ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">
              {t('运行时改的值停止 PIE 后不保留')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 路径的最后一段（面包屑、标题）：…:PersistentLevel.BP_Hero_C_1.HealthComponent → HealthComponent */
export function shortName(p: string) {
  return p.split(/[.:/]/).pop() || p
}

/** 「发给对话」的内容：对象路径、类、目标世界，和当前列出来的属性值（最多 40 个，长值截断） */
function describeObject(
  path: string,
  d: { object: { class: string }; kind?: string } | undefined,
  props: Prop[],
  world: World | undefined,
) {
  const lines = props.slice(0, 40).map((p) => {
    const v = show(p.value)
    return `${p.name} = ${v.length > 200 ? `${v.slice(0, 200)} …` : v}`
  })
  // 发给 Agent 的话不翻译（作为用户消息交给 CLI）
  return [
    `UE 对象 \`${path}\`${d ? `（${d.object.class}）` : ''}${world ? `，目标世界：${worldLabel(world)}` : ''}`,
    lines.length
      ? ['```', ...lines, props.length > 40 ? `… 还有 ${props.length - 40} 个属性` : '', '```']
          .filter(Boolean)
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
