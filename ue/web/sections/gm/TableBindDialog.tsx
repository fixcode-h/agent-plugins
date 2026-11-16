import { Table2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { h, t } from '../../host.ts'
import { SearchPick } from './SearchPick.tsx'
import { colsText, demoLoad } from './TablePick.tsx'
import type { TableRow } from './tables.ts'

/** 关联弹窗要读的数据：GM 页里经面板动作调表格插件（tables.ts），设置 →「组件」里给假数据 */
export interface BindLoader {
  /** 按表名找表格 */
  tables: (q: string) => Promise<{ files: string[]; truncated: boolean }>
  /** 一张表的页签、某个页签的列和主键列 */
  shape: (table: string, sheet?: string) => Promise<{ sheets: string[]; sheet: string; fields: string[]; key: string }>
  /** 按关联查行（预览用，和参数下拉同一份） */
  rows: (b: LuaGmBinding, q: string) => Promise<{ rows: TableRow[]; total: number }>
}

/** 名字列的常见写法：选好表后描述列先猜一个，用户可以改 */
const NAME_COLS = ['Name', 'name', 'DisplayName', 'ShowName', 'Title', '名称', '名字', '显示名']
const MAX_EXTRA = 6

/**
 * 参数关联表格（Lua GM、C++ GM 共用）：下拉搜表 → 选页签 → 主列（填进参数的值）→ 描述列 → 辅助描述列（可以多列），
 * 下面预览参数下拉里会是什么样。描述列、辅助描述列都参与搜索，下拉里一眼看出这个值是什么（用户 2026-11-16）
 */
export function TableBindDialog({
  param,
  current,
  hint,
  load,
  onClose,
  onSave,
}: {
  param: string
  current?: LuaGmBinding
  /** 扫描脚本给的提示（Item.Id），有的话能「恢复」 */
  hint?: string
  load: BindLoader
  onClose: () => void
  /** null 去掉关联；undefined 恢复扫描脚本给的 */
  onSave: (b: LuaGmBinding | null | undefined) => void
}) {
  const { ui, cn } = h()
  const [b, setB] = useState<Partial<LuaGmBinding>>(current ?? {})
  const [shape, setShape] = useState<{ sheets: string[]; fields: string[] }>()
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState<{ rows: TableRow[]; total: number }>()

  // 换表、换页签后读列；原来选的列新页签里没有就清掉
  const readShape = async (table: string, sheet: string | undefined, fresh: boolean) => {
    setErr('')
    try {
      const s = await load.shape(table, sheet)
      setShape({ sheets: s.sheets, fields: s.fields })
      setB((cur) => {
        const has = (c?: string) => !!c && s.fields.includes(c)
        const key = !fresh && has(cur.key) ? cur.key! : s.key || (s.fields.includes('Id') ? 'Id' : s.fields[0])
        const label = !fresh && has(cur.label) ? cur.label : NAME_COLS.find((c) => s.fields.includes(c))
        return {
          table,
          sheet: s.sheets.length > 1 ? s.sheet : undefined,
          key,
          ...(label && label !== key ? { label } : {}),
          extra: fresh ? [] : (cur.extra ?? []).filter(has),
        }
      })
    } catch (e) {
      setShape(undefined)
      setErr((e as Error).message)
    }
  }
  useEffect(() => {
    if (current?.table) void readShape(current.table, current.sheet, false)
    // 只在打开时读一次当前关联的表
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ready = !!(b.table && b.key && shape)
  const binding = ready ? (b as LuaGmBinding) : undefined
  const sig = JSON.stringify(binding ?? null)
  // 预览：和参数下拉同一份数据，看描述列选得对不对
  useEffect(() => {
    if (!binding) return setPreview(undefined)
    let live = true
    load.rows(binding, '').then(
      (r) => live && setPreview(r),
      (e: Error) => live && setErr(e.message),
    )
    return () => {
      live = false
    }
    // 按关联内容重查
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const fields = shape?.fields ?? []
  const opts = (list: string[]) => list.map((f) => ({ value: f, label: f }))
  const extra = b.extra ?? []
  const fileName = b.table?.split('/').pop()

  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('参数 {p} 关联表格', { p: param })}
      footer={
        <>
          {hint && (
            <ui.Button variant="ghost" className="ue:mr-auto" onClick={() => onSave(undefined)}>
              {t('恢复扫描脚本给的（{h}）', { h: hint })}
            </ui.Button>
          )}
          {current && (
            <ui.Button variant="secondary" onClick={() => onSave(null)}>
              {t('不关联')}
            </ui.Button>
          )}
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button
            disabled={!binding}
            onClick={() =>
              binding &&
              onSave({
                table: binding.table,
                ...(binding.sheet ? { sheet: binding.sheet } : {}),
                key: binding.key,
                ...(binding.label ? { label: binding.label } : {}),
                ...(extra.length ? { extra } : {}),
              })
            }
          >
            {t('保存')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <ui.Field label={t('表格')} hint={t('按表名搜，表格目录在项目设置 → 表格里设')}>
          <SearchPick
            value={b.table}
            wideKey
            load={async (q) => {
              const r = await load.tables(q)
              return {
                rows: r.files.slice(0, 50).map((f) => ({ key: f, label: '', extra: [] })),
                total: r.files.length,
              }
            }}
            onPick={(r) => void readShape(r.key, undefined, true)}
            searchPlaceholder={t('表名里的几个字')}
            trigger={
              b.table ? (
                <span className="ue:flex ue:items-center ue:gap-1.5">
                  <Table2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                  <span className="ue:truncate ue:font-mono ue:text-fg">{b.table}</span>
                </span>
              ) : (
                <span className="ue:text-subtle">{t('搜表格…')}</span>
              )
            }
            summary={({ q, n, total }) =>
              q ? t('表名含「{q}」· {n} 张', { q, n: total }) : t('前 {n} 张，打字缩小范围', { n })
            }
            empty={t('这个项目还没有表格')}
          />
        </ui.Field>
        {err && <p className="ue:text-footnote ue:text-danger">{err}</p>}
        {shape && (
          <>
            <div className="ue:grid ue:grid-cols-2 ue:gap-3">
              <ui.Field label={t('页签')}>
                <ui.Select
                  value={b.sheet ?? shape.sheets[0] ?? ''}
                  disabled={shape.sheets.length < 2}
                  onChange={(e: { target: { value: string } }) => void readShape(b.table!, e.target.value, false)}
                  options={opts(shape.sheets)}
                />
              </ui.Field>
              <ui.Field label={t('主列')} hint={t('选中后填进参数的值')}>
                <ui.Select
                  value={b.key ?? ''}
                  onChange={(e: { target: { value: string } }) => setB({ ...b, key: e.target.value })}
                  options={opts(fields)}
                />
              </ui.Field>
            </div>
            <ui.Field label={t('描述列')} hint={t('下拉里跟在值后面，一眼看出是什么；也能按它搜')}>
              <ui.Select
                value={b.label ?? ''}
                onChange={(e: { target: { value: string } }) => setB({ ...b, label: e.target.value || undefined })}
                options={[{ value: '', label: t('不用') }, ...opts(fields.filter((f) => f !== b.key))]}
              />
            </ui.Field>
            <ui.Field
              label={t('辅助描述列')}
              hint={t('下拉里多显示的几列（品质、类型…），也能按它们搜；最多 {n} 列', { n: MAX_EXTRA })}
            >
              <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
                {extra.map((c) => (
                  <span
                    key={c}
                    className="ue:inline-flex ue:h-7 ue:items-center ue:gap-1 ue:rounded-md ue:border ue:border-line ue:bg-field ue:pr-1 ue:pl-2 ue:font-mono ue:text-footnote ue:text-fg"
                  >
                    {c}
                    <button
                      type="button"
                      title={t('去掉')}
                      onClick={() => setB({ ...b, extra: extra.filter((x) => x !== c) })}
                      className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
                    >
                      <X className="ue:h-3 ue:w-3" />
                    </button>
                  </span>
                ))}
                {extra.length < MAX_EXTRA && (
                  <ui.Select
                    size="sm"
                    className="ue:w-40"
                    value=""
                    placeholder={t('加一列')}
                    onChange={(e: { target: { value: string } }) =>
                      e.target.value && setB({ ...b, extra: [...extra, e.target.value] })
                    }
                    options={opts(fields.filter((f) => f !== b.key && f !== b.label && !extra.includes(f)))}
                  />
                )}
              </div>
            </ui.Field>
            {binding && (
              <div className="ue:flex ue:flex-col ue:gap-1">
                <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('下拉里会是这样')}</span>
                <div className="ue:rounded-lg ue:border ue:border-line ue:p-1 ue:text-footnote">
                  <div className="ue:flex ue:gap-2 ue:px-2 ue:pt-0.5 ue:pb-1 ue:text-caption ue:text-subtle">
                    <span className="ue:min-w-0 ue:truncate">
                      {t('{file} · 按 {cols} 搜', {
                        file: binding.sheet ? `${fileName} · ${binding.sheet}` : (fileName ?? ''),
                        cols: colsText(binding),
                      })}
                    </span>
                  </div>
                  {(preview?.rows ?? []).slice(0, 5).map((r) => (
                    <div key={r.key} className={cn('ue:flex ue:h-7 ue:items-center ue:gap-3 ue:px-2')}>
                      <span className="ue:w-16 ue:shrink-0 ue:truncate ue:font-mono ue:text-fg">{r.key}</span>
                      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-fg">{r.label}</span>
                      {r.extra.map((x, k) => (
                        <span key={k} className="ue:max-w-28 ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">
                          {x}
                        </span>
                      ))}
                    </div>
                  ))}
                  {preview && !preview.rows.length && (
                    <p className="ue:px-2 ue:py-1.5 ue:text-subtle">{t('这张表没有数据')}</p>
                  )}
                  {!preview && <p className="ue:px-2 ue:py-1.5 ue:text-subtle">{t('正在读…')}</p>}
                </div>
              </div>
            )}
          </>
        )}
        <p className="ue:text-caption ue:text-subtle">{t('存在项目里（团队共用）；Lua GM 的关联优先于扫描脚本给的')}</p>
      </div>
    </ui.Modal>
  )
}

/** 设置 →「组件」里的示例：假的表格目录，不连表格插件 */
const DEMO_TABLES = [
  'Config/Item.xlsx',
  'Config/ItemSet.xlsx',
  'Config/Monster.xlsx',
  'Config/Quest.xlsx',
  'Config/Skill.xlsx',
]
const demoLoader: BindLoader = {
  tables: async (q) => ({
    files: DEMO_TABLES.filter((f) => f.toLowerCase().includes(q.toLowerCase())),
    truncated: false,
  }),
  shape: async (_table, sheet) => ({
    sheets: ['Item', 'ItemEquip'],
    sheet: sheet ?? 'Item',
    fields: ['Id', 'Name', 'Quality', 'Type', 'Icon', 'Price', 'Desc'],
    key: 'Id',
  }),
  rows: async (_b, q) => demoLoad(q),
}
export function TableBindDialogSpecimen() {
  const { ui } = h()
  const [open, setOpen] = useState(false)
  const [b, setB] = useState<LuaGmBinding | undefined>({
    table: 'Config/Item.xlsx',
    sheet: 'Item',
    key: 'Id',
    label: 'Name',
    extra: ['Quality', 'Type'],
  })
  return (
    <div className="ue:flex ue:items-center ue:gap-3">
      <ui.Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Table2 className="ue:h-3.5 ue:w-3.5" /> {t('关联表格…')}
      </ui.Button>
      <span className="ue:text-footnote ue:text-subtle">{b ? colsText(b) : t('没关联')}</span>
      {open && (
        <TableBindDialog
          param="itemId"
          current={b}
          hint="Item.Id"
          load={demoLoader}
          onClose={() => setOpen(false)}
          onSave={(x) => {
            setB(x ?? undefined)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
