import { Folder, SquareFunction } from 'lucide-react'
import { useState } from 'react'
import { isObjArg } from '../../../../shared/gm/custom.ts'
import type { GmModule } from '../../../../shared/gm/schema.ts'
import { useAsk } from '../../../ask.tsx'
import { Checkbox } from '../../../details/controls.tsx'
import { h, t } from '../../../host.ts'
import { argText } from './CallForm.tsx'
import { ObjName, ObjRule, type ObjLike } from './ObjRule.tsx'

const NEW = '§new'

export interface SaveGmResult {
  name: string
  /** 选的模块 id；新建的模块 newModule 有值（id 由调用方起） */
  module: string
  newModule?: string
  note: string
  editable: string[]
}

/**
 * 「保存为 GM」（规格第 7 节、效果图 4）：名字、模块（必选，下拉末尾「新建模块…」）、分类固定「自定义」、说明、
 * 「存进去的」摘要（对象、函数、每个参数和「执行时可改」）。对象和对象参数存的都是匹配规则，由调用方复制进 custom.objects
 */
export function SaveGmDialog({
  init,
  modules,
  obj,
  fn,
  args,
  props,
  onClose,
  onSave,
}: {
  init: { name: string; note?: string; module?: string; editable?: string[] }
  modules: GmModule[]
  obj: { name: string; o: ObjLike }
  /** 调函数时的函数名；取对象时不给 */
  fn?: string
  args: Record<string, unknown>
  /** 取对象时读的属性 */
  props?: string[]
  onClose: () => void
  onSave: (r: SaveGmResult) => void
}) {
  const { ui } = h()
  const [dialog, ask] = useAsk()
  const [name, setName] = useState(init.name)
  const [note, setNote] = useState(init.note ?? '')
  const [mod, setMod] = useState(init.module ?? modules[0]?.id ?? '')
  const [newMod, setNewMod] = useState<string>()
  // 默认非对象参数都能改：对象参数换了就是另一件事，执行时改它多半是误操作
  const [editable, setEditable] = useState<string[]>(
    init.editable ?? Object.keys(args).filter((k) => !isObjArg(args[k])),
  )
  const opts = [
    ...modules.map((m) => ({ value: m.id, label: m.name })),
    ...(newMod ? [{ value: NEW, label: newMod }] : []),
    { value: '§ask', label: t('＋ 新建模块…') },
  ]
  const ok = name.trim() && (mod === NEW ? !!newMod : !!mod)
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('保存为 GM')}
      footer={
        <>
          <span className="ue:flex-1" />
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button
            disabled={!ok}
            onClick={() =>
              onSave({
                name: name.trim(),
                module: mod === NEW ? '' : mod,
                ...(mod === NEW ? { newModule: newMod } : {}),
                note: note.trim(),
                editable,
              })
            }
          >
            {t('保存')}
          </ui.Button>
        </>
      }
    >
      {dialog}
      <div className="ue:flex ue:flex-col ue:gap-4">
        <ui.Field label={t('名字')}>
          <ui.Input value={name} onChange={(e: { target: { value: string } }) => setName(e.target.value)} />
        </ui.Field>
        <div className="ue:grid ue:grid-cols-2 ue:gap-3">
          <ui.Field label={t('模块')} hint={t('每条 GM 都要放进一个模块，没有合适的就新建')}>
            <ui.Select
              value={mod}
              placeholder={t('选一个模块')}
              onChange={async (e: { target: { value: string } }) => {
                if (e.target.value !== '§ask') return setMod(e.target.value)
                const n = await ask({ title: t('新建模块'), label: t('模块的名字'), init: '' })
                if (!n?.trim()) return
                const hit = modules.find((m) => m.name === n.trim())
                if (hit) return setMod(hit.id)
                setNewMod(n.trim())
                setMod(NEW)
              }}
              options={opts}
            />
          </ui.Field>
          <ui.Field label={t('分类')} hint={t('对象调用保存的 GM 都在「自定义」下')}>
            <div className="ue:flex ue:h-8 ue:items-center ue:gap-1.5 ue:rounded-md ue:bg-hover ue:px-2.5 ue:text-footnote ue:text-muted">
              <Folder className="ue:h-3.5 ue:w-3.5" />
              {t('自定义')}
            </div>
          </ui.Field>
        </div>
        <ui.Field label={t('说明')}>
          <ui.Textarea rows={2} value={note} onChange={(e: { target: { value: string } }) => setNote(e.target.value)} />
        </ui.Field>
        <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-3">
          <span className="ue:text-caption ue:font-medium ue:text-muted">{t('存进去的')}</span>
          <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:text-footnote">
            <span className="ue:w-12 ue:shrink-0 ue:text-subtle">{t('对象')}</span>
            <ObjName name={obj.name} />
            <span className="ue:min-w-0 ue:truncate">
              <ObjRule o={obj.o} small />
            </span>
          </div>
          {fn ? (
            <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote">
              <span className="ue:w-12 ue:shrink-0 ue:text-subtle">{t('函数')}</span>
              <SquareFunction className="ue:h-3.5 ue:w-3.5 ue:text-accent" />
              <span className="ue:font-mono ue:text-fg">{fn}</span>
            </div>
          ) : (
            <div className="ue:flex ue:items-start ue:gap-2 ue:text-footnote">
              <span className="ue:w-12 ue:shrink-0 ue:text-subtle">{t('属性')}</span>
              <span className="ue:min-w-0 ue:font-mono ue:break-all ue:text-fg">
                {(props ?? []).join(', ') || t('只取命中的实例')}
              </span>
            </div>
          )}
          <div className="ue:flex ue:flex-col ue:gap-1 ue:pl-14">
            {Object.entries(args).map(([k, v]) => (
              <div key={k} className="ue:flex ue:items-center ue:gap-2 ue:text-footnote">
                <span className="ue:w-24 ue:truncate ue:font-mono ue:text-muted">{k}</span>
                <span className="ue:w-28 ue:truncate ue:text-fg">
                  {isObjArg(v) ? <ObjName name={v.$obj} /> : <span className="ue:font-mono">{argText(v) || '—'}</span>}
                </span>
                <Checkbox
                  checked={editable.includes(k)}
                  label={t('执行时可改')}
                  onChange={(c) => setEditable(c ? [...editable, k] : editable.filter((x) => x !== k))}
                />
                <span className="ue:text-caption ue:text-muted">{t('执行时可改')}</span>
              </div>
            ))}
          </div>
          <span className="ue:text-caption ue:text-subtle">
            {t('对象和对象参数存的都是匹配规则（类 + 唯一标识），执行时按规则现找')}
          </span>
        </div>
      </div>
    </ui.Modal>
  )
}
