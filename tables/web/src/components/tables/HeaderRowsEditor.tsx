import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { SHEET_ROLES, type SheetRole } from '@shared/sheet-header'
import { HEADER_MAX_ROWS, type HeaderRow, type HeaderRule } from '@shared/table-header'
import { TYPE_NAMES } from '@shared/tables'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, Select } from '@/components/ui/input'
import { roleLabel, roleShort } from '@/components/files/sheet-roles'

/**
 * 表头配置的编辑：表头是一个「行」的数组，一项对应表格表头的一行，从第几行开始往下排。
 * 每行配：名字、是什么（决定底色和用途）、能填什么（通用枚举），能加、删、上下挪。
 * 项目设置 → 表格 → 表头（项目表头、按文件指定）、表格页的「调整表头」、设置 → 组件里的示例共用
 */
export function HeaderRowsEditor({
  value,
  onChange,
  enumNames,
  last = 1000,
  preview,
}: {
  value: HeaderRule
  onChange: (h: HeaderRule) => void
  /** 通用枚举的名字：「能填什么」的选项；不传就不显示这一列 */
  enumNames?: string[]
  /** 最多能从第几行开始（表的行数） */
  last?: number
  /** 表格页：这一行前几格的字，看得出配的是哪一行 */
  preview?: (r: number) => string
}) {
  const rows = value.rows
  const put = (next: HeaderRow[]) => onChange({ ...value, rows: next })
  const setRow = (i: number, p: Partial<HeaderRow>) =>
    put(
      rows.map((r, j) => {
        if (j !== i) return r
        const x: HeaderRow = { ...r, ...p }
        // 空的名字、不限的取值不存：结构文件里只留设过的
        if (!x.label) delete x.label
        if (!x.values) delete x.values
        return x
      }),
    )
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    put(next)
  }
  // 新加的一行默认「其它」：多出来的行大多是默认值、分组标题这种，用名字写清是什么
  const add = () => put([...rows, { kind: 'other' }])
  const valueOpts = enumNames && [
    { value: '', label: t('不限') },
    { value: TYPE_NAMES, label: t('基础类型和通用枚举名') },
    ...enumNames.map((n) => ({ value: n, label: t('枚举 {e}', { e: n }) })),
  ]
  return (
    <div className="tb:flex tb:flex-col tb:gap-2">
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2 tb:text-footnote tb:text-muted">
        {t('从第')}
        <Input
          size="sm"
          type="number"
          min={1}
          max={last}
          aria-label={t('表头从第几行开始')}
          value={value.start + 1}
          onChange={(e) => onChange({ ...value, start: Math.min(Math.max(1, Number(e.target.value) || 1), last) - 1 })}
          className="tb:w-16 tb:font-mono"
        />
        {rows.length ? t('行开始，共 {n} 行', { n: rows.length }) : t('行开始，还没有表头行（整张表都当数据）')}
      </div>
      {rows.length > 0 && (
        <div className="tb:flex tb:flex-col tb:gap-1.5" role="list" aria-label={t('表头的每一行')}>
          <div className="tb:flex tb:items-center tb:gap-2 tb:text-caption tb:text-subtle" aria-hidden>
            <span className="tb:w-6 tb:shrink-0 tb:text-right">{t('行')}</span>
            <span className="tb:w-3.5 tb:shrink-0" />
            <span className="tb:w-28 tb:shrink-0">{t('名字')}</span>
            <span className="tb:min-w-0 tb:flex-1">{t('是什么（决定底色和用途）')}</span>
            {valueOpts && <span className="tb:w-48 tb:shrink-0">{t('能填什么')}</span>}
            <span className="tb:w-[72px] tb:shrink-0" />
          </div>
          {rows.map((r, i) => {
            const n = value.start + i + 1
            return (
              <div key={i} role="listitem" className="tb:flex tb:items-center tb:gap-2">
                <span
                  className="tb:w-6 tb:shrink-0 tb:text-right tb:font-mono tb:text-caption tb:text-subtle"
                  title={preview?.(value.start + i)}
                >
                  {n}
                </span>
                <span
                  className={cn('tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:rounded-sm sheet-role', `sheet-role-${r.kind}`)}
                />
                <Input
                  size="sm"
                  aria-label={t('第 {n} 行的名字', { n })}
                  placeholder={roleShort(r.kind)}
                  maxLength={20}
                  value={r.label ?? ''}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  className="tb:w-28 tb:shrink-0"
                />
                <div className="tb:min-w-0 tb:flex-1">
                  <Select
                    size="sm"
                    aria-label={t('第 {n} 行是什么', { n })}
                    title={preview?.(value.start + i)}
                    value={r.kind}
                    onChange={(e) => setRow(i, { kind: e.target.value as SheetRole })}
                    options={SHEET_ROLES.map((x) => ({ value: x, label: roleLabel(x) }))}
                  />
                </div>
                {valueOpts && (
                  <div className="tb:w-48 tb:shrink-0">
                    <Select
                      size="sm"
                      aria-label={t('第 {n} 行能填什么', { n })}
                      value={r.values ?? ''}
                      onChange={(e) => setRow(i, { values: e.target.value })}
                      options={valueOpts}
                    />
                  </div>
                )}
                <span className="tb:flex tb:w-[72px] tb:shrink-0 tb:items-center">
                  <IconButton
                    icon={ArrowUp}
                    size="xs"
                    label={t('第 {n} 行往上挪', { n })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="xs"
                    label={t('第 {n} 行往下挪', { n })}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <IconButton
                    icon={X}
                    size="xs"
                    label={t('删掉第 {n} 行', { n })}
                    onClick={() => put(rows.filter((_, j) => j !== i))}
                  />
                </span>
              </div>
            )
          })}
        </div>
      )}
      {rows.length < HEADER_MAX_ROWS && (
        <div>
          <Button size="sm" variant="ghost" onClick={add}>
            <Plus className="tb:h-3.5 tb:w-3.5" />
            {t('加一行表头')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** 一份表头的一句话：「从第 1 行开始：类型 / 字段 / 注释」 */
export function ruleText(h: HeaderRule) {
  return h.rows.length
    ? t('从第 {n} 行开始：{roles}', {
        n: h.start + 1,
        roles: h.rows.map((r) => r.label || roleShort(r.kind)).join(' / '),
      })
    : t('没有表头行')
}
