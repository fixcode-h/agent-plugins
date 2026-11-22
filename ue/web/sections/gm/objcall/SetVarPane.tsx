import { Download, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { Section } from '../custom/CallOutput.tsx'
import { luaValue, readObjProp, setObjProp } from './set-prop.ts'
import { valueText, type VarSel } from './VarList.tsx'

/** 值 → 输入框里的文字：字符串原样，其余写 JSON */
const toText = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))

/**
 * 对象调用右栏「改变量」（用户 2026-11-22）：中栏点一个属性 / Lua 字段后在这里展示，
 * 「抓取值」读它此刻的值（gt.props），填新值后点「修改」写回（GameTest obj.set，按匹配规则现找对象），改完再抓一次给你看结果
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
  onChanged: () => void
}) {
  const { ui } = h()
  const { project, target } = useUe()
  const [now, setNow] = useState<{ value: unknown; at: string }>()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'read' | 'set'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  // 换了变量：值先用列表里读到的，输入框填上它
  useEffect(() => {
    setNow(v?.value !== undefined ? { value: v.value, at: '' } : undefined)
    setText(toText(v?.value))
    setMsg(undefined)
    // 只在换变量、换对象时重置；v 每次渲染都是新对象，值变了不覆盖正在填的输入
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.prop, obj.name])
  if (!v) return <p className="ue:text-footnote ue:text-subtle">{t('在中间「属性」或「Lua」里点一个变量')}</p>

  const grab = async (fill: boolean) => {
    setBusy('read')
    try {
      const value = await readObjProp(project.id, target, obj, v.prop, v.name)
      setNow({ value, at: new Date().toLocaleTimeString() })
      if (fill) setText(toText(value))
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
      await setObjProp(project.id, target, obj, v.prop, v.lua ? luaValue(v.type, text) : text)
      setBusy('')
      onChanged()
      if (await grab(false)) setMsg({ ok: true, text: t('已修改') })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
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
          <ui.Button size="sm" variant="secondary" disabled={!!busy || !!block} onClick={() => void grab(true)}>
            <Download className="ue:h-3.5 ue:w-3.5" />
            {busy === 'read' ? t('抓取中…') : t('抓取值')}
          </ui.Button>
        }
      >
        <div className="ue:flex ue:items-center ue:gap-2 ue:rounded-md ue:bg-hover ue:px-2.5 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-fg">
          <span className="ue:min-w-0 ue:flex-1 ue:break-all">{now ? valueText(now.value) || '—' : '—'}</span>
          {now?.at && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{now.at}</span>}
        </div>
      </Section>
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
        {v.enum?.length || bool ? (
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
      </ui.Field>
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
        <ui.Button
          size="sm"
          disabled={!!busy || !!block || !!v.readOnly}
          title={block || undefined}
          onClick={() => void write()}
        >
          <Pencil className="ue:h-3.5 ue:w-3.5" />
          {busy === 'set' ? t('修改中…') : t('修改')}
        </ui.Button>
        {block && <span className="ue:text-caption ue:text-subtle">{block}</span>}
        {msg && (
          <span className={msg.ok ? 'ue:text-caption ue:text-success' : 'ue:text-caption ue:break-all ue:text-danger'}>
            {msg.text}
          </span>
        )}
      </div>
    </>
  )
}
