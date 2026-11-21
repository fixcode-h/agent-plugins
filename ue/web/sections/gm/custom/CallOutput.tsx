import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { isObjArg } from '../../../../shared/gm/custom.ts'
import { h, t } from '../../../host.ts'
import type { CallOut } from './run-custom.ts'

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ue:flex ue:flex-col ue:gap-2">
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{title}</span>
        {aside && (
          <span className="ue:ml-auto ue:flex ue:items-center ue:gap-1 ue:text-caption ue:text-subtle">{aside}</span>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * 调用的输出（效果图 1、2）：返回值、在哪几个对象上调的、对象参数解析成了谁、耗时；取对象时列每个实例和属性此刻的值。
 * 出错原样显示 UE 给的原因（不重试，面板规则）
 */
export function CallOutput({ out, args }: { out?: CallOut; args?: Record<string, unknown> }) {
  const { cn } = h()
  const box =
    'ue:flex ue:flex-col ue:gap-1 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-3 ue:font-mono ue:text-footnote'
  return (
    <Section title={t('输出')} aside={out ? `${new Date(out.at).toLocaleTimeString()} · ${out.ms} ms` : undefined}>
      {!out ? (
        <p className="ue:rounded-lg ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
          {t('执行后输出显示在这里')}
        </p>
      ) : !out.ok ? (
        <div className={box}>
          <span className="ue:flex ue:items-start ue:gap-1.5 ue:whitespace-pre-wrap ue:text-danger">
            <X className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            {out.error || t('没执行成功')}
          </span>
        </div>
      ) : out.found ? (
        <div className={box}>
          <span className="ue:flex ue:items-center ue:gap-1.5 ue:text-success">
            <Check className="ue:h-3.5 ue:w-3.5" />
            {t('命中 {n} 个', { n: out.found.count })}
          </span>
          {out.found.items.map((it, i) => (
            <div key={i} className="ue:flex ue:flex-col ue:gap-0.5 ue:border-t ue:border-line/60 ue:pt-1">
              <span className="ue:text-fg">{it.name}</span>
              {(it.ident ?? []).map((x) => (
                <span key={x.prop} className="ue:text-muted">
                  {x.prop} = {fmt(x.actual)}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className={box}>
          {out.invoke.map((inv, i) => (
            <span key={i} className={cn('ue:flex ue:items-center ue:gap-1.5 ue:text-success')}>
              <Check className="ue:h-3.5 ue:w-3.5" />
              {inv.returned === undefined ? t('已调用（没有返回值）') : t('返回 {v}', { v: fmt(inv.returned) })}
            </span>
          ))}
          {!out.invoke.length && <span className="ue:text-success">{t('已执行')}</span>}
          {out.invoke.some((x) => x.object) && (
            <span className="ue:text-muted">
              {t('在 {n} 个对象上调用：{list}', {
                n: out.invoke.length,
                list: out.invoke.map((x) => String(x.object ?? '')).join('、'),
              })}
            </span>
          )}
          {/* 对象参数解析成了谁：UE 报告里的 args 是实际传的值（对象写成对象名） */}
          {Object.entries(args ?? {})
            .filter(([, v]) => isObjArg(v) || (typeof v === 'string' && v.startsWith('@')))
            .map(([k]) => {
              const got = (out.invoke[0]?.args as Record<string, unknown> | undefined)?.[k]
              return got === undefined ? null : (
                <span key={k} className="ue:text-muted">
                  {k} → {fmt(got)}
                </span>
              )
            })}
        </div>
      )}
    </Section>
  )
}
