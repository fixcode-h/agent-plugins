import { FunctionSquare, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { luaFnIssues } from '../../../../shared/gt-script/luafn/check.ts'
import { LUA_PARAM, type LuaFn } from '../../../../shared/gt-script/luafn/schema.ts'
import { CodeField } from '@panel/web/src/components/ui/code-field'
import { PANE_FILL, PANE_FIXED, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { h, t } from '../../../host.ts'
import { useLuaFns } from './use-luafn.ts'

/** 新函数的名字：库名沿用选中的那个，名字不和已有的撞 */
function freshName(fns: LuaFn[], lib: string) {
  const used = new Set(fns.map((f) => f.name))
  let n = `${lib}.新函数`
  for (let i = 2; used.has(n); i++) n = `${lib}.新函数${i}`
  return n
}

/**
 * GameTest 的 Lua 函数库（用户 2026-11-28：要有专门的地方）：一组普通函数，按「库.名字」分组，没有类结构。
 * 存在文档根的 AgentPanel/UE/gametest-lua.json（和 GM 库同一个目录），脚本函数节点、Lua 代码节点按名字用；
 * 存的时候服务端再检查一遍（类结构、写文件、重名），不对整份不写
 */
export function LuaLibDialog({ project, onClose }: { project: string; onClose: () => void }) {
  const { ui, cn } = h()
  const lib = useLuaFns(project)
  const [draft, setDraft] = useState<LuaFn[]>()
  const [cur, setCur] = useState(0)
  const [saving, setSaving] = useState(false)
  const paneRef = useRef<HTMLElement>(null)
  const pane = usePane('gt-luafn-list', '240px', 180)
  // 第一次读回来时拷一份当草稿：之后外面改了（Agent 改了文件）不覆盖正在改的
  useEffect(() => {
    if (lib.data && !draft) setDraft(lib.data.fns.map((f) => ({ ...f })))
  }, [lib.data, draft])
  const fns = draft ?? []
  const fn = fns[cur]
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(lib.data?.fns ?? [])
  const issues = useMemo(() => fns.map((f) => luaFnIssues(f)), [fns])
  const set = (patch: Partial<LuaFn>) => setDraft(fns.map((f, i) => (i === cur ? { ...f, ...patch } : f)))
  const add = () => {
    const libName = fn?.name.split('.')[0] || '常用'
    setDraft([...fns, { name: freshName(fns, libName), params: [], body: 'return nil\n' }])
    setCur(fns.length)
  }
  const remove = () => {
    setDraft(fns.filter((_, i) => i !== cur))
    setCur(Math.max(0, cur - 1))
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await lib.save({ kind: 'gametest-lua', version: 1, fns })
      setDraft(r.fns.map((f) => ({ ...f })))
      setCur((i) => Math.min(i, Math.max(0, r.fns.length - 1)))
      h().toast.success(t('函数库存好了'))
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const bad = issues.some((x) => x.length)
  const [paramText, setParamText] = useState('')
  useEffect(() => setParamText(fn ? fn.params.join(', ') : ''), [cur, fn?.name]) // oxlint-disable-line react-hooks/exhaustive-deps

  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('Lua 函数库')}
      description={t(
        '测试用的 Lua 写在这里或节点里，不会生成 .lua 文件。一组普通函数，不要写类（setmetatable、A:b 方法）；可以 require 项目已有模块。',
      )}
      footer={
        <>
          <span className="ue:mr-auto ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle" title={lib.data?.file}>
            {lib.data?.file}
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {dirty ? t('不存，关掉') : t('关闭')}
          </ui.Button>
          <ui.Button onClick={() => void save()} disabled={!dirty || saving || bad}>
            {saving ? t('保存中…') : t('保存')}
          </ui.Button>
        </>
      }
    >
      {lib.error && <p className="ue:mb-2 ue:text-caption ue:text-danger">{lib.error}</p>}
      <div className="ue:flex ue:h-[60vh] ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line ue:lg:flex-row">
        <section
          ref={paneRef}
          style={pane.style('45%')}
          className={cn(PANE_FIXED, 'ue:relative ue:flex ue:min-h-0 ue:flex-col ue:border-line ue:lg:border-r')}
        >
          <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
            {fns.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCur(i)}
                className={cn(
                  'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:px-2 ue:py-1 ue:text-left ue:text-footnote',
                  i === cur ? 'ue:bg-accent/10 ue:text-fg' : 'ue:text-muted ue:hover:bg-hover',
                )}
              >
                <FunctionSquare className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                <span className="ue:min-w-0 ue:truncate ue:font-mono">{f.name}</span>
                {issues[i]?.length ? <span className="ue:ml-auto ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full ue:bg-danger" /> : null}
              </button>
            ))}
            {!fns.length && !lib.loading && (
              <p className="ue:p-2 ue:text-footnote ue:text-subtle">{t('还没有函数：点下面「新建函数」')}</p>
            )}
          </div>
          <div className="ue:border-t ue:border-line ue:p-1.5">
            <ui.Button size="sm" variant="ghost" onClick={add}>
              <Plus className="ue:h-3.5 ue:w-3.5" />
              {t('新建函数')}
            </ui.Button>
          </div>
          <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 420} />
        </section>
        <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col ue:gap-2 ue:overflow-auto ue:p-3')}>
          {fn ? (
            <>
              <div className="ue:grid ue:grid-cols-[72px_minmax(0,1fr)] ue:items-center ue:gap-2">
                <span className="ue:text-footnote ue:text-subtle">{t('名字')}</span>
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  value={fn.name}
                  placeholder={t('库.名字，例如 背包.加物品')}
                  onChange={(e: { target: { value: string } }) => set({ name: e.target.value.trim() })}
                />
                <span className="ue:text-footnote ue:text-subtle">{t('参数')}</span>
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  value={paramText}
                  placeholder="itemId, count"
                  onChange={(e: { target: { value: string } }) => {
                    setParamText(e.target.value)
                    set({
                      params: e.target.value
                        .split(/[,，\s]+/)
                        .map((x) => x.trim())
                        .filter((x) => x && LUA_PARAM.test(x)),
                    })
                  }}
                />
                <span className="ue:text-footnote ue:text-subtle">{t('说明')}</span>
                <ui.Input
                  size="sm"
                  value={fn.note ?? ''}
                  placeholder={t('做什么、返回什么（选函数时显示）')}
                  onChange={(e: { target: { value: string } }) => set({ note: e.target.value || undefined })}
                />
              </div>
              <span className="ue:font-mono ue:text-caption ue:text-subtle">
                {`function ${fn.name}(${fn.params.join(', ')})`}
              </span>
              <CodeField
                className="ue:flex-1"
                value={fn.body}
                onChange={(v) => set({ body: v })}
                lang="lua"
                height={220}
                label={t('函数体')}
                onSave={() => void save()}
              />
              <span className="ue:font-mono ue:text-caption ue:text-subtle">end</span>
              {issues[cur]?.length ? (
                <span className="ue:text-caption ue:text-danger">{issues[cur].join('；')}</span>
              ) : null}
              <div>
                <ui.Button size="sm" variant="ghost" onClick={remove}>
                  <Trash2 className="ue:h-3.5 ue:w-3.5" />
                  {t('删掉这个函数')}
                </ui.Button>
              </div>
            </>
          ) : (
            <p className="ue:text-footnote ue:text-subtle">{lib.loading ? t('读取中…') : t('选左边的函数，或新建一个')}</p>
          )}
        </section>
      </div>
    </ui.Modal>
  )
}
