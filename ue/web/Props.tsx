import { ChevronDown, ChevronRight, Copy, Pin, Play, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { op, pget, ppost, show, useAction, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { LuaTable } from './Lua.tsx'
import { Badge, ErrorText, Note, SearchBox, Term, useTargetInfo } from './ui.tsx'

export interface Prop {
  name: string
  type: string
  category?: string
  tooltip?: string
  replicated?: boolean
  readOnly?: boolean
  enum?: string[]
  value: unknown
}

interface Fn {
  name: string
  owner: string
  category: string
  tooltip: string
  params: { name: string; type: string; out?: boolean; enum?: string[] }[]
  ret: string
}

/** 这次在网页上改过的值（对象路径 + 属性 → 原值），换分区也保留，高亮「原 80」 */
const changed = new Map<string, unknown>()

/** 和服务端 isRuntimePath 一样：关卡里的、PIE 的、临时包里的对象（资源没有 Lua 实例） */
const isRuntimePath = (p: string) =>
  !p.startsWith('/') || /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/i.test(p)

const looksLikePath = (s: string) => /^\/(Game|Script|Engine|Temp)\/|:PersistentLevel\./.test(s)

/**
 * 属性面板（图 4 右栏）：按 Category 分组，改值、改过的高亮原值、同步属性在客户端改时提示切服务器、
 * 对象引用可点跳转、固定到监视、复制路径；旁边「函数」页签列出能调的函数。
 * 性能：属性列表一次取（大的值是摘要，展开时按路径单独取全量），按名字筛选点「搜索」才发请求
 */
export function Props({
  path,
  title,
  onOpen,
  readOnlyHint,
}: {
  path: string
  title?: string
  onOpen?: (path: string) => void
  readOnlyHint?: string
}) {
  const { project, target, setTarget } = useUe()
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
  const { busy, run } = useAction()
  const data = useLoad(
    () =>
      op<{ object: { path: string; name: string; class: string }; props: Prop[] }>(
        project.id,
        'props',
        { path, filter, maxChars: 400 },
        target,
      ),
    [path, filter, target.instance, target.world],
  )
  const props = (data.data?.props ?? []).filter((p) => !onlyChanged || changed.has(`${path}|${p.name}`))
  const groups = useMemo(() => {
    const m = new Map<string, Prop[]>()
    for (const p of props) {
      const g = p.category || t('其他')
      m.set(g, [...(m.get(g) ?? []), p])
    }
    return [...m.entries()]
  }, [props])

  const set = (p: Prop, raw: string) =>
    run(p.name, async () => {
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

  const server = inst?.worlds.find((w) => w.netMode === 'ListenServer' || w.netMode === 'DedicatedServer')

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg" title={path}>
          {title ?? data.data?.object.name ?? path.split(/[.:/]/).pop()}
        </span>
        {data.data && <Badge>{data.data.object.class}</Badge>}
        <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
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
          <ui.IconButton
            icon={Copy}
            label={t('复制路径')}
            size="sm"
            onClick={() => void navigator.clipboard.writeText(path).then(() => toast.success(t('已复制')))}
          />
        </div>
      </header>
      {readOnlyHint && (
        <div className="ue:px-4 ue:pt-3">
          <Note tone="info">{readOnlyHint}</Note>
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
            <ui.Button
              size="sm"
              variant={onlyChanged ? 'primary' : 'secondary'}
              onClick={() => setOnlyChanged((v) => !v)}
            >
              {t('只看改过的')}
            </ui.Button>
          </div>
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
              <section key={g}>
                <div className="ue:bg-hover/60 ue:px-4 ue:py-1.5 ue:text-footnote ue:font-medium ue:text-muted">
                  {g}
                </div>
                {ps.map((p) => {
                  const k = `${path}|${p.name}`
                  const was = changed.has(k)
                  const complex = typeof p.value === 'object' && p.value !== null
                  const str = show(p.value)
                  return (
                    <div key={p.name} className="ue:group ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5">
                      <div className="ue:flex ue:items-center ue:gap-3">
                        <div
                          className="ue:flex ue:w-[38%] ue:min-w-0 ue:shrink-0 ue:items-center ue:gap-1.5"
                          title={[p.type, p.tooltip].filter(Boolean).join('\n')}
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
                          {typeof p.value === 'string' && looksLikePath(p.value) && onOpen ? (
                            <button
                              type="button"
                              onClick={() => onOpen(p.value as string)}
                              className="ue:max-w-full ue:cursor-pointer ue:truncate ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:underline"
                            >
                              {p.value}
                            </button>
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
                            />
                          )}
                        </div>
                        <div className="ue:flex ue:w-14 ue:shrink-0 ue:justify-end ue:gap-0.5 ue:opacity-0 ue:group-hover:opacity-100">
                          {was && (
                            <ui.IconButton
                              icon={Undo2}
                              label={t('改回原值')}
                              size="xs"
                              onClick={() => void set(p, show(changed.get(k))).then(() => changed.delete(k))}
                            />
                          )}
                          <ui.IconButton
                            icon={Pin}
                            label={t('固定到监视')}
                            size="xs"
                            onClick={() => void pin(p.name)}
                          />
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

/** 单个值：布尔开关、枚举下拉、其余文本框（回车提交，失焦不提交，免得误改） */
function ValueEdit({ p, was, busy, onSet }: { p: Prop; was?: string; busy: boolean; onSet: (v: string) => void }) {
  const { ui, cn } = h()
  const v = show(p.value)
  if (p.type === 'bool')
    return (
      <button
        type="button"
        role="switch"
        aria-checked={p.value === true}
        disabled={busy || p.readOnly}
        onClick={() => onSet(String(!(p.value === true)))}
        className={cn(
          'ue:relative ue:h-5 ue:w-9 ue:cursor-pointer ue:rounded-full ue:transition-colors',
          p.value === true ? 'ue:bg-accent' : 'ue:bg-line-strong',
        )}
      >
        <span
          className={cn(
            'ue:absolute ue:top-0.5 ue:h-4 ue:w-4 ue:rounded-full ue:bg-card ue:shadow-card ue:transition-all',
            p.value === true ? 'ue:left-4.5' : 'ue:left-0.5',
          )}
        />
      </button>
    )
  if (p.enum?.length)
    return (
      <ui.Select
        size="xs"
        value={v}
        disabled={busy || p.readOnly}
        onChange={(e: { target: { value: string } }) => onSet(e.target.value)}
        options={p.enum.map((x) => ({ value: x, label: x }))}
      />
    )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSet(String(new FormData(e.currentTarget).get('v') ?? ''))
      }}
      className={cn(
        'ue:flex ue:h-7 ue:items-center ue:rounded-md ue:border ue:px-2',
        was !== undefined ? 'ue:border-danger/50 ue:bg-danger/5' : 'ue:border-line ue:bg-field',
        'ue:focus-within:border-focus',
      )}
    >
      <input
        name="v"
        key={v}
        defaultValue={v}
        disabled={busy}
        readOnly={p.readOnly}
        aria-label={p.name}
        className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:font-mono ue:text-footnote ue:text-fg ue:outline-none"
      />
      {was !== undefined && (
        <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('原 {v}', { v: was })}</span>
      )}
    </form>
  )
}

/** 函数页签：能调的函数（BlueprintCallable / Exec / 标了 AgentPanel 的），填参数调用 */
function Functions({ path }: { path: string }) {
  const { project, target } = useUe()
  const { ui } = h()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState('')
  const [args, setArgs] = useState<Record<string, string>>({})
  const [res, setRes] = useState<{ text: string; error?: boolean }>()
  const { busy, run } = useAction()
  const fns = useLoad(() => op<{ items: Fn[] }>(project.id, 'functions', { path }, target), [path])
  const list = (fns.data?.items ?? []).filter((f) => !q || f.name.toLowerCase().startsWith(q.toLowerCase()))
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <SearchBox placeholder={t('函数名前缀')} onSearch={setQ} allowEmpty />
      <ErrorText>{fns.error}</ErrorText>
      <ul className="ue:min-h-0 ue:flex-1 ue:divide-y ue:divide-line ue:overflow-auto ue:rounded-xl ue:border ue:border-line">
        {list.slice(0, 200).map((f) => (
          <li key={`${f.owner}.${f.name}`} className="ue:px-3 ue:py-2">
            <button
              type="button"
              className="ue:flex ue:w-full ue:cursor-pointer ue:items-baseline ue:gap-2 ue:text-left"
              onClick={() => {
                setSel(sel === f.name ? '' : f.name)
                setArgs({})
                setRes(undefined)
              }}
            >
              <span className="ue:font-mono ue:text-footnote ue:text-fg">{f.name}</span>
              <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                (
                {f.params
                  .filter((p) => !p.out)
                  .map((p) => `${p.type} ${p.name}`)
                  .join(', ')}
                ){f.ret ? ` → ${f.ret}` : ''}
              </span>
              <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{f.owner}</span>
            </button>
            {sel === f.name && (
              <form
                className="ue:mt-2 ue:flex ue:flex-col ue:gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run('call', async () => {
                    try {
                      const r = await op(project.id, 'call', { path, function: f.name, args }, target)
                      setRes({ text: JSON.stringify({ ret: r.ret, out: r.out }, null, 2) })
                    } catch (err) {
                      setRes({ text: (err as Error).message, error: true })
                    }
                  })
                }}
              >
                {f.tooltip && <p className="ue:text-footnote ue:text-subtle">{f.tooltip}</p>}
                {f.params
                  .filter((p) => !p.out)
                  .map((p) => (
                    <label key={p.name} className="ue:flex ue:items-center ue:gap-2">
                      <span className="ue:w-32 ue:truncate ue:font-mono ue:text-caption ue:text-muted">{p.name}</span>
                      <ui.Input
                        size="xs"
                        className="ue:flex-1 ue:font-mono"
                        placeholder={p.type}
                        value={args[p.name] ?? ''}
                        onChange={(e: { target: { value: string } }) =>
                          setArgs((a) => ({ ...a, [p.name]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                <div>
                  <ui.Button size="sm" type="submit" disabled={busy === 'call'}>
                    <Play className="ue:h-3.5 ue:w-3.5" /> {t('调用')}
                  </ui.Button>
                </div>
                {res && (
                  <Term className="ue:max-h-48">
                    <pre className={res.error ? 'ue:whitespace-pre-wrap ue:text-danger' : 'ue:whitespace-pre-wrap'}>
                      {res.text}
                    </pre>
                  </Term>
                )}
              </form>
            )}
          </li>
        ))}
        {fns.data && !list.length && (
          <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">{t('没有能调的函数')}</li>
        )}
      </ul>
    </div>
  )
}
