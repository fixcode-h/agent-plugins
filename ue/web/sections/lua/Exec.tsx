import { Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { luaText, type LuaDesc, type LuaField } from '../../Lua.tsx'
import { Card, Term } from '../../ui.tsx'

interface Result extends LuaDesc {
  fields?: LuaField[]
  total?: number
}
interface Entry {
  code: string
  self?: string
  output: string[]
  results: Result[]
  error?: string
  ms?: number
}

/** 屏幕上最多留多少次执行的输出 */
const MAX_ENTRIES = 100

/**
 * Lua 页「执行」页签：执行 Lua 代码（单个表达式直接显示值，print 和执行期间的日志收进输出，
 * 填了对象路径时代码里的 self 是它的实例表）
 */
export function LuaExec() {
  const { project, target } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [code, setCode] = useState('')
  const [self, setSelf] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const end = useRef<HTMLDivElement>(null)
  // 花括号不能省：新版 Chromium 的 scrollIntoView 返回 Promise，直接当返回值会被 React 当成清理函数调用而报错
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  const exec = () =>
    run('exec', async () => {
      const c = code.trim()
      if (!c) return
      const e: Entry = { code: c, self: self.trim() || undefined, output: [], results: [] }
      try {
        const r = await op<{ results: Result[]; output: string[]; ms: number }>(
          project.id,
          'lua.exec',
          { code: c, path: self.trim(), timeoutMs: 10000 },
          target,
          20000,
        )
        Object.assign(e, { results: r.results ?? [], output: r.output ?? [], ms: r.ms })
      } catch (err) {
        e.error = (err as Error).message
      }
      setEntries((x) => [...x, e].slice(-MAX_ENTRIES))
    })

  return (
    <Card
      className="ue:m-4 ue:flex ue:min-h-0 ue:flex-1 ue:flex-col"
      title={t('执行 Lua')}
      bodyClass="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-3 ue:p-3"
    >
      <Term className="ue:min-h-40 ue:flex-1">
        {!entries.length && (
          <div className="ue:text-term-subtle">
            {t('单个表达式直接显示它的值，多条语句用 return 返回；print 的内容显示在下面。Ctrl+Enter 执行')}
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className="ue:mb-3">
            <pre className="ue:whitespace-pre-wrap ue:text-term-cmd">
              {e.self ? `-- self = ${e.self}\n` : ''}
              {e.code}
            </pre>
            {e.output.map((l, j) => (
              <div key={j} className="ue:whitespace-pre-wrap">
                {l}
              </div>
            ))}
            {e.error ? (
              <pre className="ue:whitespace-pre-wrap ue:text-danger">{e.error}</pre>
            ) : (
              e.results.map((r, j) => (
                <div key={j}>
                  <div className="ue:text-term-fg">{`→ ${luaText(r)}`}</div>
                  {(r.fields ?? []).map((f, k) => (
                    <div key={k} className="ue:pl-4 ue:text-term-subtle">
                      {`${f.kt === 'number' ? `[${f.k}]` : f.k} = ${luaText(f)}`}
                    </div>
                  ))}
                  {(r.total ?? 0) > (r.fields?.length ?? 0) && (
                    <div className="ue:pl-4 ue:text-term-subtle">{t('… 共 {n} 项', { n: r.total ?? 0 })}</div>
                  )}
                </div>
              ))
            )}
            {e.ms !== undefined && !e.error && (
              <div className="ue:text-caption ue:text-term-subtle">{`${e.ms.toFixed(1)} ms`}</div>
            )}
          </div>
        ))}
        <div ref={end} />
      </Term>
      <ui.Input
        size="sm"
        className="ue:font-mono"
        value={self}
        placeholder={t('self 对象路径（可选，从对象页里复制）')}
        onChange={(e: { target: { value: string } }) => setSelf(e.target.value)}
      />
      <ui.Textarea
        rows={5}
        className="ue:font-mono ue:text-footnote"
        value={code}
        placeholder={'GameSystemManager:GetCount()'}
        onChange={(e: { target: { value: string } }) => setCode(e.target.value)}
        onKeyDown={(e: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void }) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void exec()
          }
        }}
      />
      <div className="ue:flex ue:items-center ue:gap-2">
        <ui.Button size="sm" disabled={busy === 'exec' || !code.trim()} onClick={() => void exec()}>
          <Play className="ue:h-3.5 ue:w-3.5" /> {t('执行')}
        </ui.Button>
        <span className="ue:text-caption ue:text-subtle">{t('超过 10 秒自动中止；执行的代码会记进操作记录')}</span>
      </div>
    </Card>
  )
}
