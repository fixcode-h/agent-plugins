import { Play } from 'lucide-react'
import { useState } from 'react'
import { op, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { FnDialog, type Fn, type FnResult } from './FnDialog.tsx'
import { t } from './host.ts'
import { Badge, ErrorText, SearchBox } from './ui.tsx'

/** 函数按访问级别分组展示（用户 2026-11-11 定）：公有、受保护、私有 */
const GROUPS = [
  { id: 'public', label: () => t('公有') },
  { id: 'protected', label: () => t('受保护') },
  { id: 'private', label: () => t('私有') },
] as const

const keyOf = (f: Fn) => `${f.owner}.${f.name}`

/**
 * 函数页签：对象上所有的 UFUNCTION，按公有 / 受保护 / 私有分组；点一个弹窗填参数执行。
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
  const list = (fns.data?.items ?? []).filter((f) => !q || f.name.toLowerCase().startsWith(q.toLowerCase()))
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <SearchBox placeholder={t('函数名前缀')} onSearch={setQ} allowEmpty />
      <ErrorText>{fns.error}</ErrorText>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:border-t ue:border-line">
        {GROUPS.map((g) => {
          const rows = list.filter((f) => (f.access ?? 'public') === g.id)
          if (!rows.length) return null
          return (
            <section key={g.id} className="ue:pb-2">
              <h3 className="ue:sticky ue:top-0 ue:z-10 ue:flex ue:items-center ue:gap-2 ue:bg-card ue:px-3 ue:pt-3 ue:pb-1.5 ue:text-caption ue:font-medium ue:text-subtle">
                {g.label()}
                <span className="ue:font-normal">{rows.length}</span>
              </h3>
              <ul className="ue:divide-y ue:divide-line">
                {rows.slice(0, 300).map((f) => (
                  <li key={keyOf(f)}>
                    <button
                      type="button"
                      onClick={() => setOpen(f)}
                      className="ue:group ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-2 ue:text-left ue:hover:bg-hover"
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
                      {f.blueprint === false && <Badge tone="warn">{t('非蓝图函数')}</Badge>}
                      <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{f.owner}</span>
                      <Play className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle ue:group-hover:text-fg" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        {fns.data && !list.length && (
          <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">{t('没有能调的函数')}</p>
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
