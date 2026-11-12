import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FileSpreadsheet, Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { cellRef } from '@shared/table-edit'
import type { ReplaceFile, ReplaceResult } from '@shared/table-search'
import { tablesApi } from '@/lib/tables-api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import type { SearchFlags } from './use-content-search'

/**
 * 跨表批量替换（左栏「内容」搜索的「替换…」）：先预览每个文件改几格、前几处改前改后，
 * 服务端把保存前的检查都试过一遍，会被拒绝的文件（正被 Excel 打开、公式格、表格太大……）直接标出原因、不能勾；
 * 有没保存改动的文件也不能勾。勾选后逐个文件原地保存（只改格子、先备份），失败的列出原因，不影响别的文件。
 * 预览之后又改了查找、替换或开关，要重新预览才能替换：写进去的一定是看过的
 */
export function ReplaceAllDialog({
  projectId,
  query,
  flags,
  dirty,
  onClose,
  onApplied,
}: {
  projectId: string
  /** 搜索框里的字（可以是「字段名:值」） */
  query: string
  flags: SearchFlags
  /** 表格页里有没保存改动的文件 */
  dirty: Set<string>
  onClose: () => void
  /** 改过的文件：表格页重新载入、重新搜索 */
  onApplied: (paths: string[]) => void
}) {
  const [find, setFind] = useState(query.trim())
  const [repl, setRepl] = useState('')
  const [opts, setOpts] = useState<SearchFlags>(flags)
  const [preview, setPreview] = useState<{ key: string; r: ReplaceResult } | null>(null)
  const [done, setDone] = useState<ReplaceResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'' | 'preview' | 'apply'>('')
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const key = JSON.stringify([find, repl, opts])
  const fresh = !!preview && preview.key === key
  const blockedOf = (f: ReplaceFile) =>
    f.blocked ?? (dirty.has(f.path) ? t('这个文件有没保存的改动，先保存或撤销再替换') : '')

  const runPreview = async () => {
    if (!find.trim() || busy) return
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setBusy('preview')
    setError('')
    setDone(null)
    try {
      const r = await tablesApi.replace(projectId, { q: find, replace: repl, ...opts, apply: false }, ac.signal)
      setPreview({ key, r })
      setPicked(new Set(r.files.filter((f) => !blockedOf(f)).map((f) => f.path)))
      setOpen(new Set())
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message)
    } finally {
      if (abort.current === ac) setBusy('')
    }
  }
  const apply = async () => {
    if (!preview || !fresh || !picked.size) return
    setBusy('apply')
    setError('')
    try {
      const files = Object.fromEntries(preview.r.files.filter((f) => picked.has(f.path)).map((f) => [f.path, f.mtime]))
      const r = await tablesApi.replace(projectId, { q: find, replace: repl, ...opts, apply: true, files })
      setDone(r)
      onApplied(r.files.map((f) => f.path))
      const cells = r.files.reduce((n, f) => n + f.cells, 0)
      if (r.files.length) toast.success(t('已在 {n} 个文件里替换 {m} 格', { n: r.files.length, m: cells }))
      if (!r.failed.length) onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const files = preview?.r.files ?? []
  const sum = useMemo(() => {
    const on = files.filter((f) => picked.has(f.path))
    return { files: on.length, cells: on.reduce((n, f) => n + f.cells, 0) }
  }, [files, picked])
  const pickable = files.filter((f) => !blockedOf(f))
  const toggle = (set: Set<string>, p: string) => {
    const n = new Set(set)
    if (n.has(p)) n.delete(p)
    else n.add(p)
    return n
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && busy !== 'apply' && onClose()}
      title={t('在所有表格里替换')}
      size="lg"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle" aria-live="polite">
            {preview && fresh
              ? t('勾选了 {files} 个文件，共 {cells} 格', sum)
              : preview
                ? t('改了查找或替换的内容，重新预览后才能替换')
                : ''}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={busy === 'apply'}>
            {t('取消')}
          </Button>
          <Button variant="secondary" onClick={runPreview} disabled={!find.trim() || !!busy}>
            {busy === 'preview' && <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />}
            {t('预览')}
          </Button>
          <Button onClick={apply} disabled={!fresh || !sum.files || !!busy}>
            {busy === 'apply' && <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />}
            {t('替换 {n} 个文件', { n: sum.files })}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3">
        <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
          <Field label={t('查找')} tip={t('写成「字段名:值」只在这一列里换')}>
            <Input
              autoFocus={!find}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runPreview()}
              className="tb:font-mono"
            />
          </Field>
          <Field label={t('替换为')}>
            <Input
              autoFocus={!!find}
              value={repl}
              onChange={(e) => setRepl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runPreview()}
              className="tb:font-mono"
              placeholder={t('留空就是清掉找到的字')}
            />
          </Field>
        </div>
        <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-x-4 tb:gap-y-2">
          <Checkbox
            checked={!!opts.caseSensitive}
            onChange={(v) => setOpts({ ...opts, caseSensitive: v })}
            label={t('区分大小写')}
          />
          <Checkbox
            checked={!!opts.whole}
            onChange={(v) => setOpts({ ...opts, whole: v })}
            label={t('整格匹配')}
            tip={t('格子和要找的完全一样才换；数组列（1001;1002）里某一项一样时只换那一项')}
          />
          <Checkbox
            checked={!!opts.regex}
            onChange={(v) => setOpts({ ...opts, regex: v })}
            label={t('正则')}
            tip={t('替换里可以用 $1 引用括号里的内容')}
          />
        </div>
        <p className="tb:text-caption tb:text-subtle">
          {t('只改数据行，表头（字段名、类型这些行）不动；每个文件改之前都会备份，文件格式不变。')}
        </p>
        {error && <p className="tb:text-footnote tb:text-danger">{error}</p>}
        {preview?.r.field && (
          <p className="tb:text-caption tb:text-subtle">
            {t('只在字段 {field} 这一列里换', { field: preview.r.field })}
          </p>
        )}
        {preview?.r.fieldMissing && (
          <p className="tb:text-caption tb:text-warning">
            {t('没有哪张表有字段 {field}，按整串找了', { field: preview.r.fieldMissing })}
          </p>
        )}
        {done && done.failed.length > 0 && <FailedList failed={done.failed} />}
        {preview && !done && (
          <div
            role="list"
            aria-label={t('替换预览')}
            aria-busy={busy === 'preview'}
            className={cn(
              'thin-scroll tb:flex tb:max-h-[360px] tb:flex-col tb:overflow-y-auto tb:rounded-(--c-row-radius) tb:border',
              !fresh && 'tb:opacity-60',
            )}
          >
            {!files.length && (
              <p className="tb:px-3 tb:py-4 tb:text-center tb:text-footnote tb:text-subtle">{t('没有要替换的格子')}</p>
            )}
            {pickable.length > 1 && (
              <div className="tb:border-b tb:px-3 tb:py-1.5">
                <Checkbox
                  checked={picked.size === pickable.length}
                  onChange={(v) => setPicked(new Set(v ? pickable.map((f) => f.path) : []))}
                  label={<span className="tb:text-footnote">{t('全选（{n} 个文件）', { n: pickable.length })}</span>}
                />
              </div>
            )}
            {files.map((f) => (
              <ReplaceRow
                key={f.path}
                file={f}
                blocked={blockedOf(f)}
                checked={picked.has(f.path)}
                onCheck={() => setPicked((s) => toggle(s, f.path))}
                expanded={open.has(f.path)}
                onExpand={() => setOpen((s) => toggle(s, f.path))}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 预览里的一个文件：勾选框、文件名、改几格、不合规几处；展开看前几处改前改后；写不了的标出原因 */
function ReplaceRow({
  file: f,
  blocked,
  checked,
  onCheck,
  expanded,
  onExpand,
}: {
  file: ReplaceFile
  blocked: string
  checked: boolean
  onCheck: () => void
  expanded: boolean
  onExpand: () => void
}) {
  const name = f.path.slice(f.path.lastIndexOf('/') + 1)
  const dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')))
  return (
    <div role="listitem" className="tb:border-b tb:last:border-b-0">
      <div className="tb:flex tb:min-h-8 tb:items-center tb:gap-2 tb:px-3 tb:py-1">
        <Checkbox checked={checked && !blocked} disabled={!!blocked} onChange={onCheck} ariaLabel={f.path} />
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onExpand}
          className="tb:flex tb:min-w-0 tb:flex-1 tb:cursor-pointer tb:items-center tb:gap-1.5 tb:text-left tb:text-body"
          title={f.path}
        >
          <ChevronRight
            className={cn('tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle tb:transition-transform', expanded && 'tb:rotate-90')} // prettier-ignore
          />
          <FileSpreadsheet className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle" />
          <span className="tb:truncate">{name}</span>
          {dir && <span className="tb:min-w-0 tb:truncate tb:text-caption tb:text-subtle">{dir}</span>}
        </button>
        {!!f.problems && (
          <span
            className="tb:shrink-0 tb:text-caption tb:text-warning"
            title={t('替换后这些格子不符合表格结构（枚举、引用、类型……），保存前检查是「提醒」，照样能换')}
          >
            {t('{n} 处不合规', { n: f.problems })}
          </span>
        )}
        <span className="tb:shrink-0 tb:text-caption tb:text-subtle tb:tabular-nums">
          {t('{n} 格', { n: f.cells })}
        </span>
      </div>
      {blocked && <p className="tb:px-3 tb:pb-1.5 tb:pl-10 tb:text-caption tb:text-danger">{blocked}</p>}
      {expanded && (
        <div className="tb:flex tb:flex-col tb:pb-1.5 tb:pl-10 tb:font-mono tb:text-footnote">
          {f.samples.map((x, i) => (
            <div key={i} className="tb:flex tb:gap-3 tb:px-3 tb:py-0.5">
              <span className="tb:w-24 tb:shrink-0 tb:truncate tb:text-subtle" title={`${x.sheet} · ${x.field ?? ''}`}>
                {cellRef(x.row, x.col)}
                {x.field ? ` ${x.field}` : ''}
              </span>
              <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-danger tb:line-through" title={x.old}>
                {x.old}
              </span>
              <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-success" title={x.next}>
                {x.next}
              </span>
            </div>
          ))}
          {f.cells > f.samples.length && (
            <p className="tb:px-3 tb:py-0.5 tb:font-sans tb:text-caption tb:text-subtle">
              {t('还有 {n} 格', { n: f.cells - f.samples.length })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function FailedList({ failed }: { failed: { path: string; error: string }[] }) {
  return (
    <div className="tb:flex tb:flex-col tb:gap-1 tb:rounded-(--c-row-radius) tb:bg-danger/5 tb:px-3 tb:py-2">
      <p className="tb:text-footnote tb:font-medium tb:text-danger">
        {t('{n} 个文件没有替换：', { n: failed.length })}
      </p>
      {failed.map((f) => (
        <p key={f.path} className="tb:text-caption tb:text-muted">
          <span className="tb:font-mono">{f.path}</span>：{f.error}
        </p>
      ))}
    </div>
  )
}
