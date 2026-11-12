import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { TYPE_NAMES, type TableSchema } from '@shared/tables'
import { enumOptions } from '@shared/table-struct'
import { ruleOf, type HeaderRule } from '@shared/table-header'
import { newTableIssues, newTableRows, type NewColumn } from '@shared/table-create'
import { tablesApi } from '@/lib/tables-api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Field, Input, Select } from '@/components/ui/input'
import { roleShort } from '@/components/files/sheet-roles'

/** 新表格最多加这么多列（弹窗里一列一行，再多就该从别的表复制了） */
const MAX_COLS = 200

/**
 * 新建表格：选表格目录、起文件名，按项目的表头配置给每一列填表头各行（字段名、类型、注释……），
 * 能填什么设成了枚举的行是下拉。确认后服务端写出只有表头的新文件，表格页接着打开它
 */
export function NewTableDialog({
  projectId,
  schema,
  dirs,
  files,
  onCreated,
  onClose,
}: {
  projectId: string
  schema: TableSchema
  /** 表格目录（和表格页文件路径的写法一样，项目目录本身是空字符串） */
  dirs: string[]
  /** 已有的文件：重名提示 */
  files: Set<string>
  onCreated: (path: string) => void
  onClose: () => void
}) {
  // 项目还没配置表头：先只给一行字段名，提示去配置
  const unset = !schema.style.header.rows.length
  const rule: HeaderRule = unset ? ruleOf(['name']) : schema.style.header
  const nameAt = rule.rows.findIndex((r) => r.kind === 'name')
  const blank = (): NewColumn => ({ cells: rule.rows.map(() => '') })
  /** 加一列：修饰、导出端这种大多数列都一样的行照前一列填，字段名、类型、注释空着自己填 */
  const nextCol = (prev?: NewColumn): NewColumn => ({
    cells: rule.rows.map((r, i) => (prev && (r.kind === 'modifier' || r.kind === 'side') ? prev.cells[i] : '')),
  })
  const [dir, setDir] = useState(dirs[0] ?? '')
  const [name, setName] = useState('NewTable.xlsx')
  const [sheet, setSheet] = useState('Sheet1')
  const [cols, setCols] = useState<NewColumn[]>(() => {
    // 第一列默认是主键
    const first = blank()
    if (nameAt >= 0) first.cells[nameAt] = schema.style.key || 'ID'
    // 主键一般是整数：类型行填基础类型里第一个整数类型
    const typeAt = rule.rows.findIndex((r) => r.kind === 'type')
    const int = schema.style.primitives.find((p) => /int/i.test(p))
    if (typeAt >= 0 && int) first.cells[typeAt] = int
    return [first]
  })
  const [busy, setBusy] = useState(false)
  const full = (n: string) => (dir ? `${dir}/${n.trim()}` : n.trim())
  const xlsx = /\.xlsx$/i.test(name.trim())
  const issues = newTableIssues(name, xlsx ? sheet : 'Sheet1', rule, cols, (n) => files.has(full(n)))
  /** 能填什么设了的行：下拉的选项（类型行是基础类型 + 通用枚举名） */
  const options = useMemo(
    () =>
      rule.rows.map((r) => {
        if (!r.values) return null
        const names =
          r.values === TYPE_NAMES
            ? [...schema.style.primitives, ...Object.keys(schema.enums)]
            : enumOptions(schema.enums[r.values]).map((o) => o.name)
        return names.length ? names : null
      }),
    [rule, schema],
  )
  const setCell = (ci: number, ri: number, v: string) =>
    setCols((cs) => cs.map((c, j) => (j === ci ? { cells: c.cells.map((x, k) => (k === ri ? v : x)) } : c)))
  const move = (i: number, d: -1 | 1) =>
    setCols((cs) => {
      const next = [...cs]
      ;[next[i], next[i + d]] = [next[i + d], next[i]]
      return next
    })
  const create = async () => {
    setBusy(true)
    try {
      const rows = newTableRows(rule, cols)
      const r = await tablesApi.create(projectId, {
        path: full(name),
        sheet: sheet.trim() || 'Sheet1',
        rows,
        freeze: rows.length,
      })
      toast.success(t('已新建 {path}', { path: r.path }))
      onCreated(r.path)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('新建表格')}
      size="lg"
      footer={
        <>
          <span
            className="tb:mr-auto tb:min-w-0 tb:truncate tb:text-footnote tb:text-warning"
            title={issues.join('\n')}
          >
            {issues[0] ?? ''}
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button disabled={busy || issues.length > 0} onClick={() => void create()}>
            {t('新建')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3">
        <div className="tb:grid tb:gap-3 tb:sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
          <Field label={t('放在哪个表格目录')}>
            <Select
              size="sm"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              options={dirs.map((d) => ({ value: d, label: d || t('项目目录') }))}
            />
          </Field>
          <Field label={t('文件名')} tip={t('.xlsx、.csv 或 .tsv；可以带子目录，例如 Item/ItemSet.xlsx')}>
            <Input
              size="sm"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="tb:font-mono"
            />
          </Field>
          <Field label={t('工作表名')}>
            <Input size="sm" value={sheet} disabled={!xlsx} maxLength={31} onChange={(e) => setSheet(e.target.value)} />
          </Field>
        </div>
        <p className="tb:text-caption tb:text-subtle">
          {unset
            ? t('项目还没配置表头，先只填字段名；在项目设置 → 表格 → 表头配置好后，这里按表头的每一行填。')
            : t('每一列按项目表头的每一行填，表头从第 {n} 行开始；新表只有表头，数据在表格页里加。', {
                n: rule.start + 1,
              })}
        </p>
        <div className="tb:overflow-x-auto tb:rounded-(--c-card-radius) tb:border">
          <table className="tb:w-full tb:border-collapse tb:text-footnote">
            <thead>
              <tr className="tb:bg-panel">
                <th className="tb:w-8 tb:px-2 tb:py-1.5 tb:text-right tb:font-normal tb:text-subtle">{t('列')}</th>
                {rule.rows.map((r, i) => (
                  <th key={i} className="tb:min-w-36 tb:px-1.5 tb:py-1.5 tb:text-left tb:font-medium">
                    <span className="tb:inline-flex tb:items-center tb:gap-1.5">
                      <span className={cn('tb:h-3 tb:w-3 tb:rounded-[3px] sheet-role', `sheet-role-${r.kind}`)} />
                      {r.label || roleShort(r.kind)}
                    </span>
                  </th>
                ))}
                <th className="tb:w-[72px]" />
              </tr>
            </thead>
            <tbody>
              {cols.map((c, ci) => (
                <tr key={ci} className="tb:border-t">
                  <td className="tb:px-2 tb:py-1 tb:text-right tb:font-mono tb:text-caption tb:text-subtle">
                    {ci + 1}
                  </td>
                  {rule.rows.map((r, ri) => {
                    const label = t('第 {c} 列的{row}', { c: ci + 1, row: r.label || roleShort(r.kind) })
                    const opts = options[ri]
                    return (
                      <td key={ri} className="tb:px-1.5 tb:py-1">
                        {opts ? (
                          <Select
                            size="sm"
                            aria-label={label}
                            value={c.cells[ri] ?? ''}
                            onChange={(e) => setCell(ci, ri, e.target.value)}
                            options={[{ value: '', label: t('（空）') }, ...opts.map((o) => ({ value: o, label: o }))]}
                          />
                        ) : (
                          <Input
                            size="sm"
                            aria-label={label}
                            value={c.cells[ri] ?? ''}
                            onChange={(e) => setCell(ci, ri, e.target.value)}
                            className={cn(r.kind !== 'comment' && 'tb:font-mono')}
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className="tb:px-1 tb:py-1">
                    <span className="tb:flex tb:items-center">
                      <IconButton
                        icon={ArrowUp}
                        size="xs"
                        label={t('第 {n} 列往前挪', { n: ci + 1 })}
                        disabled={ci === 0}
                        onClick={() => move(ci, -1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        size="xs"
                        label={t('第 {n} 列往后挪', { n: ci + 1 })}
                        disabled={ci === cols.length - 1}
                        onClick={() => move(ci, 1)}
                      />
                      <IconButton
                        icon={X}
                        size="xs"
                        label={t('删掉第 {n} 列', { n: ci + 1 })}
                        disabled={cols.length <= 1}
                        onClick={() => setCols((cs) => cs.filter((_, j) => j !== ci))}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={cols.length >= MAX_COLS}
            onClick={() => setCols((cs) => [...cs, nextCol(cs[cs.length - 1])])}
          >
            <Plus className="tb:h-3.5 tb:w-3.5" />
            {t('加一列')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
