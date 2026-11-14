import { ScanSearch } from 'lucide-react'
import { t } from '@shared/i18n'
import { diffEmpty, scanName, type EnumScan, type ScanRun } from '@shared/table-enum-scan'
import type { TableEnum } from '@shared/tables'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * 枚举扫描的几块小部件（设置里的规则列表、规则弹窗、枚举对话框共用；设置 → 组件 → 表格里有示例）
 */

/** 枚举名旁边的小标记：这个枚举（的一部分成员）是扫描出来的 */
export function ScanMark({ className }: { className?: string }) {
  return (
    <span title={t('扫描出来的')} className={cn('tb:inline-flex tb:shrink-0 tb:text-subtle', className)}>
      <ScanSearch className="tb:h-3 tb:w-3" aria-label={t('扫描出来的')} />
    </span>
  )
}

/** 写法的显示名 */
export const scanKindLabel = (k: EnumScan['from']['kind']) =>
  ({
    block: t('分组块'),
    rows: t('每行写枚举名'),
    sheets: t('一页一个枚举'),
    cpp: 'C++',
    lua: 'Lua',
    regex: t('正则'),
    command: t('自定义命令'),
  })[k]

/** 枚举对话框里：扫描出来的成员，只读 */
export function ScannedValues({ scanned, scans }: { scanned: NonNullable<TableEnum['scanned']>; scans: EnumScan[] }) {
  const rule = scans.find((s) => s.id === scanned.by)
  return (
    <div className="tb:flex tb:flex-col tb:gap-1.5 tb:rounded-(--c-card-radius) tb:bg-sel/50 tb:px-3 tb:py-2">
      <div className="tb:flex tb:items-center tb:gap-1.5 tb:text-caption tb:text-muted">
        <ScanMark />
        {t('扫描「{name}」得到 {n} 个成员，只读；要改请改源头或扫描规则', {
          name: rule ? scanName(rule) : scanned.by,
          n: scanned.values.length,
        })}
      </div>
      <MemberTable values={scanned.values} max={200} />
    </div>
  )
}

/** 成员表：名字 · 值 · 说明（只读、等宽字） */
export function MemberTable({ values, max = 8 }: { values: TableEnum['values']; max?: number }) {
  return (
    <div className="tb:grid tb:max-h-48 tb:grid-cols-[minmax(0,1.4fr)_4rem_minmax(0,1fr)] tb:gap-x-3 tb:overflow-y-auto tb:text-footnote">
      {values.slice(0, max).map((v) => (
        <div key={v.name} className="tb:contents">
          <span className="tb:truncate tb:font-mono">{v.name}</span>
          <span className="tb:font-mono tb:text-muted tb:tabular-nums">{v.value ?? ''}</span>
          <span className="tb:truncate tb:text-subtle">{v.desc ?? ''}</span>
        </div>
      ))}
      {values.length > max && (
        <span className="tb:col-span-3 tb:text-caption tb:text-subtle">
          {t('还有 {n} 个', { n: values.length - max })}
        </span>
      )}
    </div>
  )
}

/** 试跑 / 扫描的结果：扫出几个枚举、每个前几个成员、提醒和错误、和上次比的变化 */
export function ScanPreview({ run, example }: { run: ScanRun; example?: string }) {
  const names = Object.keys(run.enums)
  const first = example && run.enums[example] ? example : names[0]
  return (
    <div className="tb:flex tb:flex-col tb:gap-2">
      {run.error && <p className="tb:text-footnote tb:text-danger">{run.error}</p>}
      {!run.error && (
        <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-1.5 tb:text-footnote tb:text-muted">
          <span>{t('扫出 {n} 个枚举', { n: names.length })}</span>
          {!diffEmpty(run.diff) && (
            <>
              {run.diff.added.length > 0 && <Badge tone="success">{t('新增 {n}', { n: run.diff.added.length })}</Badge>}
              {run.diff.changed.length > 0 && (
                <Badge tone="accent">{t('有改动 {n}', { n: run.diff.changed.length })}</Badge>
              )}
              {run.diff.removed.length > 0 && (
                <Badge tone="warning">{t('去掉 {n}', { n: run.diff.removed.length })}</Badge>
              )}
            </>
          )}
        </div>
      )}
      {run.warnings.length > 0 && (
        <ul className="tb:flex tb:flex-col tb:gap-0.5 tb:text-caption tb:text-warning">
          {run.warnings.slice(0, 6).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {run.warnings.length > 6 && <li>{t('还有 {n} 条提醒', { n: run.warnings.length - 6 })}</li>}
        </ul>
      )}
      {names.length > 0 && (
        <div className="tb:flex tb:flex-wrap tb:gap-1">
          {names.slice(0, 40).map((n) => (
            <Badge key={n} tone={n === first ? 'accent' : 'neutral'} className="tb:font-mono">
              {n}
              <span className="tb:opacity-70">{run.enums[n].length}</span>
            </Badge>
          ))}
          {names.length > 40 && (
            <span className="tb:text-caption tb:text-subtle">{t('等 {n} 个', { n: names.length })}</span>
          )}
        </div>
      )}
      {first && (
        <div className="tb:rounded-(--c-card-radius) tb:bg-sel/50 tb:px-3 tb:py-2">
          <p className="tb:mb-1 tb:font-mono tb:text-caption tb:text-muted">{first}</p>
          <MemberTable values={run.enums[first]} />
        </div>
      )}
    </div>
  )
}
