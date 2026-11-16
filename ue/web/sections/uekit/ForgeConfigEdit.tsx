import { CircleAlert, CircleCheck, Loader2, Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { parseDoc } from './forge-doc.ts'

/**
 * 「配置原文」页签里直接编辑（用户 2026-11-16 同意的扩展；原先设计稿 §5 是只读、编辑交给外部编辑器）。
 * - 打开时从磁盘读整份（ext/forge/read，describe 回的原文超长会截断），记下修改时间；保存时带上，
 *   中间被编辑器或 Agent 存过就拒绝，不悄悄覆盖别人的改动。
 * - 边打字边检查 JSON（允许 // 注释），读不懂时标出第几行、不让保存：存一份坏配置只会让左栏变「解析失败」。
 * - 保存后服务端的 forge-watch 推 forge.file，右栏照旧自动重新演练、刷新差异，这里不另外处理。
 * Ctrl/⌘+S 保存，Tab 缩进两格，Esc 不处理（免得误关丢改动，放弃要点按钮）。
 */
export function ForgeConfigEdit({
  project,
  configRoot,
  path,
  onDone,
}: {
  project: string
  configRoot: string
  /** 相对配置根 */
  path: string
  /** 保存成功或放弃：回到只读 */
  onDone: () => void
}) {
  const { ui, cn, toast } = h()
  const [orig, setOrig] = useState<{ text: string; mtime: string }>()
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ppost<{ text: string; mtime: string }>(project, 'ext/forge/read', { root: configRoot, path })
      .then((r) => {
        setOrig(r)
        setText(r.text)
      })
      .catch((e: Error) => setErr(e.message))
  }, [project, configRoot, path])
  const check = useMemo(() => (orig ? parseDoc(text) : undefined), [text, orig])
  const dirty = !!orig && text !== orig.text

  const save = async () => {
    if (!orig || !dirty || !check?.ok || saving) return
    setSaving(true)
    setErr('')
    try {
      await ppost(project, 'ext/forge/save', { root: configRoot, path, text, mtime: orig.mtime })
      toast.success(t('已保存，正在重新演练'))
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: a, selectionEnd: b } = el
      setText(text.slice(0, a) + '  ' + text.slice(b))
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
    }
  }

  if (!orig)
    return err ? (
      <p className="ue:px-5 ue:py-3 ue:text-footnote ue:text-danger">{err}</p>
    ) : (
      <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
        <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
      </div>
    )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <div className="ue:flex ue:items-center ue:gap-2">
        {check?.ok ? (
          <span className="ue:flex ue:items-center ue:gap-1 ue:text-caption ue:text-success">
            <CircleCheck className="ue:h-3.5 ue:w-3.5" />
            {dirty ? t('JSON 没问题，Ctrl+S 保存') : t('还没改动')}
          </span>
        ) : (
          <span
            className="ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:text-caption ue:text-danger"
            title={check && !check.ok ? check.error : undefined}
          >
            <CircleAlert className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            <span className="ue:truncate">
              {check && !check.ok && check.line
                ? t('第 {n} 行附近读不懂：{e}', { n: check.line, e: check.error })
                : t('JSON 读不懂：{e}', { e: check && !check.ok ? check.error : '' })}
            </span>
          </span>
        )}
        <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1.5">
          <ui.Button size="sm" variant="secondary" onClick={onDone}>
            <X className="ue:h-3.5 ue:w-3.5" /> {dirty ? t('放弃修改') : t('不改了')}
          </ui.Button>
          <ui.Button size="sm" disabled={!dirty || !check?.ok || saving} onClick={() => void save()}>
            {saving ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <Save className="ue:h-3.5 ue:w-3.5" />
            )}
            {t('保存')}
          </ui.Button>
        </div>
      </div>
      {err && <p className="ue:text-footnote ue:break-all ue:text-danger">{err}</p>}
      <ui.Textarea
        ref={ref}
        value={text}
        spellCheck={false}
        aria-label={t('配置原文')}
        onChange={(e: { target: { value: string } }) => setText(e.target.value)}
        onKeyDown={onKey}
        className={cn(
          'ue:min-h-[60vh] ue:flex-1 ue:resize-none ue:font-mono ue:text-footnote ue:leading-5 ue:whitespace-pre',
          check && !check.ok && 'ue:border-danger/60',
        )}
      />
    </div>
  )
}
