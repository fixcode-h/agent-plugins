import { ArrowLeft, Info, Loader2, Redo2, Save, TriangleAlert, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getAt, parseScript, versionOf, wrap, type GtPath, type GtStep } from '../../../../shared/gt-script/index.ts'
import { op, ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { Confirm, ErrorText } from '../../../ui.tsx'
import { useApis } from '../gt-api/model.ts'
import { guardsSupported, GUARD_MIN_VERSION } from '../gt-guards/model.ts'
import type { CmdCtx } from './commands.ts'
import { EditContext } from './ctx.ts'
import { Inspector } from './Inspector.tsx'
import { ScriptSettings } from './ScriptSettings.tsx'
import { useScript } from './use-script.ts'
import { allViews } from './views.ts'

/** 编辑页记住上次用的视图（每个人自己的习惯，存浏览器） */
const VIEW_KEY = 'ue.gt.editView'
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) ?? 'list'
  } catch {
    return 'list'
  }
}

/**
 * 场景编辑页（定稿第 9 节）：上面一条工具栏（视图切换、撤销重做、保存），中间是视图，右栏是检查器 / 脚本设置。
 * 视图来自视图注册表，块的样子来自块 UI 注册表，这里只管把它们拼起来、读写文件
 */
export function GtEditor({
  project,
  root,
  scenario,
  live,
  gtVersion,
  onClose,
  onSaved,
}: {
  project: string
  /** 场景根的绝对路径 */
  root: string
  scenario: { name: string; relativePath: string }
  live: boolean
  gtVersion?: string
  onClose: () => void
  onSaved: () => void
}) {
  const { ui, cn } = h()
  const s = useScript({ project, root, path: scenario.relativePath })
  const apis = useApis(project, root, live)
  const [aliases, setAliases] = useState<string[]>([])
  const [view, setView] = useState(readView)
  const [leaving, setLeaving] = useState(false)
  const views = allViews()
  const View = (views.find((v) => v.id === view) ?? views[0]).Component
  const fileVersion = (() => {
    const p = parseScript(s.base)
    return 'doc' in p ? versionOf(p.doc) : 3
  })()

  useEffect(() => {
    void ppost<{ vars: Record<string, unknown> }>(project, 'ext/gt/aliases', { root })
      .then((r) => setAliases(Object.keys(r.vars)))
      .catch(() => setAliases([]))
  }, [project, root])

  const tryStep = useCallback(
    async (path: GtPath) => {
      const step = s.doc && (getAt(s.doc, path) as GtStep | undefined)
      if (!step) return
      try {
        const r = await op<{ ok?: boolean; succeeded?: boolean; message?: string; runId?: string }>(
          project,
          'gt.step',
          {
            step,
            ...(s.doc?.vars ? { vars: s.doc.vars } : {}),
          },
        )
        if (r.runId) h().toast.success(t('块在后台跑了，结果看「最近运行」'))
        else if (r.ok === false || r.succeeded === false) h().toast.error(r.message || t('这一步没通过'))
        else h().toast.success(r.message || t('这一步通过了'))
      } catch (e) {
        h().toast.error((e as Error).message)
      }
    },
    [project, s.doc],
  )

  const save = async () => {
    await s.save()
    onSaved()
  }

  // 整页快捷键：输入框里也要能 Ctrl+S；撤销重做在输入框里交给输入框自己
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (s.dirty && !s.saving) void save()
      } else if (!typing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (!typing && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onTry = live ? (p: GtPath) => void tryStep(p) : undefined
  const cmdCtx: CmdCtx | undefined = s.doc && {
    doc: s.doc,
    selected: s.selected,
    apply: s.apply,
    select: s.select,
    onTry,
  }
  const old = !!gtVersion && !guardsSupported(gtVersion)
  const steps = (s.doc?.steps ?? []) as GtStep[]

  return (
    <EditContext.Provider value={{ project, root, live, doc: s.doc, apis: apis.items, aliases }}>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        <header className="ue:flex ue:min-h-12 ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2">
          <ui.IconButton
            icon={ArrowLeft}
            size="sm"
            label={t('回到运行结果')}
            onClick={() => (s.dirty ? setLeaving(true) : onClose())}
          />
          <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{scenario.name}</span>
          <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{scenario.relativePath}</span>
          <ui.Segmented
            size="sm"
            className="ue:ml-auto"
            label={t('视图')}
            value={view}
            onChange={(v: string) => {
              setView(v)
              try {
                localStorage.setItem(VIEW_KEY, v)
              } catch {
                // 存不了就每次从列表开始
              }
            }}
            options={views.map((v) => ({ id: v.id, label: v.label() }))}
          />
          <ui.IconButton icon={Undo2} size="sm" label={t('撤销（Ctrl+Z）')} disabled={!s.canUndo} onClick={s.undo} />
          <ui.IconButton icon={Redo2} size="sm" label={t('重做（Ctrl+Y）')} disabled={!s.canRedo} onClick={s.redo} />
          <span className="ue:text-caption ue:text-subtle">{s.dirty ? t('改过，没存') : t('已保存')}</span>
          <ui.Button size="sm" disabled={!s.dirty || s.saving} onClick={() => void save()}>
            {s.saving ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <Save className="ue:h-3.5 ue:w-3.5" />
            )}
            {t('保存')}
          </ui.Button>
        </header>
        {old && (
          <p className="ue:flex ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:bg-warning/8 ue:px-4 ue:py-1.5 ue:text-footnote ue:text-warning">
            <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            {t('装着的 GameTest {v} 还不认块、条件和守护：可以先编辑，跑之前到「UE 插件」页升级到 {m} 以上', {
              v: gtVersion,
              m: GUARD_MIN_VERSION,
            })}
          </p>
        )}
        {s.doc && fileVersion < 3 && (
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-accent/6 ue:px-4 ue:py-1.5 ue:text-footnote ue:text-fg">
            <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
            {t('旧格式（v{n}）的场景：保存时整理成 v3、给每步补 id，步骤和行为不变。', { n: fileVersion })}
            {steps.length > 1 && !steps.some((x) => x.action === 'group') && (
              <ui.Button
                size="sm"
                variant="link"
                onClick={() =>
                  s.apply(
                    wrap(
                      s.doc!,
                      steps.map((_, i) => ['steps', i]),
                      'group',
                    ),
                  )
                }
              >
                {t('把主流程包成一段')}
              </ui.Button>
            )}
          </div>
        )}
        {s.error ? (
          <div className="ue:p-4">
            <ErrorText>{s.error}</ErrorText>
          </div>
        ) : !s.doc ? (
          <div className="ue:flex ue:justify-center ue:p-8 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        ) : (
          <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:lg:flex-row ue:lg:overflow-hidden">
            <section className="ue:flex ue:min-h-[50vh] ue:min-w-0 ue:flex-col ue:lg:min-h-0 ue:lg:flex-1">
              <View doc={s.doc} onChange={s.apply} selected={s.selected} onSelect={s.select} onTry={onTry} />
            </section>
            <aside
              className={cn(
                'ue:min-h-0 ue:shrink-0 ue:overflow-auto ue:border-t ue:border-line ue:lg:w-[380px] ue:lg:border-t-0 ue:lg:border-l',
              )}
            >
              {s.selected.length && cmdCtx ? (
                <Inspector doc={s.doc} selected={s.selected} onChange={s.apply} ctx={cmdCtx} onTry={onTry} />
              ) : (
                <ScriptSettings doc={s.doc} onChange={(d) => s.apply(d)} />
              )}
            </aside>
          </div>
        )}
      </div>
      <Confirm
        open={leaving}
        title={t('有改动没存')}
        okText={t('不存，离开')}
        danger
        onOk={() => {
          setLeaving(false)
          onClose()
        }}
        onCancel={() => setLeaving(false)}
      >
        <p className="ue:text-footnote ue:text-fg">{t('离开后这次的改动就丢了。要留着就先点「保存」。')}</p>
      </Confirm>
    </EditContext.Provider>
  )
}
