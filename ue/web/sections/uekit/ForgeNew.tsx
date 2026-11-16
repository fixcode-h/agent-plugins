import { Copy, FilePlus2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { PathText } from '../../path-text.tsx'
import { KINDS, kindMeta } from './kinds.ts'
import { AssetCheckNote, useAssetCheck } from './ForgeAssetCheck.tsx'
import { ForgeTplList } from './ForgeTplList.tsx'
import { retarget } from './forge-doc.ts'
import { useProjectTemplates } from './forge-project-tpl.ts'
import { aiPrompt } from './forge-prompts.ts'
import { configPathFor, DEFAULT_DIRS, FORGE_TEMPLATES, parseAsset } from './forge-templates.ts'

/**
 * 「新建配置」弹窗（用户 2026-11-16：支持模板创建、提供模板，支持 AI 创建；同日又同意了复制一份、项目模板、同名资产检查）。
 * - 从模板：左边选模板（项目模板在上，内置模板按类型），右边填资产路径和模板要的几项，下面实时看生成的 JSON；
 *   建好写进配置根，页面选中它，右栏按配置预览（资源还没生成）。
 * - 让 AI 写：选类型、填资产路径、写需求，内容放进对话输入框交给 Agent（先取 schema、写完演练、不导入）；
 *   页面盯着要写的那份配置，Agent 存盘后自动选中打开。
 * - 复制一份（右键配置「复制一份…」打开）：读出那份配置的原文，换成新资产路径另存。
 * 配置路径照 AssetForge 的约定由资产路径推出来（/Game/UI/WBP_X ↔ umg/UI/WBP_X.json），不让人另填一份对不上的。
 * 目标资产已经有配置管着时不让建；资产已经存在时提醒先导出纳管（ForgeAssetCheck.tsx）。
 */
export type ForgeNewMode = 'template' | 'ai' | 'copy'

export interface ForgeNewInit {
  mode?: ForgeNewMode
  kind?: string
  /** 预填的资产目录（右键文件夹「在这里新建」）：/Game/UI/ */
  assetDir?: string
  /** 复制一份：源配置（相对配置根）和它的资产 */
  from?: { config: string; kind?: string; asset?: string }
}

export function ForgeNew({
  project,
  configRoot,
  dirOf,
  init,
  canAi,
  managedBy,
  onClose,
  onCreated,
  onAi,
  onOpenConfig,
  onExport,
}: {
  project: string
  configRoot: string
  /** kind → 配置子目录（forge.kinds 给的，拿不到用默认） */
  dirOf: (kind: string) => string
  init?: ForgeNewInit
  /** 面板有「发给对话」时才能让 AI 写 */
  canAi: boolean
  /** 资产路径 → 已经管着它的配置（相对配置根），没有就 undefined */
  managedBy: (asset: string) => string | undefined
  onClose: () => void
  /** 建好了：config 是相对配置根的路径 */
  onCreated: (config: string) => void
  /** 让 AI 写：prompt 交给对话，config 是要盯的那份 */
  onAi: (prompt: string, config: string) => void
  onOpenConfig: (config: string) => void
  /** 资产已经存在：先导出到 JSON 纳管 */
  onExport: (asset: string) => void
}) {
  const { ui } = h()
  const from = init?.from
  const [mode, setMode] = useState<ForgeNewMode>(from ? 'copy' : init?.mode === 'ai' && canAi ? 'ai' : 'template')
  const projectTpls = useProjectTemplates(project, configRoot)
  const all = useMemo(() => [...projectTpls, ...FORGE_TEMPLATES], [projectTpls])
  const firstTpl = FORGE_TEMPLATES.find((x) => x.kind === init?.kind) ?? FORGE_TEMPLATES[0]
  const [tplId, setTplId] = useState(firstTpl.id)
  const tpl = all.find((x) => x.id === tplId) ?? firstTpl
  const [aiKind, setAiKind] = useState(init?.kind && KINDS[init.kind] ? init.kind : 'umg-widget')
  const [asset, setAsset] = useState(init?.assetDir ?? (from?.asset ? `${from.asset}_Copy` : '/Game/'))
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({})
  const [need, setNeed] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 复制一份：源配置的整份原文（describe 回的会截断，走 ext/forge/read）
  const [source, setSource] = useState<string>()
  useEffect(() => {
    if (!from) return
    ppost<{ text: string }>(project, 'ext/forge/read', { root: configRoot, path: from.config })
      .then((r) => setSource(r.text))
      .catch((e: Error) => setErr(e.message))
  }, [project, configRoot, from])

  const kind = mode === 'ai' ? aiKind : mode === 'copy' ? (from?.kind ?? '') : tpl.kind
  const parsed = parseAsset(asset)
  const config = parsed && kind ? configPathFor(dirOf(kind), parsed.asset) : ''
  const check = useAssetCheck(project, parsed?.asset, managedBy)
  const v = useMemo(() => {
    const cur = vals[tpl.id] ?? {}
    return Object.fromEntries((tpl.fields ?? []).map((f) => [f.key, cur[f.key] ?? f.value ?? '']))
  }, [vals, tpl])
  const missing = (tpl.fields ?? []).filter((f) => f.required && !v[f.key]?.trim())
  // 生成的文本：模板和复制一份都在这里算，算不出来（项目模板或源配置读不懂）时 genErr 说原因
  const [text, genErr] = useMemo(() => {
    if (!parsed || mode === 'ai') return ['', '']
    try {
      if (mode === 'copy')
        return source === undefined ? ['', ''] : [json(retarget(source, parsed.asset, parsed.name)), '']
      return [json(tpl.build(parsed.asset, parsed.name, v)), '']
    } catch (e) {
      return ['', t('读不懂这份配置，没法换资产路径：{e}', { e: (e as Error).message })]
    }
  }, [parsed?.asset, mode, source, tpl, v])
  const ready =
    !!parsed &&
    !!config &&
    !check.managedBy &&
    (mode === 'ai' ? !!need.trim() : !!text && (mode === 'copy' || !missing.length))

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr('')
    try {
      if (mode !== 'ai') {
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

  const prefix = mode === 'ai' ? kindPrefix(aiKind) : mode === 'copy' ? '' : tpl.prefix
  const preview = (
    <div className="ue:flex ue:min-h-0 ue:flex-col ue:gap-1">
      <span className="ue:text-caption ue:font-medium ue:text-subtle">{t('生成的配置')}</span>
      <pre className="ue:max-h-56 ue:overflow-auto ue:rounded-md ue:border ue:border-line ue:bg-field ue:p-2 ue:font-mono ue:text-caption ue:text-muted">
        {genErr || text || t('填好资产路径后在这里预览')}
      </pre>
    </div>
  )

  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={mode === 'copy' ? t('复制一份配置') : t('新建 AssetForge 配置')}
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
            {mode === 'ai' ? (
              <Sparkles className="ue:h-3.5 ue:w-3.5" />
            ) : mode === 'copy' ? (
              <Copy className="ue:h-3.5 ue:w-3.5" />
            ) : (
              <FilePlus2 className="ue:h-3.5 ue:w-3.5" />
            )}
            {mode === 'ai' ? t('交给 Agent') : mode === 'copy' ? t('复制') : t('新建')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:min-h-0 ue:flex-col ue:gap-3">
        {canAi && mode !== 'copy' && (
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
        <div
          className={
            mode === 'copy'
              ? 'ue:flex ue:flex-col ue:gap-3'
              : 'ue:grid ue:min-h-0 ue:gap-4 ue:md:grid-cols-[240px_minmax(0,1fr)]'
          }
        >
          {mode === 'template' && (
            <ForgeTplList builtin={FORGE_TEMPLATES} project={projectTpls} value={tpl.id} onChange={setTplId} />
          )}
          {mode === 'ai' && (
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
            {mode === 'copy' && from && (
              <p className="ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:text-footnote ue:text-subtle">
                <span className="ue:shrink-0">{t('从这份复制')}</span>
                <PathText path={from.config} tail={3} className="ue:text-muted" />
              </p>
            )}
            <ui.Field
              label={t('资产路径')}
              hint={
                config ? (
                  <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
                    {t('配置写到')}
                    <PathText path={config} tail={3} copy={false} className="ue:text-muted" />
                  </span>
                ) : (
                  t('像 /Game/UI/{p}Shop 这样的包路径', { p: prefix })
                )
              }
            >
              <ui.Input
                className="ue:font-mono"
                value={asset}
                placeholder={`/Game/.../${prefix}Name`}
                onChange={(e: { target: { value: string } }) => setAsset(e.target.value)}
              />
            </ui.Field>
            <AssetCheckNote
              check={check}
              onOpenConfig={onOpenConfig}
              onExport={() => parsed && onExport(parsed.asset)}
            />
            {mode === 'template' &&
              (tpl.fields ?? []).map((f) => (
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
            {mode === 'ai' ? (
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
            ) : (
              preview
            )}
          </div>
        </div>
      </div>
    </ui.Modal>
  )
}

const json = (doc: unknown) => JSON.stringify(doc, null, 2) + '\n'

/** 让 AI 写时的资产名前缀提示：有模板的照模板 */
const kindPrefix = (kind: string) => FORGE_TEMPLATES.find((x) => x.kind === kind)?.prefix ?? ''

/** kind → 配置子目录：forge.kinds 给的优先（dirKinds 是 目录 → kind），没有用 UEKit 的默认目录 */
export function makeDirOf(dirKinds: Map<string, string>) {
  const rev = new Map([...dirKinds].map(([d, k]) => [k, d]))
  return (kind: string) => rev.get(kind) ?? DEFAULT_DIRS[kind] ?? kind
}
