import { useEffect, useState } from 'react'
import { toast } from '@/lib/toast'
import { BookmarkPlus, Check, Loader2, Palette } from 'lucide-react'
import type { DesignKind, SavedStyle, SavedStyleInput } from '@shared/design'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { ScopeRequests } from '@/components/chat/AskToggle'
import { t } from '@shared/i18n'

/** 风格库里同类（游戏 / 网页）的风格；active 时才去取 */
export function useStyles(kind: DesignKind, active: boolean) {
  const [list, setList] = useState<SavedStyle[] | null>(null)
  useEffect(() => {
    if (!active) return
    api
      .styles()
      .then((l) => {
        const same = l.filter((x) => x.kind === kind)
        setList([...same.filter((x) => !x.builtin), ...same.filter((x) => x.builtin)])
      })
      .catch(() => setList([]))
  }, [kind, active])
  return list
}

/** 风格库的列表：点一下套用到这个设计 */
export function StyleLibraryList({
  kind,
  active,
  current,
  onPick,
}: {
  kind: DesignKind
  active: boolean
  /** 这个设计现在的风格（英文），一样的打勾 */
  current: string
  onPick: (s: SavedStyle) => void
}) {
  const list = useStyles(kind, active)
  if (!list) return <Loader2 className="ud:mx-auto ud:my-2 ud:h-4 ud:w-4 ud:animate-spin ud:text-subtle" />
  if (!list.length)
    return (
      <p className="ud:text-caption ud:leading-relaxed ud:text-subtle">
        {t('风格库还是空的，可以把这个设计的风格存进去。')}
      </p>
    )
  return (
    <div className="ud:flex ud:max-h-48 ud:flex-col ud:gap-1 ud:overflow-y-auto">
      {list.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s)}
          title={s.en}
          className="ud:flex ud:cursor-pointer ud:items-start ud:gap-2 ud:rounded-lg ud:px-2 ud:py-1.5 ud:text-left ud:hover:bg-sel"
        >
          <Palette className="ud:mt-0.5 ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-accent-text" />
          <span className="ud:min-w-0 ud:flex-1">
            <span className="ud:flex ud:items-center ud:gap-1.5 ud:text-footnote">
              <span className="ud:truncate">{s.name}</span>
              {s.builtin && (
                <span className="ud:chip-lift ud:shrink-0 ud:rounded-sm ud:bg-field ud:px-1 ud:text-micro ud:text-subtle">
                  {t('内置')}
                </span>
              )}
            </span>
            {s.summary && (
              <span className="ud:line-clamp-2 ud:text-caption ud:leading-snug ud:text-subtle">{s.summary}</span>
            )}
          </span>
          {current.trim() === s.en.trim() && (
            <Check className="ud:mt-0.5 ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-accent-text" />
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * 「存到风格库」：让 CLI 总结这个设计的整体风格（风格说明、项目提示词、图片描述、对话），
 * 出来后先给用户看、能改名字和说明，确认了再存
 */
export function SaveStyleButton({
  designId,
  kind,
  beforeExtract,
}: {
  designId: string
  kind: DesignKind
  /** 先把没存的改动存下，CLI 读到的才是最新的 */
  beforeExtract: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [scope] = useState(() => crypto.randomUUID())
  const [draft, setDraft] = useState<Omit<SavedStyleInput, 'kind'> | null>(null)
  const [saving, setSaving] = useState(false)

  const extract = async () => {
    if (busy) return
    setBusy(true)
    try {
      await beforeExtract()
      setDraft(await api.extractStyle(designId, scope))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!draft?.name.trim() || saving) return
    setSaving(true)
    try {
      await api.createStyle({ ...draft, kind })
      toast.success(t('已存到风格库'))
      setDraft(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => void extract()} disabled={busy} className="ud:w-full">
        {busy ? (
          <Loader2 className="ud:h-3.5 ud:w-3.5 ud:animate-spin" />
        ) : (
          <BookmarkPlus className="ud:h-3.5 ud:w-3.5" />
        )}
        {busy ? t('AI 正在总结风格…') : t('存到风格库')}
      </Button>
      <ScopeRequests scope={`style:${scope}`} active={busy} className="ud:mt-2 ud:mb-0 ud:max-w-none" />
      <Modal
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={t('存到风格库')}
        footer={
          <>
            <span className="ud:flex-1" />
            <Button variant="secondary" onClick={() => setDraft(null)}>
              {t('取消')}
            </Button>
            <Button onClick={() => void save()} disabled={!draft?.name.trim() || saving}>
              {saving && <Loader2 className="ud:h-3.5 ud:w-3.5 ud:animate-spin" />}
              {t('保存')}
            </Button>
          </>
        }
      >
        <p className="ud:-mt-1 ud:text-footnote ud:leading-relaxed ud:text-muted">
          {t('AI 从这个设计里总结出了下面的风格，可以改一改再存。')}
        </p>
        {draft && (
          <>
            <label className="ud:flex ud:flex-col ud:gap-1 ud:text-footnote ud:text-muted">
              {t('名字')}
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="ud:flex ud:flex-col ud:gap-1 ud:text-footnote ud:text-muted">
              {t('说明')}
              <Textarea
                rows={2}
                value={draft.summary ?? ''}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
            </label>
            <label className="ud:flex ud:flex-col ud:gap-1 ud:text-footnote ud:text-muted">
              {t('发给 AI 的英文描述')}
              <Textarea
                rows={4}
                value={draft.en ?? ''}
                onChange={(e) => setDraft({ ...draft, en: e.target.value })}
                className="ud:font-mono ud:text-footnote"
              />
            </label>
            {!!draft.prompts?.length && (
              <div className="ud:flex ud:flex-wrap ud:gap-1">
                {draft.prompts.map((p, i) => (
                  <span
                    key={i}
                    title={p.en}
                    className="ud:rounded-md ud:bg-field ud:px-1.5 ud:py-0.5 ud:text-caption ud:text-muted"
                  >
                    {p.zh}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  )
}
