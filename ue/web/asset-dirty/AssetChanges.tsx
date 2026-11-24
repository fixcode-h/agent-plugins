import { FilePenLine, Lock, Save, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PropDiff } from '../../shared/asset-diff/types.ts'
import { op } from '../api.ts'
import { DiffButton } from '../asset-diff/DiffButton.tsx'
import { DiffBody, SummaryTags, type Tab } from '../asset-diff/DiffBody.tsx'
import { FailPane } from '../asset-diff/FailPane.tsx'
import { DiffLoading } from '../asset-diff/Progress.tsx'
import { useDiffRun } from '../asset-diff/use-diff-run.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge } from '../ui.tsx'
import { useDirtyActions } from './actions.tsx'
import { pkgOf, setDiffSummary, showChanges, useDirtyState } from './store.ts'

/**
 * 资源的「改动」页（效果图 designs/UE资源页当前修改-效果图 1、2）：固定比「磁盘上的文件 → 编辑器里现在的内容」，
 * 正文和「历史版本」弹窗是同一套（DiffBody），只是嵌在资源页里不弹窗。打开时才去读两份快照比（用户 2026-11-19 定：点开才算），
 * 算完把结果交给左栏那一行补小标签。行尾能把一项改回磁盘上的值（进编辑器的撤销记录），这里也能直接保存 / 放弃这个资源
 */
export function AssetChanges({ path }: { path: string }) {
  const { project, state } = useUe()
  const { ui, toast } = h()
  const pkg = pkgOf(path)
  const name = pkg.split('/').pop() ?? pkg
  const editorOn = (state?.instances ?? []).some((i) => i.kind === 'editor')
  const item = useDirtyState().items.find((d) => d.package === pkg)
  const act = useDirtyActions()
  const [only, setOnly] = useState(true)
  const [tab, setTab] = useState<Tab>('widgets')
  const isNew = !!item?.isNew

  // 还没存过盘的新资源：磁盘上没有这一边，按「新建」比
  const from = isNew ? null : 'disk'
  const run = useDiffRun(project.id, pkg, { key: `${from ?? '∅'}|live`, from, to: 'live' })
  const diff = run.done.get(`${from ?? '∅'}|live`)
  useEffect(() => {
    if (diff) setDiffSummary(pkg, diff)
  }, [pkg, diff])

  const a = isNew ? t('（磁盘上没有）') : t('磁盘上的')
  const b = t('编辑器里的')
  const restore = isNew
    ? undefined
    : (p: PropDiff) => {
        const objPath = diff?.blueprint ? `${pkg}.Default__${name}_C` : `${pkg}.${name}`
        op(project.id, 'set', { path: objPath, prop: p.name, value: p.a }).then(
          () => {
            toast.success(t('已改回磁盘上的值：点「保存」才写回文件'))
            run.retry()
          },
          (e: Error) => toast.error(e.message),
        )
      }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-2">
        <FilePenLine className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
        <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{name}</span>
        {diff?.class && <Badge>{diff.class}</Badge>}
        <Badge tone="warn">{isNew ? t('新建，没保存') : t('没保存')}</Badge>
        {item?.readOnly && (
          <Badge title={t('文件只读：保存时先签出')}>
            <Lock className="ue:mr-0.5 ue:h-3 ue:w-3" />
            {t('只读')}
          </Badge>
        )}
        <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          <DiffButton asset={path} />
          <ui.Segmented
            size="sm"
            label={t('视图')}
            value="changes"
            onChange={(v: string) => v === 'detail' && showChanges('')}
            options={[
              { id: 'detail', label: t('细节') },
              { id: 'changes', label: t('改动') },
            ]}
          />
        </div>
      </header>
      <div className="ue:flex ue:shrink-0 ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
        <span className="ue:font-mono ue:text-body ue:font-medium">{`${a} → ${b}`}</span>
        {diff && <SummaryTags diff={diff} onTab={setTab} />}
        <span className="ue:flex-1" />
        <ui.Segmented
          label={t('显示')}
          size="sm"
          value={only ? 'only' : 'all'}
          onChange={(v: string) => setOnly(v === 'only')}
          options={[
            { id: 'only', label: t('只看变化') },
            { id: 'all', label: t('全部') },
          ]}
        />
        <ui.Button
          size="sm"
          variant="secondary"
          disabled={!item || act.busy}
          onClick={() => item && act.revert([item])}
        >
          <Undo2 className="ue:h-3.5 ue:w-3.5" />
          {t('放弃这个资源的改动')}
        </ui.Button>
        <ui.Button size="sm" disabled={!item || act.busy} onClick={() => item && act.save([item])}>
          <Save className="ue:h-3.5 ue:w-3.5" />
          {act.saveLabel}
        </ui.Button>
      </div>
      {!diff ? (
        run.failed ? (
          <FailPane failed={run.failed} onRetry={run.retry} onClose={() => showChanges('')} />
        ) : (
          <DiffLoading progress={run.progress} since={run.since} onCancel={run.cancel} />
        )
      ) : (
        <DiffBody
          pkg={pkg}
          diff={diff}
          only={only}
          tab={tab}
          onTab={setTab}
          a={a}
          b={b}
          editorOn={editorOn}
          onRestore={restore}
        />
      )}
      {act.dialog}
    </div>
  )
}
