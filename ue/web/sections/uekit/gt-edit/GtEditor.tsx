import { Info, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  getAt,
  parseScript,
  versionOf,
  wrap,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { op, ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { Confirm, ErrorText } from '../../../ui.tsx'
import { useApis } from '../gt-api/model.ts'
import { guardsSupported, GUARD_MIN_VERSION } from '../gt-guards/model.ts'
import type { CmdCtx } from './commands.ts'
import { EditContext } from './ctx.ts'
import { EditorHeader } from './EditorHeader.tsx'
import { Inspector } from './Inspector.tsx'
import { useRecordHere } from './record-here.ts'
import { EditRail } from './rail/EditRail.tsx'
import { RunBanner, type EditRun } from './RunBanner.tsx'
import { ScriptSettings } from './ScriptSettings.tsx'
import { useScript } from './use-script.ts'
import { allViews } from './views.ts'

/** 编辑页记住上次用的视图（每个人自己的习惯，存浏览器） */
const VIEW_KEY = 'ue.gt.editView'
const readView = () => {
  try {
    // 默认流程图（定稿第 9 节、效果图 1）；用过别的视图就记住
    return localStorage.getItem(VIEW_KEY) ?? 'flow'
  } catch {
    return 'flow'
  }
}

/** 场景库里的一项（GameTest 页的场景列表），左栏的脚本库用 */
export interface EditScenario {
  name: string
  relativePath: string
  steps: number
  tags?: string[]
}

/**
 * 场景编辑页（定稿第 9 节、效果图 1）：整页编辑器。上面一条顶栏（面包屑、编写 / 录制、视图切换、目标、保存、试节点、运行），
 * 左栏是节点面板和脚本库，中间是视图，右栏是检查器 / 脚本设置；在跑这个脚本时顶栏下面多一条运行横条。
 * 视图来自视图注册表，块的样子来自块 UI 注册表，节点面板来自面板格子注册表，这里只管把它们拼起来、读写文件
 */
export function GtEditor({
  project,
  root,
  scenario,
  scenarios,
  live,
  gtVersion,
  onClose,
  onSaved,
  onOpen,
  onRecord,
  onRecordHere,
  onRun,
  run,
}: {
  project: string
  /** 场景根的绝对路径 */
  root: string
  scenario: EditScenario
  /** 场景库全部场景（左栏脚本库） */
  scenarios: EditScenario[]
  live: boolean
  gtVersion?: string
  onClose: () => void
  onSaved: () => void
  /** 打开另一个脚本（脚本库里点的） */
  onOpen: (relativePath: string) => void
  /** 开始录制（录成新脚本，放在这个脚本的文件夹里） */
  onRecord?: () => void
  /** 从选中这一步后面接着录（GameTest 1.10.0）：after 是步骤 id；不给时菜单项灰掉 */
  onRecordHere?: (after?: string) => Promise<void> | void
  /** 跑这个脚本：不给 from 跑整个文件，给了就用编辑中的数据从第 index 步跑到底 */
  onRun?: (from?: { doc: GtScript; index: number }) => void
  /** 正在跑这个脚本时的进度 */
  run?: EditRun
}) {
  const { ui } = h()
  const s = useScript({ project, root, path: scenario.relativePath })
  const apis = useApis(project, root, live)
  const [aliases, setAliases] = useState<string[]>([])
  const [view, setView] = useState(readView)
  const [leaving, setLeaving] = useState(false)
  // 有改动时在脚本库里点了另一个脚本：先问一句
  const [switchTo, setSwitchTo] = useState<string>()
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
  const setViewKept = (v: string) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 存不了就每次从流程图开始
    }
  }
  // 跑之前先存盘：UE 跑的是磁盘上的文件
  const runAll =
    onRun &&
    (async () => {
      if (s.dirty) await save()
      onRun()
    })
  const sel = s.selected.length === 1 ? s.selected[0] : undefined
  const topIndex = sel && sel.length === 2 && sel[0] === 'steps' && typeof sel[1] === 'number' ? sel[1] : undefined

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
  const onRecordHereAt = useRecordHere(s, onSaved, live ? onRecordHere : undefined)
  const cmdCtx: CmdCtx | undefined = s.doc && {
    doc: s.doc,
    selected: s.selected,
    apply: s.apply,
    select: s.select,
    onTry,
    onRecordHere: onRecordHereAt,
  }
  const old = !!gtVersion && !guardsSupported(gtVersion)
  const steps = (s.doc?.steps ?? []) as GtStep[]

  return (
    <EditContext.Provider value={{ project, root, live, doc: s.doc, apis: apis.items, aliases }}>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        <EditorHeader
          name={scenario.name}
          folder={scenario.relativePath.split('/').slice(0, -1).join('/')}
          recorded={(scenario.tags ?? []).includes('recorded')}
          onBack={() => (s.dirty ? setLeaving(true) : onClose())}
          views={views}
          view={view}
          onView={setViewKept}
          onRecord={onRecord}
          dirty={s.dirty}
          saving={s.saving}
          onSave={() => void save()}
          onTry={onTry && sel ? () => onTry(sel) : undefined}
          onRun={runAll && !run ? () => void runAll() : undefined}
          onRunFrom={
            onRun && !run && topIndex !== undefined && s.doc ? () => onRun({ doc: s.doc!, index: topIndex }) : undefined
          }
          running={!!run}
        />
        {run && <RunBanner run={run} />}
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
            <EditRail
              doc={s.doc}
              selected={s.selected}
              onChange={s.apply}
              onSelect={s.select}
              scenarios={scenarios}
              current={scenario.relativePath}
              onOpen={(p) => (p === scenario.relativePath ? undefined : s.dirty ? setSwitchTo(p) : onOpen(p))}
            />
            <section className="ue:flex ue:min-h-[50vh] ue:min-w-0 ue:flex-col ue:lg:min-h-0 ue:lg:flex-1">
              <View
                doc={s.doc}
                onChange={s.apply}
                selected={s.selected}
                onSelect={s.select}
                onTry={onTry}
                history={{ undo: s.undo, redo: s.redo, canUndo: s.canUndo, canRedo: s.canRedo }}
              />
            </section>
            <aside className="ue:min-h-0 ue:shrink-0 ue:overflow-auto ue:border-t ue:border-line ue:lg:w-[380px] ue:lg:border-t-0 ue:lg:border-l">
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
      <Confirm
        open={!!switchTo}
        title={t('有改动没存')}
        okText={t('不存，打开那个')}
        danger
        onOk={() => {
          const p = switchTo
          setSwitchTo(undefined)
          if (p) onOpen(p)
        }}
        onCancel={() => setSwitchTo(undefined)}
      >
        <p className="ue:text-footnote ue:text-fg">{t('打开别的脚本，这次的改动就丢了。要留着就先点「保存」。')}</p>
      </Confirm>
    </EditContext.Provider>
  )
}
