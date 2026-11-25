import { Check, Crosshair, History, ListPlus, MessageSquarePlus, Package, Play, Star, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { LuaGmBinding, LuaGmConfig } from '../../../../server/lua-gm/types.ts'
import type { GmRun } from '../../../../server/store.ts'
import { callText, isObjArg, paramNames, SET_VALUE } from '../../../../shared/gm/custom.ts'
import type { GmCustom, GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import type { RefHits } from '../../uekit/gt-ref/live.ts'
import type { GmEntry, GmParam } from '../data.ts'
import { CallForm, SigCard } from '../../../obj-kit/CallForm.tsx'
import { customParams } from './custom-params.ts'
import { CallOutput, Section } from '../../../obj-kit/CallOutput.tsx'
import { AgentBadge, HitBadge, ObjName, ObjRule } from './ObjRule.tsx'
import type { CallOut } from './run-custom.ts'

/** 自定义 GM 自带的对象副本，当成对象列表给对象下拉 */
export const customObjects = (c: GmCustom): GmObject[] =>
  Object.entries(c.objects).map(([name, o]) => ({ name, ...o }) as GmObject)

/** 「会执行」：商店界面.BuyItem(2003, 1, 店主)，对象名画成小块 */
function WillRun({ c, args }: { c: GmCustom; args: Record<string, unknown> }) {
  // 按签名列全部参数：没填的写参数名（灰色），执行时不传、用函数的默认值
  const names = paramNames(c)
  const extra = Object.keys(args).filter((k) => !names.includes(k))
  const parts = [...names, ...extra].map((k) => ({ k, set: k in args, v: args[k] }))
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:bg-field ue:px-3 ue:py-2 ue:text-footnote ue:text-fg">
      {c.kind === 'get' ? (
        <>
          {t('取')} <ObjName name={c.obj} /> {t('命中的每个实例')}
          {(c.props ?? []).length > 0 && <span className="ue:font-mono">{(c.props ?? []).join(', ')}</span>}
        </>
      ) : c.kind === 'set' ? (
        <SetText c={c} value={args[SET_VALUE]} />
      ) : (
        <>
          {/* 写成方法调用的样子：商店界面.BuyItem(2003, 1, 店主) */}
          <ObjName name={c.obj} />
          <span className="ue:font-mono">.{c.function}(</span>
          {parts.map(({ k, set, v }, i) => (
            <span key={k} className="ue:inline-flex ue:items-center ue:gap-1">
              {!set ? (
                <span className="ue:font-mono ue:text-subtle" title={t('执行时填')}>
                  {k}
                </span>
              ) : isObjArg(v) ? (
                <ObjName name={v.$obj} />
              ) : (
                <span className="ue:font-mono">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
              )}
              {i < parts.length - 1 && <span className="ue:font-mono">,</span>}
            </span>
          ))}
          <span className="ue:font-mono">)</span>
        </>
      )}
    </div>
  )
}

/** 改变量的「会执行」：背包.@.Gold = 100，没存值的写「执行时填」 */
function SetText({ c, value }: { c: GmCustom; value: unknown }) {
  return (
    <>
      <ObjName name={c.obj} />
      <span className="ue:font-mono">{c.prop} = </span>
      {value === undefined ? (
        <span className="ue:font-mono ue:text-subtle">{t('执行时填')}</span>
      ) : isObjArg(value) ? (
        <ObjName name={value.$obj} />
      ) : (
        <span className="ue:font-mono">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
      )}
    </>
  )
}

/**
 * GM 页右边：选中一条自定义 GM（规格第 6 节、效果图 1）。说明 → 对象卡（名字 + 匹配规则 + 命中几个 + 改匹配规则）→
 * 调用（签名 + 参数表单，只有「执行时可改」的能改）→ 会执行 → 执行、这组参数加到常用、加到宏、在对象调用里打开、发给对话；
 * 右半边输出和这条 GM 最近的执行
 */
export function CustomDetail(p: {
  c: GmCustom
  moduleName?: string
  args: Record<string, unknown>
  onArg: (name: string, v: unknown) => void
  onArgs: (a: Record<string, unknown>) => void
  hit?: RefHits
  hits: Record<string, RefHits | undefined>
  live: boolean
  running: boolean
  canRun: string
  out?: CallOut
  history: GmRun[]
  fav: boolean
  onRun: () => void
  onFav: () => void
  onMacro: () => void
  onEditRule: () => void
  /** 对象列表里同名对象的规则和这条 GM 的副本不一样时给：把列表里的规则抄过来（B11） */
  onSyncRule?: () => void
  /** 参数预设条（ArgPresets），有可改的参数时才给 */
  presets?: ReactNode
  onOpenObjCall: () => void
  toChat?: (text: string) => void
  gm: GmStore
  config?: LuaGmConfig
  onEditBinding: (entry: GmEntry, p: GmParam, current?: LuaGmBinding, paste?: LuaGmBinding) => void
}) {
  const { ui, cn } = h()
  const c = p.c
  const target = c.objects[c.obj]
  const sig = `(${paramNames(c).join(', ')})`
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:min-h-10 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-1.5">
        <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{c.name}</span>
        <Badge tone="accent">{t('自定义')}</Badge>
        {p.moduleName && (
          <Badge>
            <Package className="ue:mr-1 ue:inline ue:h-3 ue:w-3" />
            {p.moduleName}
          </Badge>
        )}
        {c.by === 'agent' && <AgentBadge />}
        <span className="ue:ml-auto ue:truncate ue:text-caption ue:text-subtle">
          {t('对象调用保存的 GM · 团队共用')}
        </span>
      </header>
      <div className="ue:@container ue:min-h-0 ue:flex-1 ue:overflow-auto">
        <div className="ue:grid ue:items-start ue:gap-5 ue:p-4 ue:@3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-4">
            {c.note && <span className="ue:text-footnote ue:text-muted">{c.note}</span>}
            <Section
              title={t('对象')}
              aside={p.live && target?.ref ? <HitBadge n={p.hit?.count} error={p.hit?.error} /> : undefined}
            >
              <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-3 ue:py-2">
                <ObjName name={c.obj} />
                <span className="ue:min-w-0 ue:flex-1 ue:truncate">
                  {target && <ObjRule o={target} name={c.obj} />}
                </span>
                {target?.ref && (
                  <ui.Button size="sm" variant="ghost" onClick={p.onEditRule}>
                    <Crosshair className="ue:h-3.5 ue:w-3.5" />
                    {t('改匹配规则')}
                  </ui.Button>
                )}
              </div>
              {target?.ref && (
                <p className="ue:mt-1.5 ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
                  {p.onSyncRule
                    ? t('这条 GM 用的是保存时的那份规则，对象列表里的「{n}」后来改过', { n: c.obj })
                    : t('这条 GM 用自己的一份规则，改对象列表里的不影响它')}
                  {p.onSyncRule && (
                    <ui.Button size="sm" variant="ghost" onClick={p.onSyncRule}>
                      {t('从对象列表同步')}
                    </ui.Button>
                  )}
                </p>
              )}
            </Section>
            {c.kind !== 'get' && (
              <Section
                title={c.kind === 'set' ? t('改值') : t('调用')}
                aside={
                  !c.editable.length
                    ? t('参数都是存好的')
                    : paramNames(c).every((n) => c.editable.includes(n))
                      ? t('参数执行时填')
                      : t('只有「执行时可改」的参数能改')
                }
              >
                {c.kind === 'call' && <SigCard sig={{ name: c.function ?? '', sig }} />}
                {p.presets}
                <CallForm
                  fn={c.kind === 'set' ? (c.prop ?? '') : (c.function ?? '')}
                  params={customParams(c)}
                  values={p.args}
                  onChange={p.onArg}
                  editable={c.editable}
                  objects={customObjects(c)}
                  hits={p.hits}
                  live={p.live}
                  gm={p.gm}
                  config={p.config}
                  onEditBinding={p.onEditBinding}
                />
              </Section>
            )}
            <Section title={t('会执行')}>
              <WillRun c={c} args={p.args} />
            </Section>
            <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
              <ui.Button size="sm" disabled={p.running || !!p.canRun} title={p.canRun || undefined} onClick={p.onRun}>
                <Play className="ue:h-3.5 ue:w-3.5" />
                {t('执行')}
              </ui.Button>
              <ui.Button size="sm" variant="secondary" onClick={p.onFav}>
                <Star className={cn('ue:h-3.5 ue:w-3.5', p.fav && 'ue:fill-current ue:text-warning')} />
                {p.fav ? t('移出常用') : t('这组参数加到常用')}
              </ui.Button>
              <ui.Button size="sm" variant="secondary" onClick={p.onMacro}>
                <ListPlus className="ue:h-3.5 ue:w-3.5" />
                {t('加到宏')}
              </ui.Button>
              <ui.Button size="sm" variant="secondary" onClick={p.onOpenObjCall}>
                <Crosshair className="ue:h-3.5 ue:w-3.5" />
                {t('在对象调用里打开')}
              </ui.Button>
              {p.toChat && (
                <ui.Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    p.toChat!(
                      `${t('自定义 GM')}「${c.name}」：${callText(c, p.args)}\n${t('定义')}：${JSON.stringify(c)}${
                        p.out ? `\n${p.out.ok ? JSON.stringify(p.out.invoke) : p.out.error}` : ''
                      }`,
                    )
                  }
                >
                  <MessageSquarePlus className="ue:h-3.5 ue:w-3.5" />
                  {t('发给对话')}
                </ui.Button>
              )}
            </div>
            {p.canRun && <span className="ue:text-caption ue:text-subtle">{p.canRun}</span>}
          </div>
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-4">
            <CallOutput out={p.out} args={p.args} />
            <Section
              title={t('这条 GM 最近的执行')}
              aside={
                p.history.length ? (
                  <>
                    <History className="ue:h-3 ue:w-3" />
                    {t('点一行把参数填回去')}
                  </>
                ) : undefined
              }
            >
              <div className="ue:flex ue:flex-col ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:text-footnote">
                {!p.history.length && <p className="ue:px-3 ue:py-2 ue:text-subtle">{t('还没有执行过')}</p>}
                {p.history.slice(0, 8).map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => !Array.isArray(r.args) && p.onArgs(r.args)}
                    className="ue:flex ue:cursor-pointer ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-3 ue:py-2 ue:text-left ue:last:border-b-0 ue:hover:bg-hover"
                  >
                    <span className="ue:shrink-0 ue:text-subtle ue:tabular-nums">
                      {new Date(r.at).toLocaleTimeString()}
                    </span>
                    {r.ok ? (
                      <Check className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
                    ) : (
                      <X className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
                    )}
                    <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{r.code}</span>
                    <span className="ue:ml-auto ue:max-w-[40%] ue:truncate ue:text-muted">{r.out}</span>
                  </button>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
