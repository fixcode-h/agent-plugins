import { Play } from 'lucide-react'
import { useState } from 'react'
import { op, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { Caret } from './details/controls.tsx'
import { FnDialog, type Fn, type FnResult } from './FnDialog.tsx'
import { t } from './host.ts'
import { Badge, ErrorText, SearchBox } from './ui.tsx'

const ACCESS: Record<string, () => string> = { protected: () => t('受保护'), private: () => t('私有') }
const RANK = { public: 0, protected: 1, private: 2 }

const keyOf = (f: Fn) => `${f.owner}.${f.name}`

/** 输入动作、组件委托绑定生成的事件函数（InpActEvt_…、BndEvt__…）：名字很长、数量多，单独收一组 */
const isBoundEvent = (f: Fn) => /^(InpActEvt|InpAxisEvt|InpAxisKeyEvt|InpTchEvt|BndEvt)_/.test(f.name)
const EVENTS = '\u0000events'

interface Group {
  id: string
  label: string
  rows: Fn[]
}

/**
 * 按声明的类分组（用户 2026-11-15：全混在一起看不清）：顺序照桥接给的，自己的类在前、父类往后；
 * 每组里公有在前，受保护 / 私有标小字。输入和委托绑定生成的事件单独一组放最后
 */
function groupFns(list: Fn[]): Group[] {
  const m = new Map<string, Fn[]>()
  for (const f of list) {
    const k = isBoundEvent(f) ? EVENTS : f.owner
    m.set(k, [...(m.get(k) ?? []), f])
  }
  const out: Group[] = []
  for (const [id, rows] of m) {
    if (id === EVENTS) continue
    rows.sort((a, b) => RANK[a.access ?? 'public'] - RANK[b.access ?? 'public'])
    out.push({ id, label: id, rows })
  }
  const ev = m.get(EVENTS)
  if (ev) out.push({ id: EVENTS, label: t('输入与绑定事件'), rows: ev })
  return out
}

/** 默认展开蓝图类（_C 结尾）的组，引擎 / C++ 基类的函数多、平时不看，先收起；输入事件也收起 */
const openByDefault = (id: string) => id !== EVENTS && /_C$/.test(id)

/**
 * 函数页签：对象上所有的 UFUNCTION，按声明的类分组、可折叠，输入时实时筛（名字包含）；点一个弹窗填参数执行。
 * 没开放给蓝图的标「非蓝图函数」，网页上你自己点能执行，Agent 的 ue_call 仍只能调蓝图开放的
 */
export function Functions({ path }: { path: string }) {
  const { project, target } = useUe()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Fn>()
  // 每个函数填过的参数和上次结果：关了弹窗再打开还在，改了能接着执行
  const [args, setArgs] = useState<Record<string, Record<string, string>>>({})
  const [results, setResults] = useState<Record<string, FnResult>>({})
  const fns = useLoad(() => op<{ items: Fn[] }>(project.id, 'functions', { path, all: true }, target), [path])
  const needle = q.toLowerCase()
  const list = (fns.data?.items ?? []).filter((f) => !q || f.name.toLowerCase().includes(needle))
  const groups = groupFns(list)
  // 手动展开 / 收起过的组记在这里，没动过的按 openByDefault；在筛的时候有匹配的组全展开
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const isOpen = (id: string) => (q ? true : (toggled[id] ?? openByDefault(id)))
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <SearchBox placeholder={t('搜函数名')} onSearch={setQ} allowEmpty live />
      <ErrorText>{fns.error}</ErrorText>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:border-t ue:border-line">
        {groups.map((g) => {
          const open = isOpen(g.id)
          return (
            <section key={g.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((m) => ({ ...m, [g.id]: !open }))}
                className="ue:sticky ue:top-0 ue:z-10 ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:bg-card ue:px-2 ue:py-1.5 ue:text-left ue:text-caption ue:font-medium ue:text-muted ue:hover:text-fg"
              >
                <Caret open={open} />
                <span className="ue:truncate">{g.label}</span>
                <span className="ue:font-normal ue:text-subtle">{g.rows.length}</span>
              </button>
              {open && (
                <ul className="ue:divide-y ue:divide-line">
                  {g.rows.slice(0, 300).map((f) => (
                    <li key={keyOf(f)}>
                      <button
                        type="button"
                        onClick={() => setOpen(f)}
                        className="ue:group ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:py-2 ue:pr-3 ue:pl-7 ue:text-left ue:hover:bg-hover"
                      >
                        <span className="ue:shrink-0 ue:font-mono ue:text-footnote ue:text-fg">{f.name}</span>
                        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                          (
                          {f.params
                            .filter((p) => !p.out)
                            .map((p) => `${p.type} ${p.name}`)
                            .join(', ')}
                          ){f.ret ? ` → ${f.ret}` : ''}
                        </span>
                        {f.access && ACCESS[f.access] && <Badge>{ACCESS[f.access]()}</Badge>}
                        {f.blueprint === false && <Badge tone="warn">{t('非蓝图函数')}</Badge>}
                        {g.id === EVENTS && (
                          <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{f.owner}</span>
                        )}
                        <Play
                          className={`ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle ue:group-hover:text-fg ${g.id === EVENTS ? '' : 'ue:ml-auto'}`}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        {fns.data && !list.length && (
          <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
            {q ? t('没有匹配的函数') : t('没有能调的函数')}
          </p>
        )}
      </div>
      {open && (
        <FnDialog
          path={path}
          fn={open}
          args={args[keyOf(open)] ?? {}}
          setArgs={(a) => setArgs((m) => ({ ...m, [keyOf(open)]: a }))}
          result={results[keyOf(open)]}
          setResult={(r) => setResults((m) => ({ ...m, [keyOf(open)]: r }))}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  )
}
