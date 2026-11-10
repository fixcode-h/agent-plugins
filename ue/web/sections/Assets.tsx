import { useRef, useState } from 'react'
import { DataTableView } from '../DataTable.tsx'
import { takePending } from '../pending.ts'
import { op, useAction, useLoad } from '../api.ts'
import { AssetInfo } from '../AssetInfo.tsx'
import { BlueprintView } from '../Blueprint.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Props } from '../Props.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { Badge, Card, Confirm, ErrorText, Note, PageHead, SearchBox, kindLabel } from '../ui.tsx'

interface AssetRow {
  path: string
  name: string
  class: string
  package: string
}
interface Dirty {
  package: string
  file: string
  readOnly: boolean
}

const CLASSES = [
  '',
  'DataTable',
  'PrimaryDataAsset',
  'DataAsset',
  'Blueprint',
  'CurveTable',
  'CurveFloat',
  'StringTable',
]

/**
 * 资源（图 5）：按类型和名字前缀找资源（点搜索才搜）；DataTable 表格视图（分页、筛选、改单元格、增删行），
 * DataAsset、蓝图默认值（CDO）用属性面板；蓝图另有「蓝图」页看大纲和图表伪代码，任何资源都有「摘要与引用」页。编辑器关着时走后台编辑器，读的是磁盘上的版本。
 * 改动只暂存在编辑器里，「签出并保存」才写回（P4 先签出）
 */
