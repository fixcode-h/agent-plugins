import { Play } from 'lucide-react'
import { useState } from 'react'
import { op, useAction, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { ErrorText, SearchBox, Term } from './ui.tsx'

interface Fn {
  name: string
  owner: string
  category: string
  tooltip: string
  params: { name: string; type: string; out?: boolean; enum?: string[] }[]
  ret: string
}

/** 函数页签：能调的函数（BlueprintCallable / Exec / 标了 AgentPanel 的），填参数调用 */
export function Functions({ path }: { path: string }) {
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
      <ul className="ue:min-h-0 ue:flex-1 ue:divide-y ue:divide-line ue:overflow-auto ue:border-t ue:border-line">
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
