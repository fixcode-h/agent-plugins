import { Check, ImageOff, Pencil } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import type { GtHint } from './gt-steps.ts'
import { patchStep } from './gt-step-patch.ts'
import type { StepDef } from './GtStepDetail.tsx'

/**
 * 步骤详情里「录制时」一块（GameTest 1.3.2 录制截图）：被点控件那一块截图（红框是被点的控件），
 * 有整屏缩略图时可以切过去看在哪个界面上；OCR 认出的字可以改，改了写进步骤的 note（步骤标题优先用 note），
 * 不改 hint.ocr / hint.text（回放按 text 找控件，不能被手改的名字带偏）。
 */
export interface ShotEdit {
  project: string
  root: string
  path: string
  index: number
  def: StepDef
  onChanged: () => void
}

/** 一张项目里的图：文件被删了（「删除录制截图」）显示一句话，不显示破图 */
export function ShotImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { cn } = h()
  const [missing, setMissing] = useState(false)
  if (missing)
    return (
      <p className="ue:flex ue:items-center ue:gap-1.5 ue:text-subtle">
        <ImageOff className="ue:h-3.5 ue:w-3.5" /> {t('截图已删或还没存好')}
      </p>
    )
  return (
    <img
      alt={alt}
      src={src}
      onError={() => setMissing(true)}
      className={cn('ue:max-w-full ue:rounded-lg ue:border ue:border-line', className)}
    />
  )
}

export function GtRecordShot({
  hint,
  imageUrl,
  edit,
}: {
  hint: GtHint
  imageUrl: (path: string) => string
  /** 能改场景时给（没在跑、不是临时步骤） */
  edit?: ShotEdit
}) {
  const { ui, toast } = h()
  const [view, setView] = useState<'shot' | 'screen'>(hint.shot ? 'shot' : 'screen')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const src = view === 'shot' ? hint.shot : hint.screen

  const save = async () => {
    if (!edit) return
    const note = name.trim()
    setSaving(true)
    try {
      await patchStep(edit, edit.index, edit.def, { note: note || undefined })
      setEditing(false)
      edit.onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      {hint.shot && hint.screen && (
        <ui.Segmented
          size="sm"
          label={t('录制截图')}
          value={view}
          onChange={setView}
          options={[
            { id: 'shot', label: t('点的地方') },
            { id: 'screen', label: t('整个界面') },
          ]}
        />
      )}
      {src && <ShotImage key={src} src={imageUrl(src)} alt={t('录制时的截图')} />}
      <dl className="ue:grid ue:grid-cols-[minmax(64px,auto)_1fr] ue:items-center ue:gap-x-3 ue:gap-y-1.5">
        {(hint.ocr || edit) && (
          <>
            <dt className="ue:text-subtle">{t('认出的字')}</dt>
            <dd className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-fg">
              {editing ? (
                <>
                  <ui.Input
                    size="sm"
                    autoFocus
                    className="ue:min-w-0 ue:flex-1"
                    value={name}
                    placeholder={t('这一步叫什么（写进步骤说明）')}
                    onChange={(e: { target: { value: string } }) => setName(e.target.value)}
                    onKeyDown={(e: { key: string }) => {
                      if (e.key === 'Enter') void save()
                      if (e.key === 'Escape') setEditing(false)
                    }}
                  />
                  <ui.IconButton
                    icon={Check}
                    size="sm"
                    label={t('保存')}
                    disabled={saving}
                    onClick={() => void save()}
                  />
                </>
              ) : (
                <>
                  <span className="ue:min-w-0 ue:truncate">{hint.ocr || t('没认出来')}</span>
                  {edit && (
                    <ui.IconButton
                      icon={Pencil}
                      size="xs"
                      label={t('改名：写进步骤说明')}
                      onClick={() => {
                        setName((typeof edit.def.note === 'string' && edit.def.note) || hint.ocr || '')
                        setEditing(true)
                      }}
                    />
                  )}
                </>
              )}
            </dd>
          </>
        )}
        {hint.opened?.length ? (
          <>
            <dt className="ue:text-subtle">{t('点完打开')}</dt>
            <dd className="ue:min-w-0 ue:break-all ue:font-mono ue:text-fg">{hint.opened.join('、')}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
