import { Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { parseLuaPath, type LuaKey } from '../../server/luapath.ts'
import { op, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { LuaTable, luaText, type LuaDesc, type LuaField } from '../Lua.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { Card, ErrorText, Note, PageHead, SearchBox, Term, useTargetInfo } from '../ui.tsx'

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
 * Lua 页（装了 UnLua 的项目才出现）：左边执行 Lua 代码（单个表达式直接显示值，print 和执行期间的日志收进输出，
 * 填了对象路径时代码里的 self 是它的实例表）；右边按路径看全局表，比如纯 Lua 的单例、管理器
 */
export function Lua() {
  const { project, target, go } = useUe()
  const { inst } = useTargetInfo()
  const { ui } = h()
  const { busy, run } = useAction()
  const [code, setCode] = useState('')
  // 左边执行 Lua 的宽度可拖；右边全局表至少留 320px
  const pane = usePane('lua', '55%', 320)
  const left = useRef<HTMLElement>(null)
  const [self, setSelf] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [root, setRoot] = useState<{ keys: LuaKey[]; n: number }>({ keys: [], n: 0 })
  const [pathError, setPathError] = useState('')
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

  const openPath = (s: string) => {
    try {
      setRoot((r) => ({ keys: parseLuaPath(s), n: r.n + 1 }))
      setPathError('')
    } catch (e) {
      setPathError((e as Error).message)
    }
  }

  const body = !inst ? (
    <ui.EmptyPanel>{t('UE 没在运行：Lua 环境要在运行中的编辑器或游戏里')}</ui.EmptyPanel>
  ) : !inst.lua ? (
    <ui.EmptyPanel>
      {t('这个进程的桥接没有编进 Lua 支持：项目里要有 UnLua，并把桥接更新到 1.1.0 以上后重新编译')}
    </ui.EmptyPanel>
  ) : null

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title="Lua" desc={t('UnLua 的 Lua 环境：执行代码、按路径看全局表里的单例和管理器')} />
      {body ? (
        <div className="ue:p-6">{body}</div>
      ) : (
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
          {inst?.lua && !inst.lua.available && (
            <div className="ue:px-6 ue:pt-6">
              <Note>{inst.lua.error || t('现在拿不到 Lua 环境')}</Note>
            </div>
          )}
          <div className={SPLIT_ROW}>
            <Card
              ref={left}
              className={PANE_FIXED}
              style={pane.style('calc(100% - 336px)')}
              title={t('执行 Lua')}
              bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:gap-3 ue:p-3"
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
                placeholder={t('self 对象路径（可选，从运行时对象里复制）')}
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
                <span className="ue:text-caption ue:text-subtle">
                  {t('超过 10 秒自动中止；执行的代码会记进操作记录')}
                </span>
              </div>
            </Card>
            <SplitHandle pane={pane} paneRef={left} reserve={() => 336} />
            <Card className={PANE_FILL} title={t('全局表')} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
              <div className="ue:flex ue:flex-col ue:gap-1 ue:border-b ue:border-line ue:p-3">
                <SearchBox
                  placeholder={t('Lua 路径，例如 GameSystemManager 或 package.loaded["Game.Core"]')}
                  onSearch={openPath}
                  allowEmpty
                />
                <ErrorText>{pathError}</ErrorText>
              </div>
              <LuaTable
                key={root.n}
                path=""
                initial={root.keys}
                onOpen={(p) => go(p.startsWith('/Game') && !p.includes(':') ? 'assets' : 'objects', p)}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
