import { Play, Save, ScanSearch, SquareFunction, Variable, X } from 'lucide-react'
import type { LuaGmBinding, LuaGmConfig } from '../../../../server/lua-gm/types.ts'
import type { GmMany, GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { PathChips } from '../../../path-chips/PathChips.tsx'
import type { RefHits } from '../../uekit/gt-ref/live.ts'
import type { GmEntry, GmParam } from '../data.ts'
import { CallForm, SigCard, type CallParam } from '../custom/CallForm.tsx'
import { CallOutput, Section } from '../custom/CallOutput.tsx'
import type { CallOut } from '../custom/run-custom.ts'
import type { FnInfo } from './members.ts'
import type { ParamClass } from './use-objcall.ts'
import { SetVarPane } from './SetVarPane.tsx'
import type { VarSel } from './VarList.tsx'

export type CallMode = 'call' | 'get' | 'set'

const srcLabel = (s: FnInfo['src']) => (s === 'bp' ? t('蓝图') : s === 'lua' ? 'Lua' : 'C++')

/**
 * 对象调用右栏（用户 2026-11-22 重排）：跟着中栏选的走——选函数是调用（签名卡、参数表单、命中多个时怎么办、调用、保存为 GM、输出），
 * 选属性是改值（SetVarPane），对象头卡点「读取…」是读取（要读的属性、读取、保存为 GM）
 */
export function CallPane(p: {
  obj: GmObject
  hit?: RefHits
  mode: CallMode
  /** 改变量：中栏点的那个 */
  varSel?: VarSel
  onVarChanged: (r: { ok: boolean; value: string; error?: string }) => void
  fn?: FnInfo
  values: Record<string, unknown>
  onValue: (name: string, v: unknown) => void
  many: GmMany
  onMany: (m: GmMany) => void
  picked: string[]
  onUnpick: (prop: string) => void
  objects: GmObject[]
  hits: Record<string, RefHits | undefined>
  live: boolean
  running: boolean
  canRun: string
  out?: CallOut
  sentArgs?: Record<string, unknown>
  onRun: () => void
  onSave: () => void
  onNewRule: (param: CallParam & { obj: ParamClass }) => void
  gm: GmStore
  config?: LuaGmConfig
  onEditBinding: (entry: GmEntry, p: GmParam, current?: LuaGmBinding) => void
}) {
  const { ui } = h()
  const multi = (p.hit?.count ?? 0) > 1
  const ready = p.mode === 'get' || (!!p.fn && p.fn.callable)
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-4">
      {/* 选什么做什么（L5）：没有三选一的分段了，标题说清现在是调用、改值还是读取 */}
      <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:font-medium ue:text-muted">
        {p.mode === 'set' ? (
          <Variable className="ue:h-3.5 ue:w-3.5" />
        ) : p.mode === 'get' ? (
          <ScanSearch className="ue:h-3.5 ue:w-3.5" />
        ) : (
          <SquareFunction className="ue:h-3.5 ue:w-3.5" />
        )}
        {p.mode === 'set' ? t('改值') : p.mode === 'get' ? t('读取') : t('调用')}
        <span className="ue:ml-auto ue:text-caption ue:font-normal ue:text-subtle">
          {p.mode === 'get' ? t('在中间「属性」行尾勾要读的') : t('中间选函数就是调用，选属性就是改值')}
        </span>
      </div>
      {p.mode === 'set' ? (
        <SetVarPane obj={p.obj} v={p.varSel} live={p.live} canRun={p.canRun} onChanged={p.onVarChanged} />
      ) : p.mode === 'call' ? (
        p.fn ? (
          <>
            <SigCard sig={{ name: p.fn.name, sig: p.fn.sig, src: srcLabel(p.fn.src) }} />
            <CallForm
              fn={p.fn.name}
              params={p.fn.params}
              values={p.values}
              onChange={p.onValue}
              objects={p.objects}
              hits={p.hits}
              live={p.live}
              onNewRule={p.onNewRule}
              gm={p.gm}
              config={p.config}
              onEditBinding={p.onEditBinding}
            />
          </>
        ) : (
          <p className="ue:rounded-lg ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
            {t('在中间选一个函数来调用，或选一个属性改值')}
          </p>
        )
      ) : (
        <Section title={t('要读的属性')} aside={t('点「读取」读出每个命中实例此刻的值')}>
          <div className="ue:flex ue:flex-wrap ue:gap-1.5">
            {p.picked.map((x) => (
              <span
                key={x}
                className="ue:inline-flex ue:items-center ue:gap-1 ue:rounded-md ue:border ue:border-line ue:px-1.5 ue:py-0.5"
              >
                <PathChips path={x} small />
                <button
                  type="button"
                  aria-label={t('不读这个属性')}
                  onClick={() => p.onUnpick(x)}
                  className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
                >
                  <X className="ue:h-3 ue:w-3" />
                </button>
              </span>
            ))}
            {!p.picked.length && <span className="ue:text-footnote ue:text-subtle">{t('不选就只列命中的实例')}</span>}
          </div>
        </Section>
      )}
      {multi && p.mode === 'call' && (
        <ui.Field label={t('此刻命中 {n} 个', { n: p.hit?.count ?? 0 })}>
          <ui.Segmented
            size="sm"
            label={t('命中多个时')}
            value={p.many}
            onChange={p.onMany}
            options={[
              { id: 'error' as const, label: t('报错') },
              { id: 'first' as const, label: t('只调第一个') },
              { id: 'each' as const, label: t('对每个都调一遍') },
            ]}
          />
        </ui.Field>
      )}
      {p.mode !== 'set' && (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Button
            size="sm"
            disabled={!ready || p.running || !!p.canRun}
            title={p.canRun || undefined}
            onClick={p.onRun}
          >
            <Play className="ue:h-3.5 ue:w-3.5" />
            {p.mode === 'call' ? t('调用') : t('读取')}
          </ui.Button>
          <ui.Button size="sm" variant="secondary" disabled={!ready} onClick={p.onSave}>
            <Save className="ue:h-3.5 ue:w-3.5" />
            {t('保存为 GM')}
          </ui.Button>
          {p.canRun && <span className="ue:text-caption ue:text-subtle">{p.canRun}</span>}
        </div>
      )}
      {p.mode !== 'set' && <CallOutput out={p.out} args={p.sentArgs} />}
    </div>
  )
}
