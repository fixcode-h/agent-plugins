import { ListPlus, Play, Plus, Star, Table, Trash2, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { GmMacro, GmStore } from '../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../api.ts'
import { useAsk } from '../ask.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { takePending } from '../pending.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { Badge, ErrorText, NotRunning, PageHead, SearchBox, Term, useTargetInfo } from '../ui.tsx'

interface Param {
  name: string
  type: string
  out?: boolean
  enum?: string[]
}
interface GmItem {
  name: string
  owner: string
  category: string
  tooltip: string
  source: string
  server: boolean
  params: Param[]
}

/** gm.list 要遍历所有类，按进程缓存（同一个进程的 GM 不会变；Live Coding 后点「刷新」重取） */
const cache = new Map<number, GmItem[]>()
const EMPTY: GmStore = { presets: [], macros: [], favConsole: [], favGm: [] }

/** GM（图 3）：左边分组，右边命令；选中的命令展开参数表单和输出；宏是多步 GM 顺序执行 */
export function Gm() {
  const { project, target } = useUe()
  const { inst } = useTargetInfo()
  const { cn, ui, toast } = h()
  const { busy, run } = useAction()
  const [nonce, setNonce] = useState(0)
  const list = useLoad(async () => {
    if (!inst) return []
    const hit = cache.get(inst.pid)
    if (hit && !nonce) return hit
    const r = await op<{ items: GmItem[] }>(project.id, 'gm.list', {}, { instance: inst.pid })
    cache.set(inst.pid, r.items)
    return r.items
  }, [inst?.pid, nonce])
  const store = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const gm = { ...EMPTY, ...store.data }
  const [group, setGroup] = useState('')
  // Ctrl+K 带过来的 GM 名字开头（lazy 初始值只取一次）
  const [q, setQ] = useState(() => takePending('gm') ?? '')
  const [sel, setSel] = useState<GmItem>()
  // 左边分组和宏的宽度可拖；右边 GM 列表至少留 360px
  const pane = usePane('gm', '208px', 160)
  const left = useRef<HTMLElement>(null)
  const [args, setArgs] = useState<Record<string, string>>({})
  const [output, setOutput] = useState<{ lines: string[]; error?: string }>()
  const [macro, setMacro] = useState<GmMacro>()

  const items = list.data ?? []
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(i.category || t('未分组'), (m.get(i.category || t('未分组')) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])
  const shown = items.filter(
    (i) =>
      (group === '__fav'
        ? gm.favGm.some((f) => f.split(' ')[0] === i.name)
        : !group || (i.category || t('未分组')) === group) &&
      (!q || i.name.toLowerCase().startsWith(q.toLowerCase())),
  )

  const save = (next: GmStore) =>
    run('save', async () => {
      await ppost(project.id, 'gm', next)
      store.setData(next)
    })

  const exec = (it: GmItem, values: string[]) =>
    run('run', async () => {
      setOutput(undefined)
      try {
        const r = await op<{ output?: string[] }>(
          project.id,
          'gm.run',
          { name: it.name, owner: it.source === 'library' ? it.owner : '', args: values },
          target,
        )
        setOutput({ lines: r.output ?? [] })
      } catch (e) {
        setOutput({ lines: [], error: (e as Error).message })
      }
    })

  const values = (it: GmItem) => it.params.filter((p) => !p.out).map((p) => args[p.name] ?? '')
  const favKey = (it: GmItem) => [it.name, ...values(it)].join(' ').trim()

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title="GM" desc={t('Exec 函数和继承 UAgentPanelGMLibrary 的函数，自动发现')}>
        <ui.Button size="sm" variant="secondary" onClick={() => setNonce((n) => n + 1)}>
          {t('刷新')}
        </ui.Button>
      </PageHead>
      {!inst ? (
        <NotRunning icon={Wand2} what={t('GM 要在运行中的编辑器或游戏里执行。')} />
      ) : (
        <div className={SPLIT_ROW}>
          <nav
            ref={left}
            style={pane.style('calc(100% - 376px)')}
            className={cn('ue:flex ue:flex-col ue:gap-0.5 ue:lg:overflow-auto', PANE_FIXED)}
          >
            {[['', items.length] as [string, number], ['__fav', gm.favGm.length] as [string, number], ...groups].map(
              ([g, n]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={cn(
                    'ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:px-2.5 ue:text-body',
                    group === g ? 'ue:bg-active ue:text-fg' : 'ue:text-muted ue:hover:bg-hover',
                  )}
                >
                  {g === '__fav' && <Star className="ue:h-3.5 ue:w-3.5" />}
                  <span className="ue:truncate">{g === '' ? t('全部') : g === '__fav' ? t('收藏') : g}</span>
                  <span className="ue:ml-auto ue:text-caption ue:text-subtle">{n}</span>
                </button>
              ),
            )}
            <div className="ue:mt-4 ue:flex ue:items-center ue:px-2.5 ue:text-caption ue:text-subtle">
              {t('宏')}
              <button
                type="button"
                title={t('新建宏')}
                onClick={() => setMacro({ id: '', name: '', steps: [] })}
                className="ue:ml-auto ue:cursor-pointer ue:hover:text-fg"
              >
                <Plus className="ue:h-3.5 ue:w-3.5" />
              </button>
            </div>
            {gm.macros.map((m) => (
              <div
                key={m.id}
                className="ue:group ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-lg ue:px-2.5 ue:text-body ue:text-muted ue:hover:bg-hover"
              >
                <button
                  type="button"
                  className="ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:truncate ue:text-left"
                  onClick={() => setMacro(m)}
                >
                  {m.name}
                </button>
                <button
                  type="button"
                  title={t('执行')}
                  disabled={!!busy}
                  onClick={() =>
                    void run('macro', async () => {
                      const r = await ppost<{
                        ok: boolean
                        failedAt?: number
                        steps: { step: number; ok: boolean; output?: string[]; error?: string }[]
                      }>(project.id, 'macro', { id: m.id, target })
                      setSel(undefined)
                      setOutput({
                        lines: r.steps.flatMap((s) => [`#${s.step} ${s.ok ? 'OK' : 'FAIL'}`, ...(s.output ?? [])]),
                        error: r.ok
                          ? undefined
                          : t('第 {n} 步失败：{msg}', { n: r.failedAt ?? 0, msg: r.steps.at(-1)?.error ?? '' }),
                      })
                    })
                  }
                  className="ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
                >
                  <Play className="ue:h-3.5 ue:w-3.5" />
                </button>
              </div>
            ))}
          </nav>
          <SplitHandle pane={pane} paneRef={left} reserve={() => 376} />

          <div className={cn('ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-3', PANE_FILL)}>
            <SearchBox initial={q} placeholder={t('GM 名字前缀')} hint={t('前缀')} onSearch={setQ} allowEmpty />
            <ErrorText>{list.error}</ErrorText>
            {list.loading && !items.length && <p className="ue:text-footnote ue:text-subtle">{t('正在列出 GM…')}</p>}
            <div className="ue:grid ue:min-h-0 ue:flex-1 ue:auto-rows-min ue:gap-2 ue:overflow-auto ue:xl:grid-cols-2">
              {shown.slice(0, 300).map((it) => {
                const on = sel?.name === it.name && sel.owner === it.owner
                const fav = gm.favGm.some((f) => f.split(' ')[0] === it.name)
                return (
                  <div
                    key={`${it.owner}.${it.name}`}
                    className={cn(
                      'ue:flex ue:flex-col ue:gap-2 ue:rounded-xl ue:border ue:bg-card ue:p-3',
                      on ? 'ue:border-sel-line ue:xl:col-span-2' : 'ue:border-line',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSel(it)
                        setArgs({})
                        setOutput(undefined)
                      }}
                      className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-left"
                    >
                      <span className="ue:font-mono ue:text-body ue:text-fg">{it.name}</span>
                      {it.params
                        .filter((p) => !p.out)
                        .map((p) => (
                          <span key={p.name} className="ue:font-mono ue:text-caption ue:text-subtle">
                            {p.name}
                          </span>
                        ))}
                      <span className="ue:ml-auto ue:flex ue:gap-1">
                        {it.server && <Badge tone="warn">{t('服务器执行')}</Badge>}
                        <Badge>{it.source === 'library' ? it.owner : it.owner.replace(/^(Default__)/, '')}</Badge>
                      </span>
                    </button>
                    {it.tooltip && <p className="ue:text-footnote ue:text-subtle">{it.tooltip}</p>}
                    {on && (
                      <form
                        className="ue:flex ue:flex-col ue:gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void exec(it, values(it))
                        }}
                      >
                        {it.params
                          .filter((p) => !p.out)
                          .map((p) => (
                            <ParamInput
                              key={p.name}
                              gmName={it.name}
                              p={p}
                              value={args[p.name] ?? ''}
                              onChange={(v) => setArgs((a) => ({ ...a, [p.name]: v }))}
                              store={gm}
                              onStore={save}
                            />
                          ))}
                        <div className="ue:flex ue:items-center ue:gap-2">
                          <ui.Button size="sm" type="submit" disabled={busy === 'run'}>
                            <Play className="ue:h-3.5 ue:w-3.5" /> {t('执行')}
                          </ui.Button>
                          <ui.Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const k = favKey(it)
                              void save({
                                ...gm,
                                favGm: fav ? gm.favGm.filter((f) => f.split(' ')[0] !== it.name) : [...gm.favGm, k],
                              })
                            }}
                          >
                            <Star className={cn('ue:h-3.5 ue:w-3.5', fav && 'ue:fill-current ue:text-warning')} />{' '}
                            {fav ? t('取消收藏') : t('收藏（带当前参数）')}
                          </ui.Button>
                          <ui.Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setMacro((m) => ({
                                ...(m ?? { id: '', name: '', steps: [] }),
                                steps: [...(m?.steps ?? []), { gm: it.name, args: values(it) }],
                              }))
                            }
                          >
                            <ListPlus className="ue:h-3.5 ue:w-3.5" /> {t('加到宏')}
                          </ui.Button>
                        </div>
                      </form>
                    )}
                    {on && output && (
                      <Term className="ue:max-h-60">
                        {output.error && <div className="ue:text-danger">{output.error}</div>}
                        {output.lines.map((l, i) => (
                          <div key={i} className="ue:whitespace-pre-wrap">
                            {l}
                          </div>
                        ))}
                        {!output.error && !output.lines.length && (
                          <div className="ue:text-term-subtle">{t('已执行（没有输出）')}</div>
                        )}
                      </Term>
                    )}
                  </div>
                )
              })}
              {shown.length > 300 && (
                <p className="ue:text-footnote ue:text-subtle">{t('只显示前 300 个，输入前缀缩小范围')}</p>
              )}
              {!sel && output && (
                <Term className="ue:xl:col-span-2">
                  {output.error && <div className="ue:text-danger">{output.error}</div>}
                  {output.lines.map((l, i) => (
                    <div key={i} className="ue:whitespace-pre-wrap">
                      {l}
                    </div>
                  ))}
                </Term>
              )}
            </div>
          </div>
        </div>
      )}
      {macro && (
        <MacroEditor
          macro={macro}
          onClose={() => setMacro(undefined)}
          onSave={(m) => {
            const id = m.id || `m${Date.now().toString(36)}`
            const next = { ...gm, macros: [...gm.macros.filter((x) => x.id !== id), { ...m, id }] }
            void save(next).then(() => {
              setMacro(undefined)
              toast.success(t('宏已保存'))
            })
          }}
          onDelete={(m) =>
            void save({ ...gm, macros: gm.macros.filter((x) => x.id !== m.id) }).then(() => setMacro(undefined))
          }
        />
      )}
    </div>
  )
}

