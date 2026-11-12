import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { TableEnum, type TableSchema } from '@shared/tables'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'

/**
 * 项目的枚举：左边每个枚举一行，右边它的值（名字、值、说明），以及「从枚举表里取」的设置。
 * 改完点「确定」写进项目的表格结构文件；表格文件不动
 */
export function EnumsDialog({
  open,
  schema,
  initial,
  onOpenChange,
  onSave,
}: {
  open: boolean
  schema: TableSchema
  /** 打开时先选中的枚举 */
  initial?: string
  onOpenChange: (o: boolean) => void
  onSave: (enums: TableSchema['enums']) => void
}) {
  const [enums, setEnums] = useState(schema.enums)
  const names = useMemo(() => Object.keys(enums).sort(), [enums])
  const [sel, setSel] = useState(initial && enums[initial] ? initial : (names[0] ?? ''))
  const [adding, setAdding] = useState('')
  const cur = enums[sel]
  const put = (e: TableEnum) => setEnums((m) => ({ ...m, [sel]: e }))
  const add = () => {
    const n = adding.trim()
    if (!n || enums[n]) return
    setEnums((m) => ({ ...m, [n]: { values: [] } }))
    setSel(n)
    setAdding('')
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('枚举')}
      size="lg"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">
            {t('记在项目的表格结构文件里，表格文件不改')}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button
            onClick={() => {
              onSave(Object.fromEntries(Object.entries(enums).map(([k, v]) => [k, TableEnum.parse(v)])))
              onOpenChange(false)
            }}
          >
            {t('确定')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:min-h-[360px] tb:gap-4">
        <aside className="tb:flex tb:w-[200px] tb:shrink-0 tb:flex-col tb:gap-1 tb:border-r tb:pr-3">
          <div className="tb:flex tb:gap-1">
            <Input
              size="sm"
              placeholder={t('新枚举名')}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
              className="tb:font-mono"
            />
            <IconButton
              icon={Plus}
              label={t('新建枚举')}
              onClick={add}
              disabled={!adding.trim() || !!enums[adding.trim()]}
            />
          </div>
          <div role="listbox" aria-label={t('枚举列表')} className="tb:flex tb:flex-col tb:gap-px tb:overflow-y-auto">
            {names.map((n) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={n === sel}
                onClick={() => setSel(n)}
                className={cn(
                  'tb:flex tb:h-7 tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-row-radius) tb:px-2 tb:text-left tb:font-mono tb:text-footnote',
                  n === sel ? 'tb:bg-sel tb:font-semibold tb:text-fg' : 'tb:text-muted tb:hover:bg-sel/60',
                )}
              >
                <span className="tb:min-w-0 tb:flex-1 tb:truncate">{n}</span>
                <span className="tb:shrink-0 tb:text-caption tb:text-subtle tb:tabular-nums">
                  {enums[n].values.length}
                </span>
              </button>
            ))}
            {!names.length && <p className="tb:px-2 tb:py-4 tb:text-footnote tb:text-subtle">{t('还没有枚举')}</p>}
          </div>
        </aside>
        {!cur ? (
          <p className="tb:flex-1 tb:py-8 tb:text-center tb:text-footnote tb:text-subtle">
            {t('左边新建一个枚举，或者在「列结构」里给某一列指定枚举')}
          </p>
        ) : (
          <section className="tb:flex tb:min-w-0 tb:flex-1 tb:flex-col tb:gap-3">
            <div className="tb:flex tb:items-center tb:gap-2">
              <h3 className="tb:font-mono tb:text-body tb:font-semibold">{sel}</h3>
              <Button
                size="sm"
                variant="ghost"
                className="tb:ml-auto tb:text-danger"
                onClick={() => {
                  setEnums(({ [sel]: _, ...m }) => m)
                  setSel(names.find((n) => n !== sel) ?? '')
                }}
              >
                <Trash2 className="tb:h-3.5 tb:w-3.5" />
                {t('删除这个枚举')}
              </Button>
            </div>
            <div className="tb:grid tb:grid-cols-[1fr_90px_1fr_28px] tb:items-center tb:gap-x-2 tb:gap-y-1 tb:text-footnote">
              <span className="tb:text-caption tb:text-subtle">{t('名字（填进表格的字）')}</span>
              <span className="tb:text-caption tb:text-subtle">{t('值')}</span>
              <span className="tb:text-caption tb:text-subtle">{t('说明')}</span>
              <span />
              {cur.values.map((v, i) => {
                const set = (p: Partial<typeof v>) =>
                  put({ ...cur, values: cur.values.map((x, j) => (j === i ? { ...x, ...p } : x)) })
                return (
                  <div key={i} className="tb:contents">
                    <Input
                      size="sm"
                      value={v.name}
                      onChange={(e) => set({ name: e.target.value })}
                      className="tb:font-mono"
                      aria-label={t('名字')}
                    />
                    <Input
                      size="sm"
                      value={v.value ?? ''}
                      onChange={(e) => set({ value: e.target.value || undefined })}
                      className="tb:font-mono"
                      aria-label={t('值')}
                    />
                    <Input
                      size="sm"
                      value={v.desc ?? ''}
                      onChange={(e) => set({ desc: e.target.value || undefined })}
                      aria-label={t('说明')}
                    />
                    <IconButton
                      icon={Trash2}
                      label={t('删掉这个值')}
                      onClick={() => put({ ...cur, values: cur.values.filter((_, j) => j !== i) })}
                    />
                  </div>
                )
              })}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="tb:self-start"
              onClick={() => put({ ...cur, values: [...cur.values, { name: `Value${cur.values.length + 1}` }] })}
            >
              <Plus className="tb:h-3.5 tb:w-3.5" />
              {t('加一个值')}
            </Button>
            <details className="tb:rounded-lg tb:border tb:px-3 tb:py-2" open={!!cur.source}>
              <summary className="tb:cursor-pointer tb:text-footnote tb:text-muted">{t('从枚举表里取值')}</summary>
              <p className="tb:mt-2 tb:text-caption tb:leading-relaxed tb:text-subtle">
                {t(
                  '项目里有专门的枚举表时，指定它和名字、值、说明在哪几列（按字段名）；表里的值会一起出现在下拉里，上面手写的优先。',
                )}
              </p>
              <div className="tb:mt-2 tb:grid tb:grid-cols-2 tb:gap-2">
                {(
                  [
                    ['file', t('文件'), 'Config/Enum.xlsx'],
                    ['sheet', t('工作表（不填用第一张）'), ''],
                    ['nameCol', t('名字列'), 'Name'],
                    ['valueCol', t('值列'), 'Value'],
                    ['descCol', t('说明列'), 'Desc'],
                  ] as const
                ).map(([k, label, ph]) => (
                  <Field key={k} label={label}>
                    <Input
                      size="sm"
                      placeholder={ph}
                      className="tb:font-mono"
                      value={cur.source?.[k] ?? ''}
                      onChange={(e) => {
                        const src = { file: '', nameCol: '', ...cur.source, [k]: e.target.value || undefined }
                        put({
                          ...cur,
                          source:
                            src.file || src.nameCol
                              ? { ...src, file: src.file ?? '', nameCol: src.nameCol ?? '' }
                              : undefined,
                        })
                      }}
                    />
                  </Field>
                ))}
              </div>
            </details>
          </section>
        )}
      </div>
    </Modal>
  )
}
