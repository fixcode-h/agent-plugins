import { Crosshair, Pencil, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GmObject } from '../../shared/gm/schema.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Section } from './CallOutput.tsx'
import { RefDialog } from '../sections/uekit/gt-ref/RefDialog.tsx'
import type { Taken } from '../sections/uekit/gt-ref/pick/TakenValue.tsx'
import { ValueBrief, ValueTree } from '../sections/uekit/value/ValueTree.tsx'
import { luaValue, readObjProp, setObjProp, type Grabbed } from './set-prop.ts'
import type { VarSel } from './VarList.tsx'

/** UE 属性：抓来的数组 / 结构体是 JSON，按 JSON 交给 obj.set；其余文字原样给（反射 ImportText 认 UE 写法） */
function ueValue(text: string): unknown {
  if (!/^\s*[[{]/.test(text)) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** 值 → 输入框里的文字：字符串原样，其余写 JSON */
const toText = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))

/**
 * 对象调用右栏「改变量」（用户 2026-11-22）：中栏点一个属性 / Lua 字段后在这里展示，
 * 「当前值」读它此刻的值（和 GM「取对象」同一条路：gt.resolve 带 show，命中几个列几个）；
 * 「抓取值…」打开选对象弹窗（复用 RefDialog 的抓取模式），从运行中的任意对象上取一项此刻的值填进新值；
 * 点「修改」写回（GameTest obj.set，按匹配规则现找对象），改完再读一次给你看结果
 */
export function SetVarPane({
  obj,
  v,
  live,
  canRun,
  onChanged,
}: {
  obj: GmObject
  v?: VarSel
  live: boolean
  canRun: string
  /** 改成功了：中栏列表重读一次 */
  /** 写完（成功或失败）：进调用记录；成功时中栏重读。value 是写进去的文字 */
  onChanged: (r: { ok: boolean; value: string; error?: string }) => void
}) {
  const { ui } = h()
  const { project, target } = useUe()
  const [now, setNow] = useState<{ hits: Grabbed[]; at: string }>()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'read' | 'set'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  const [taking, setTaking] = useState(false)
  // 抓的是对象本身：新值是这个对象（按「类 + 对象名」现找），不是一段文字
  const [objTaken, setObjTaken] = useState<Taken>()
  // 换了变量：值先用列表里读到的，输入框填上它
  useEffect(() => {
    setNow(v?.value !== undefined ? { hits: [{ name: '', value: v.value }], at: '' } : undefined)
    setText(v?.draft ?? toText(v?.value))
    setObjTaken(undefined)
    setMsg(undefined)
    // 只在换变量、换对象时重置；v 每次渲染都是新对象，值变了不覆盖正在填的输入
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.prop, v?.draft, obj.name])
  if (!v) return <p className="ue:text-footnote ue:text-subtle">{t('在中间「属性」或「Lua」里点一个变量')}</p>

  const grab = async (fill: boolean) => {
    setBusy('read')
    try {
      const hits = await readObjProp(project.id, target, obj, v.prop)
      setNow({ hits, at: new Date().toLocaleTimeString() })
      if (fill) setText(toText(hits[0]?.value))
      return true
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
      return false
    } finally {
      setBusy('')
    }
  }
  const write = async () => {
    setBusy('set')
    setMsg(undefined)
    try {
      if (objTaken?.rule) await setObjProp(project.id, target, obj, v.prop, '@obj.__take', { __take: objTaken.rule })
      else await setObjProp(project.id, target, obj, v.prop, v.lua ? luaValue(v.type, text) : ueValue(text))
      setBusy('')
      onChanged({ ok: true, value: objTaken?.rule ? t('（对象）') : text })
      if (await grab(false)) setMsg({ ok: true, text: t('已修改') })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
      onChanged({ ok: false, value: text, error: (e as Error).message })
    } finally {
      setBusy('')
    }
  }
  const block = canRun || (!live ? t('游戏没在运行') : '')
  const bool = /^bool/i.test(v.type)
  return (
    <>
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-3 ue:py-2">
        <Pencil className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
        <span className="ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">{v.name}</span>
        <span className="ue:font-mono ue:text-caption ue:text-subtle">{v.type}</span>
        <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{v.prop}</span>
        {v.lua && <span className="ue:rounded-sm ue:bg-hover ue:px-1 ue:text-caption ue:text-muted">Lua</span>}
      </div>
      <Section
        title={t('当前值')}
        aside={
          <ui.Button size="sm" variant="ghost" disabled={!!busy || !!block} onClick={() => void grab(true)}>
            <RefreshCw className="ue:h-3.5 ue:w-3.5" />
            {busy === 'read' ? t('读取中…') : t('读当前值')}
          </ui.Button>
        }
      >
        {/* 按类型画（ValueTree：和调函数的输出、抓取值弹窗同一套）；匹配规则命中多个时每个实例一块 */}
        <div className="ue:flex ue:max-h-60 ue:flex-col ue:gap-1 ue:overflow-auto ue:rounded-md ue:bg-hover ue:px-1 ue:py-1">
          {(now?.hits.length ? now.hits : [{ name: '', value: undefined }]).map((x, i) => (
            <div key={i} className="ue:flex ue:min-w-0 ue:flex-col">
              {(now && now.hits.length > 1) || (i === 0 && now?.at) ? (
                <span className="ue:flex ue:items-center ue:gap-2 ue:px-1.5 ue:text-caption ue:text-muted">
                  {now && now.hits.length > 1 && <span className="ue:font-mono">{x.name}</span>}
                  {i === 0 && now?.at && <span className="ue:ml-auto ue:text-subtle">{now.at}</span>}
                </span>
              ) : null}
              <ValueTree value={x.value} type={v.type} collapsed />
            </div>
          ))}
        </div>
      </Section>
      {taking && (
        <RefDialog
          project={project.id}
          value={obj.ref}
          take={{
            type: v.type,
            onTake: (x) => {
              if (x.rule) setObjTaken(x)
              else {
                setObjTaken(undefined)
                setText(toText(x.value))
              }
              setTaking(false)
            },
          }}
          onClose={() => setTaking(false)}
        />
      )}
      <ui.Field
        label={t('新值')}
        hint={
          v.readOnly
            ? v.why || t('这个变量只读，不能改')
            : v.lua
              ? t('数字、true / false 直接写；表写 JSON')
              : t('照 UE 的写法填（结构体如 (X=1,Y=2)）')
        }
      >
        <div className="ue:flex ue:items-center ue:gap-2">
          {objTaken ? (
            <div className="ue:flex ue:h-8 ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2.5 ue:font-mono ue:text-footnote">
              <span className="ue:min-w-0 ue:flex-1 ue:truncate">
                <ValueBrief v={objTaken.value} type={v.type} />
              </span>
              <button
                type="button"
                title={t('不用这个对象，改成手填')}
                aria-label={t('不用这个对象，改成手填')}
                onClick={() => setObjTaken(undefined)}
                className="ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
              >
                <X className="ue:h-3.5 ue:w-3.5" />
              </button>
            </div>
          ) : v.enum?.length || bool ? (
            <ui.Select
              value={text}
              disabled={v.readOnly}
              onChange={(e: { target: { value: string } }) => setText(e.target.value)}
              options={(bool ? ['true', 'false'] : v.enum!).map((x) => ({ value: x, label: x }))}
            />
          ) : (
            <ui.Input
              value={text}
              disabled={v.readOnly}
              className="ue:font-mono"
              onChange={(e: { target: { value: string } }) => setText(e.target.value)}
              onKeyDown={(e: { key: string }) => e.key === 'Enter' && !v.readOnly && !busy && !block && void write()}
            />
          )}
          <ui.Button
            size="sm"
            variant="secondary"
            className="ue:shrink-0"
            disabled={v.readOnly}
            title={t('从运行中的对象上取一个值填进来')}
            onClick={() => setTaking(true)}
          >
            <Crosshair className="ue:h-3.5 ue:w-3.5" />
            {t('抓取值…')}
          </ui.Button>
          {/* 「修改」和输入框同一行：当前值再高也不会把它挤出视野（用户 2026-11-22） */}
          <ui.Button
            size="sm"
            className="ue:shrink-0"
            disabled={!!busy || !!block || !!v.readOnly}
            title={block || undefined}
            onClick={() => void write()}
          >
            <Pencil className="ue:h-3.5 ue:w-3.5" />
            {busy === 'set' ? t('修改中…') : t('修改')}
          </ui.Button>
        </div>
      </ui.Field>
      {(block || msg) && (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          {block && <span className="ue:text-caption ue:text-subtle">{block}</span>}
          {msg && (
            <span
              className={msg.ok ? 'ue:text-caption ue:text-success' : 'ue:text-caption ue:break-all ue:text-danger'}
            >
              {msg.text}
            </span>
          )}
        </div>
      )}
    </>
  )
}