/** 一个参数：枚举出下拉；绑定了数据表的出行名下拉（设计文档 3.3：填物品 ID 不用去查表） */
function ParamInput({
  gmName,
  p,
  value,
  onChange,
  store,
  onStore,
}: {
  gmName: string
  p: Param
  value: string
  onChange: (v: string) => void
  store: GmStore
  onStore: (s: GmStore) => unknown
}) {
  const { project } = useUe()
  const { ui } = h()
  const key = `${gmName}.${p.name}`
  const bound = store.bindings?.[key] ?? ''
  const rows = useLoad(
    () =>
      bound
        ? op<{ rows: { name: string }[] }>(project.id, 'datatable', { path: bound, limit: 1000 }).then((r) =>
            r.rows.map((x) => x.name),
          )
        : Promise.resolve([]),
    [bound],
  )
  const [dialog, ask] = useAsk()
  const bind = async () => {
    const path = await ask({
      title: t('绑定 DataTable'),
      label: t('DataTable 资源路径，例如 /Game/Data/DT_Items；留空取消绑定'),
      init: bound,
      allowEmpty: true,
    })
    if (path === undefined) return
    const bindings = { ...(store.bindings ?? {}) }
    if (path.trim()) bindings[key] = path.trim()
    else delete bindings[key]
    void onStore({ ...store, bindings })
  }
  const list = p.enum ?? (bound ? (rows.data ?? []) : undefined)
  return (
    <>
      {dialog}
      <label className="ue:flex ue:items-center ue:gap-3">
        <span className="ue:w-32 ue:shrink-0 ue:truncate ue:font-mono ue:text-footnote ue:text-muted" title={p.type}>
          {p.name} <span className="ue:text-subtle">{p.type}</span>
        </span>
        {p.type === 'bool' ? (
          <ui.Select
            size="sm"
            className="ue:flex-1"
            value={value}
            onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
            options={[
              { value: '', label: '—' },
              { value: 'true', label: 'true' },
              { value: 'false', label: 'false' },
            ]}
          />
        ) : list && list.length ? (
          <ui.Select
            size="sm"
            className="ue:flex-1"
            value={value}
            placeholder={bound ? bound.split('/').pop() : p.name}
            onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
            options={list.map((x) => ({ value: x, label: x }))}
          />
        ) : (
          <ui.Input
            size="sm"
            className="ue:flex-1 ue:font-mono"
            value={value}
            onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
          />
        )}
        {!p.enum && p.type !== 'bool' && (
          <ui.IconButton
            icon={Table}
            label={bound ? t('已绑定 {dt}（点击修改）', { dt: bound }) : t('绑定数据表')}
            size="xs"
            onClick={() => void bind()}
          />
        )}
      </label>
    </>
  )
}

