import { FilePlus2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { PathText } from '../../path-text.tsx'
import { KINDS, kindMeta } from './kinds.ts'
import { configPathFor, DEFAULT_DIRS, FORGE_TEMPLATES, parseAsset, type ForgeTemplate } from './forge-templates.ts'

/**
 * 「新建配置」弹窗（用户 2026-11-16：支持模板创建、提供模板，支持 AI 创建）。
 * - 从模板：左边选模板，右边填资产路径和模板要的几项，下面实时看生成的 JSON；建好写进配置根，页面选中它，
 *   右栏按配置预览（资源还没生成）。
 * - 让 AI 写：选类型、填资产路径、写需求，内容放进对话输入框交给 Agent（先取 schema、写完演练、不导入）；
 *   页面盯着要写的那份配置，Agent 存盘后自动选中打开。
 * 配置路径照 AssetForge 的约定由资产路径推出来（/Game/UI/WBP_X ↔ umg/UI/WBP_X.json），不让人另填一份对不上的。
 */
export type ForgeNewMode = 'template' | 'ai'

export interface ForgeNewInit {
  mode?: ForgeNewMode
  kind?: string
  /** 预填的资产目录（右键文件夹「在这里新建」）：/Game/UI/ */
  assetDir?: string
}

export function ForgeNew({
  project,
  configRoot,
  dirOf,
  init,
  canAi,
  onClose,
  onCreated,
  onAi,
}: {
  project: string
  configRoot: string
  /** kind → 配置子目录（forge.kinds 给的，拿不到用默认） */
  dirOf: (kind: string) => string
  init?: ForgeNewInit
  /** 面板有「发给对话」时才能让 AI 写 */
  canAi: boolean
  onClose: () => void
  /** 模板建好了：config 是相对配置根的路径 */
  onCreated: (config: string) => void
  /** 让 AI 写：prompt 交给对话，config 是要盯的那份 */
  onAi: (prompt: string, config: string) => void
}) {
  const { ui, cn } = h()
  const [mode, setMode] = useState<ForgeNewMode>(init?.mode === 'ai' && canAi ? 'ai' : 'template')
  const firstTpl = FORGE_TEMPLATES.find((x) => x.kind === init?.kind) ?? FORGE_TEMPLATES[0]
  const [tplId, setTplId] = useState(firstTpl.id)
  const tpl = FORGE_TEMPLATES.find((x) => x.id === tplId) ?? firstTpl
  const [aiKind, setAiKind] = useState(init?.kind && KINDS[init.kind] ? init.kind : 'umg-widget')
  const [asset, setAsset] = useState(init?.assetDir ?? '/Game/')
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({})
  const [need, setNeed] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const kind = mode === 'ai' ? aiKind : tpl.kind
  const parsed = parseAsset(asset)
  const config = parsed ? configPathFor(dirOf(kind), parsed.asset) : ''
  const v = useMemo(() => {
    const cur = vals[tpl.id] ?? {}
    return Object.fromEntries((tpl.fields ?? []).map((f) => [f.key, cur[f.key] ?? f.value ?? '']))
  }, [vals, tpl])
  const missing = (tpl.fields ?? []).filter((f) => f.required && !v[f.key]?.trim())
  const text =
    parsed && mode === 'template' ? JSON.stringify(tpl.build(parsed.asset, parsed.name, v), null, 2) + '\n' : ''
  const ready = !!parsed && (mode === 'template' ? !missing.length : !!need.trim())

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr('')
    try {
      if (mode === 'template') {
        const r = await ppost<{ path: string }>(project, 'ext/forge/create', { root: configRoot, path: config, text })
        onCreated(r.path)
      } else {
        // 先把目录建好：页面要盯着这个目录等 Agent 写文件，目录不在盯不了
        const r = await ppost<{ path: string; exists?: boolean }>(project, 'ext/forge/create', {
          root: configRoot,
          path: config,
        })
        if (r.exists) throw new Error(t('已经有这份配置了：{p}，换个资产路径或名字', { p: r.path }))
        onAi(aiPrompt({ kind, asset: parsed!.asset, config: r.path, configRoot, need }), r.path)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, ForgeTemplate[]>()
    for (const x of FORGE_TEMPLATES) m.set(x.kind, [...(m.get(x.kind) ?? []), x])
    return [...m]
  }, [])

  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('新建 AssetForge 配置')}
      footer={
        <>
          {/* 按钮靠右（面板弹窗的习惯）：出错时这里显示原因，平时是空的占位 */}
          <span title={err} className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-danger">
            {err}
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!ready || busy} onClick={() => void submit()}>
            {mode === 'template' ? (
              <FilePlus2 className="ue:h-3.5 ue:w-3.5" />
            ) : (
              <Sparkles className="ue:h-3.5 ue:w-3.5" />
            )}
            {mode === 'template' ? t('新建') : t('交给 Agent')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:min-h-0 ue:flex-col ue:gap-3">
        {canAi && (
          <ui.Segmented
            size="sm"
            label={t('新建方式')}
            value={mode}
            onChange={setMode}
            options={[
              { id: 'template', label: t('从模板') },
              { id: 'ai', label: t('让 AI 写') },
            ]}
          />
        )}
        <div className="ue:grid ue:min-h-0 ue:gap-4 ue:md:grid-cols-[240px_minmax(0,1fr)]">
          {mode === 'template' ? (
            <ul
              aria-label={t('模板')}
              className="ue:flex ue:max-h-[52vh] ue:flex-col ue:gap-0.5 ue:overflow-y-auto ue:rounded-lg ue:border ue:border-line ue:p-1"
            >
              {groups.map(([k, list]) => {
                const m = kindMeta(k)
                return list.map((x, i) => (
                  <li key={x.id}>
                    {i === 0 && (
                      <p className="ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-subtle">
                        {m.label()}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setTplId(x.id)}
                      aria-pressed={x.id === tpl.id}
                      className={cn(
                        'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:px-2 ue:text-left ue:text-body ue:transition-colors ue:hover:bg-sel/60',
                        x.id === tpl.id ? 'ue:bg-sel ue:font-semibold ue:text-fg' : 'ue:text-fg',
                      )}
                    >
                      <m.icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', m.tone)} />
                      <span className="ue:min-w-0 ue:truncate">{x.label()}</span>
                    </button>
                  </li>
                ))
              })}
              <li className="ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:leading-relaxed ue:text-subtle">
                {t(
                  '动画序列、骨骼、骨骼网格体、物理资产要先有资产，在资源页「导出到 JSON」；状态树建议导出一份照着改，或让 AI 写。',
                )}
              </li>
            </ul>
          ) : (
            <div className="ue:flex ue:flex-col ue:gap-3">
              <ui.Field label={t('资产类型')}>
                <ui.Select
                  value={aiKind}
                  onChange={(e: { target: { value: string } }) => setAiKind(e.target.value)}
                  options={Object.keys(KINDS).map((k) => ({ value: k, label: kindMeta(k).label() }))}
                />
              </ui.Field>
              <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
                {t(
                  '内容会放进对话的输入框，你看过再发。Agent 先取这种配置的 schema 和属性表再写，写完演练一遍、不导入；它存盘后这里自动打开那份配置。',
                )}
              </p>
            </div>
          )}
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-3">
            {mode === 'template' && <p className="ue:text-footnote ue:text-subtle">{tpl.desc()}</p>}
            <ui.Field
              label={t('资产路径')}
              hint={
                config ? (
                  <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
                    {t('配置写到')}
                    <PathText path={config} tail={3} copy={false} className="ue:text-muted" />
                  </span>
                ) : (
                  t('像 /Game/UI/{p}Shop 这样的包路径', { p: mode === 'template' ? tpl.prefix : kindPrefix(aiKind) })
                )
              }
            >
              <ui.Input
                className="ue:font-mono"
                value={asset}
                placeholder={`/Game/.../${mode === 'template' ? tpl.prefix : kindPrefix(aiKind)}Name`}
                onChange={(e: { target: { value: string } }) => setAsset(e.target.value)}
              />
            </ui.Field>
            {mode === 'template' ? (
              <>
                {(tpl.fields ?? []).map((f) => (
                  <ui.Field key={f.key} label={f.required ? `${f.label()} *` : f.label()} hint={f.hint?.()}>
                    <ui.Input
                      className="ue:font-mono"
                      value={v[f.key]}
                      placeholder={f.placeholder}
                      onChange={(e: { target: { value: string } }) =>
                        setVals({ ...vals, [tpl.id]: { ...v, [f.key]: e.target.value } })
                      }
                    />
                  </ui.Field>
                ))}
                <div className="ue:flex ue:min-h-0 ue:flex-col ue:gap-1">
                  <span className="ue:text-caption ue:font-medium ue:text-subtle">{t('生成的配置')}</span>
                  <pre className="ue:max-h-56 ue:overflow-auto ue:rounded-md ue:border ue:border-line ue:bg-field ue:p-2 ue:font-mono ue:text-caption ue:text-muted">
                    {text || t('填好资产路径后在这里预览')}
                  </pre>
                </div>
              </>
            ) : (
              <ui.Field label={t('要什么')} hint={t('写清楚用途、结构、关键属性；有参考的资产或配置也写上路径')}>
                <ui.Textarea
                  rows={6}
                  value={need}
                  placeholder={t(
                    '例如：商店界面，顶部标题，中间 3 列商品格子（滚动），底部关闭按钮；样式参考 /Game/UI/WBP_Bag',
                  )}
                  onChange={(e: { target: { value: string } }) => setNeed(e.target.value)}
                />
              </ui.Field>
            )}
          </div>
        </div>
      </div>
    </ui.Modal>
  )
}

/** 让 AI 写时的资产名前缀提示：有模板的照模板 */
const kindPrefix = (kind: string) => FORGE_TEMPLATES.find((x) => x.kind === kind)?.prefix ?? ''

/** 交给 Agent 的话（发给 Agent 的提示词不翻译） */
export function aiPrompt(a: { kind: string; asset: string; config: string; configRoot: string; need: string }) {
  const root = a.configRoot.replace(/\\/g, '/').replace(/\/$/, '')
  return [
    `请新建一份 AssetForge 配置（kind = ${a.kind}），目标资产 ${a.asset}。`,
    `配置文件写到 ${root}/${a.config}（配置根下的 ${a.config}，目录已经建好）。`,
    `需求：${a.need.trim()}`,
    '',
    '做法：',
    `1. 先用 ue_forge action=schema kind=${a.kind} 取这种配置的 JSON Schema；props 里要写的属性用 ue_forge action=schema class=<类> 取属性表照着写，不要猜属性名和取值格式。`,
    `2. 写完用 ue_forge action=plan config=${a.config} 演练，有错误诊断就改到没有为止。`,
    '3. 不要导入（不要 action=import），我在 AssetForge 页看过预览再导入。',
  ].join('\n')
}

/** kind → 配置子目录：forge.kinds 给的优先（dirKinds 是 目录 → kind），没有用 UEKit 的默认目录 */
export function makeDirOf(dirKinds: Map<string, string>) {
  const rev = new Map([...dirKinds].map(([d, k]) => [k, d]))
  return (kind: string) => rev.get(kind) ?? DEFAULT_DIRS[kind] ?? kind
}