export function Assets() {
  const { project, sub, go, state } = useUe()
  const { cn, ui, toast } = h()
  const { busy, run } = useAction()
  // Ctrl+K 带过来的路径或名字：按所有类型搜一次（lazy 初始值只取一次，切回来不会再搜）
  const [pend] = useState(() => takePending('assets'))
  const [cls, setCls] = useState(pend ? '' : 'DataTable')
  const [q, setQ] = useState<{ cls: string; prefix: string } | undefined>(pend ? { cls: '', prefix: pend } : undefined)
  // 左边资源列表宽度可拖；右边表格、属性至少留 420px
  const pane = usePane('assets', '28%', 220)
  const left = useRef<HTMLElement>(null)
  const found = useLoad(
    () =>
      q
        ? op<{
            items: AssetRow[]
            total: number
            instance: { kind: string }
            searched?: { path: string; prefix: string }
          }>(project.id, 'assets', { class: q.cls, prefix: q.prefix, path: '/Game', limit: 200 }, undefined, 15 * 60000)
        : Promise.resolve(undefined),
    [q],
  )
  const dirty = useLoad(
    () =>
      (state?.instances ?? []).some((i) => i.kind === 'editor' || i.kind === 'background')
        ? op<{ items: Dirty[] }>(project.id, 'asset.dirty').then((r) => r.items)
        : Promise.resolve([]),
    [project.id, (state?.instances ?? []).length],
  )
  const [confirmSave, setConfirmSave] = useState(false)
  const selected = (found.data?.items ?? []).find((a) => a.path === sub)
  const isTable = selected ? selected.class === 'DataTable' : /\/DT_/.test(sub)
  // 蓝图资源（含控件蓝图、动画蓝图）；从别处跳过来、列表里没有这一项时按常见前缀猜。组件模板这类子对象路径带冒号，不算
  const isBlueprint =
    !sub.includes(':') && (selected ? /Blueprint$/.test(selected.class) : /\/(BP|WBP|ABP|BPI|BPFL)_[^/]*$/.test(sub))
  // 右栏看什么：内容（表格 / 属性）、蓝图（大纲和图表）、摘要（文件、标签、引用关系）
  const [view, setView] = useState<'main' | 'graph' | 'info'>('main')
  const tab = view === 'graph' && !isBlueprint ? 'main' : view
  const source = found.data?.instance?.kind

  const save = () =>
    run('save', async () => {
      setConfirmSave(false)
      await op(project.id, 'asset.save', { packages: (dirty.data ?? []).map((d) => d.package) }, undefined, 120000)
      toast.success(t('已保存'))
      void dirty.reload()
    })
  const revert = () =>
    run('revert', async () => {
      await op(project.id, 'asset.revert', { packages: (dirty.data ?? []).map((d) => d.package) }, undefined, 120000)
      toast.success(t('已放弃改动'))
      void dirty.reload()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('资源')}
        desc={
          source
            ? t('来源：{src}', {
                src: source === 'background' ? t('后台编辑器（磁盘上保存的版本）') : kindLabel(source),
              })
            : t('编辑器没开时自动起后台编辑器读取')
        }
      >
        {!!dirty.data?.length && (
          <>
            <Badge tone="warn">{t('{n} 个资源改了没保存', { n: dirty.data.length })}</Badge>
            <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void revert()}>
              {t('放弃改动')}
            </ui.Button>
            <ui.Button size="sm" disabled={!!busy} onClick={() => setConfirmSave(true)}>
              {project.vcs === 'p4' ? t('签出并保存') : t('保存')}
            </ui.Button>
          </>
        )}
      </PageHead>
      <div className={SPLIT_ROW}>
        <Card
          ref={left}
          className={PANE_FIXED}
          style={pane.style('calc(100% - 436px)')}
          bodyClass="ue:flex ue:min-h-0 ue:flex-col"
        >
          <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
            <ui.Select
              size="sm"
              value={cls}
              onChange={(e: { target: { value: string } }) => setCls(e.target.value)}
              options={CLASSES.map((c) => ({ value: c, label: c || t('所有类型') }))}
            />
            <SearchBox
              initial={pend}
              placeholder={t('资源名开头（DT_Item），或目录（/Game/Data、磁盘上 Content 里的路径）')}
              hint={t('前缀')}
              allowEmpty={!!cls}
              onSearch={(p) => setQ({ cls, prefix: p })}
              busy={found.loading}
            />
            {found.loading &&
              state &&
              !state.instances.some((i) => i.kind !== 'background') &&
              !state.background.running && (
                <Note tone="info">{t('UE 没在运行，正在启动后台编辑器，第一次要 30–60 秒…')}</Note>
              )}
            <ErrorText>{found.error}</ErrorText>
            {found.data && found.data.total > found.data.items.length && (
              <span className="ue:text-footnote ue:text-subtle">
                {t('共 {n} 个，只列前 {m} 个', { n: found.data.total, m: found.data.items.length })}
              </span>
            )}
          </div>
          <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
            {(found.data?.items ?? []).map((a) => (
              <li key={a.path}>
                <button
                  type="button"
                  onClick={() => go('assets', a.path)}
                  className={cn(
                    'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                    sub === a.path && 'ue:bg-sel',
                  )}
                >
                  <span className="ue:flex ue:items-center ue:gap-2">
                    <span className="ue:truncate ue:text-body ue:text-fg">{a.name}</span>
                    <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{a.class}</span>
                  </span>
                  <span className="ue:truncate ue:text-caption ue:text-subtle">{a.package}</span>
                </button>
              </li>
            ))}
            {!q && (
              <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                {t('选类型，输入名字开头或目录，点「搜索」')}
              </li>
            )}
            {found.data && !found.data.items.length && (
              <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                {t('没有找到')}
                {found.data.searched && (
                  <span className="ue:mt-1 ue:block ue:font-mono ue:break-all">
                    {found.data.searched.prefix
                      ? t('在 {path} 下找名字以 {prefix} 开头的', found.data.searched)
                      : t('在 {path} 下找', found.data.searched)}
                  </span>
                )}
              </li>
            )}
          </ul>
        </Card>
        <SplitHandle pane={pane} paneRef={left} reserve={() => 436} />
        <Card className={PANE_FILL} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
          {!sub ? (
            <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
              {t('选一个资源：DataTable 显示成表格，DataAsset 显示属性，蓝图可以看大纲和图表')}
            </p>
          ) : (
            <>
              <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
                <ui.Segmented
                  size="sm"
                  label={t('内容 / 蓝图 / 摘要')}
                  value={tab}
                  onChange={setView}
                  options={[
                    { id: 'main' as const, label: isTable ? t('表格') : isBlueprint ? t('类默认值') : t('属性') },
                    ...(isBlueprint ? [{ id: 'graph' as const, label: t('蓝图') }] : []),
                    { id: 'info' as const, label: t('摘要与引用') },
                  ]}
                />
              </div>
              {tab === 'info' ? (
                <AssetInfo key={sub} path={sub} onOpen={(p) => go('assets', p)} />
              ) : tab === 'graph' ? (
                <BlueprintView
                  key={sub}
                  path={sub}
                  onOpen={(p) => {
                    setView('main')
                    go('assets', p)
                  }}
                  onChanged={() => void dirty.reload()}
                />
              ) : isTable ? (
                <DataTableView key={sub} path={sub} onChanged={() => void dirty.reload()} />
              ) : (
                <Props
                  key={sub}
                  path={sub}
                  onOpen={(p) => go('assets', p)}
                  readOnlyHint={t('资源的改动只暂存在编辑器里，点右上「保存」才写回文件；蓝图资源改的是类默认值')}
                />
              )}
            </>
          )}
        </Card>
      </div>
      <Confirm
        open={confirmSave}
        title={project.vcs === 'p4' ? t('签出并保存这些资源？') : t('保存这些资源？')}
        okText={project.vcs === 'p4' ? t('签出并保存') : t('保存')}
        onOk={() => void save()}
        onCancel={() => setConfirmSave(false)}
      >
        <ul className="ue:flex ue:flex-col ue:gap-1 ue:font-mono ue:text-footnote">
          {(dirty.data ?? []).map((d) => (
            <li key={d.package} className="ue:break-all">
              {d.file}
              {d.readOnly ? ` · ${t('只读，会先签出')}` : ''}
            </li>
          ))}
        </ul>
        {project.vcs === 'p4' && (
          <p className="ue:mt-2 ue:text-footnote ue:text-subtle">{t('P4 签出进默认变更列表，不会提交')}</p>
        )}
      </Confirm>
    </div>
  )
}