/** 宏编辑：一行一步，「GM名 参数…」或「> 控制台命令」 */
function MacroEditor({
  macro,
  onClose,
  onSave,
  onDelete,
}: {
  macro: GmMacro
  onClose: () => void
  onSave: (m: GmMacro) => void
  onDelete: (m: GmMacro) => void
}) {
  const { ui } = h()
  const [name, setName] = useState(macro.name)
  const [text, setText] = useState(
    macro.steps.map((s) => (s.console ? `> ${s.console}` : [s.gm, ...(s.args ?? [])].join(' '))).join('\n'),
  )
  const steps = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l.startsWith('>') ? { console: l.slice(1).trim() } : { gm: l.split(/\s+/)[0], args: l.split(/\s+/).slice(1) },
    )
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={macro.id ? t('编辑宏') : t('新建宏')}
      footer={
        <>
          {macro.id && (
            <ui.Button variant="danger-outline" className="ue:mr-auto" onClick={() => onDelete(macro)}>
              <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('删除')}
            </ui.Button>
          )}
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button
            disabled={!name.trim() || !steps.length}
            onClick={() => onSave({ ...macro, name: name.trim(), steps })}
          >
            {t('保存')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-4">
        <ui.Field label={t('名字')}>
          <ui.Input
            value={name}
            onChange={(e: { target: { value: string } }) => setName(e.target.value)}
            placeholder={t('新手号一键')}
          />
        </ui.Field>
        <ui.Field label={t('步骤')} hint={t('一行一步：「GM 名 参数…」，控制台命令以 > 开头。任何一步失败就停下')}>
          <ui.Textarea
            rows={8}
            className="ue:font-mono"
            value={text}
            onChange={(e: { target: { value: string } }) => setText(e.target.value)}
            placeholder={'AddItem 1003 20\nGod\n> slomo 0.5'}
          />
        </ui.Field>
      </div>
    </ui.Modal>
  )
}
