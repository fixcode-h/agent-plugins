import { Crosshair, SquareFunction } from 'lucide-react'
import type { LuaGmBinding, LuaGmConfig } from '../../server/lua-gm/types.ts'
import { isObjArg } from '../../shared/gm/custom.ts'
import type { GmObject, GmStore } from '../../shared/gm/schema.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import type { RefHits } from '../sections/uekit/gt-ref/live.ts'
import type { GmEntry, GmParam } from '../sections/gm/data.ts'
import { ParamField } from '../sections/gm/ParamField.tsx'
import { useFitness, type ParamClass } from '../sections/gm/objcall/use-objcall.ts'
import { ObjParamSelect } from '../sections/gm/custom/ObjParamSelect.tsx'

/** 函数的一个参数：obj 有值时是对象参数（UObject，或 Lua 注释写了 Lua 类的） */
export interface CallParam {
  name: string
  type: string
  obj?: ParamClass
}

/** 函数签名卡上的一行（效果图 1、2）：名字、参数、返回、来源 */
export interface CallSig {
  name: string
  sig: string
  src?: string
}

/** 表单里填的文字 → 交给 obj.call 的值：数字、布尔按类型转，像 JSON 的按 JSON，其余原样 */
export function argValue(type: string, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const s = raw.trim()
  if (/^(bool|boolean)$/i.test(type)) return s === 'true'
  if (/int|float|double|number|byte/i.test(type) && s !== '' && !isNaN(Number(s))) return Number(s)
  if (/^[[{]/.test(s)) {
    try {
      return JSON.parse(s)
    } catch {
      // 不是 JSON 就按文字交给 UE
    }
  }
  return raw
}

/** 存着的值 → 表单里显示的文字 */
export const argText = (v: unknown) =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)

export function SigCard({ sig }: { sig: CallSig }) {
  return (
    <div className="ue:flex ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-3 ue:py-2 ue:text-footnote">
      <SquareFunction className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-accent" />
      <span className="ue:font-mono ue:text-fg">{sig.name}</span>
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-subtle" title={sig.sig}>
        {sig.sig}
      </span>
      {sig.src && (
        <span className="ue:ml-auto ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1.5 ue:text-caption ue:text-muted">
          {sig.src}
        </span>
      )}
    </div>
  )
}

function ObjParamRow({
  p,
  value,
  onChange,
  objects,
  hits,
  live,
  onNewRule,
  locked,
}: {
  p: CallParam & { obj: ParamClass }
  value: unknown
  onChange: (v: unknown) => void
  objects: GmObject[]
  hits: Record<string, RefHits | undefined>
  live: boolean
  onNewRule?: (p: CallParam & { obj: ParamClass }) => void
  locked: boolean
}) {
  const { project } = useUe()
  const { ui } = h()
  const why = useFitness(
    project.id,
    live,
    p.obj,
    objects.map((o) => ({ name: o.name, o })),
  )
  return (
    <div className="ue:grid ue:grid-cols-[minmax(96px,30%)_1fr] ue:items-center ue:gap-3">
      <span className="ue:min-w-0 ue:truncate ue:text-footnote">
        <span className="ue:font-mono ue:text-fg">{p.name}</span> <span className="ue:text-subtle">{p.type}</span>
      </span>
      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
        <ObjParamSelect
          value={value}
          onChange={onChange}
          typeName={p.obj.cls}
          objects={objects}
          hits={hits}
          why={why}
          onNewRule={() => onNewRule?.(p)}
          disabled={locked}
        />
        {onNewRule && !locked && (
          <ui.IconButton size="sm" label={t('新的匹配规则…')} onClick={() => onNewRule(p)}>
            <Crosshair className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        )}
      </span>
    </div>
  )
}

/**
 * 调用这一块的参数表单（GM 页的自定义 GM 详情、对象调用的调函数共用，效果图 1、2）：普通参数照 GM 的 ParamField
 * （枚举、布尔下拉，关联表格照旧，关联按「函数名.参数名」存在 gm.json），对象参数出对象下拉。
 * editable 给了时只有里面的参数能改（自定义 GM「执行时可改」），其余只显示存的值
 */
export function CallForm({
  fn,
  params,
  values,
  onChange,
  editable,
  objects,
  hits,
  live,
  onNewRule,
  gm,
  config,
  onEditBinding,
}: {
  fn: string
  params: CallParam[]
  values: Record<string, unknown>
  onChange: (name: string, v: unknown) => void
  editable?: string[]
  objects: GmObject[]
  hits: Record<string, RefHits | undefined>
  live: boolean
  onNewRule?: (p: CallParam & { obj: ParamClass }) => void
  gm: GmStore
  config?: LuaGmConfig
  onEditBinding: (entry: GmEntry, p: GmParam, current?: LuaGmBinding) => void
}) {
  // ParamField 按条目找表格关联：对象函数当成一条 C++ GM，关联键是「函数名.参数名」
  const entry: GmEntry = { key: `fn:${fn}`, src: 'cpp', name: fn, group: '', desc: '', params: [] }
  if (!params.length) return <p className="ue:text-footnote ue:text-subtle">{t('没有参数')}</p>
  return (
    <>
      {params.map((p) => {
        const locked = !!editable && !editable.includes(p.name)
        if (p.obj)
          return (
            <ObjParamRow
              key={p.name}
              p={p as CallParam & { obj: ParamClass }}
              value={values[p.name]}
              onChange={(v) => onChange(p.name, v)}
              objects={objects}
              hits={hits}
              live={live}
              onNewRule={onNewRule}
              locked={locked}
            />
          )
        if (locked)
          return (
            <div key={p.name} className="ue:grid ue:grid-cols-[minmax(96px,30%)_1fr] ue:items-center ue:gap-3">
              <span className="ue:min-w-0 ue:truncate ue:text-footnote">
                <span className="ue:font-mono ue:text-fg">{p.name}</span>{' '}
                <span className="ue:text-subtle">{p.type}</span>
              </span>
              <span
                className="ue:truncate ue:font-mono ue:text-footnote ue:text-muted"
                title={t('保存时没勾「执行时可改」')}
              >
                {isObjArg(values[p.name]) ? (values[p.name] as { $obj: string }).$obj : argText(values[p.name])}
              </span>
            </div>
          )
        return (
          <ParamField
            key={p.name}
            entry={entry}
            p={{ name: p.name, type: p.type }}
            value={argText(values[p.name])}
            onChange={(v) => onChange(p.name, v)}
            config={config}
            gm={gm}
            onEditBinding={(gp, cur) => onEditBinding(entry, gp, cur)}
          />
        )
      })}
    </>
  )
}
