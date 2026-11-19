import { ExternalLink, Info, ListOrdered, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { op, useAction, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { Details } from '../../../details/Details.tsx'
import type { Prop } from '../../../details/model.ts'
import { h, t } from '../../../host.ts'
import { Badge, Card, ErrorText, Note } from '../../../ui.tsx'
import { assetName, InfoView, useAssetTab } from '../common.tsx'
import { AssetHead } from '../shell/AssetHead.tsx'
import { EntryTable } from '../shell/EntryTable.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import { readOnlyApi, roProp } from '../shell/ro-api.ts'
import type { LayoutProps } from '../types.ts'
import { parseEnum, type EnumEntry } from './model.ts'

/**
 * 枚举的查看页（效果图 B8 右上「整页就是条目列表编辑器」）：中间条目表格，右边选中条目的细节（序号、内部名、显示名、完整名）
 * 和枚举本身的说明。只读，改条目要在 UE 里（页头「在 UE 里打开」）
 */
export function EnumLayout({ path, info, onOpen, layout }: LayoutProps) {
  const { project } = useUe()
  const { ui } = h()
  const { run } = useAction()
  const [view, setView] = useAssetTab()
  const tab = view === 'info' ? 'info' : ''
  const [sel, setSel] = useState({ path, name: '' })
  const data = useLoad(
    () =>
      op<{ props: Prop[] }>(project.id, 'props', { path, filter: '', maxChars: 20000 }).then((r) => ({ path, ...r })),
    [project.id, path],
    0,
    `${project.id}/enum/props`,
  )
  const props = data.data?.path === path ? data.data.props : undefined
  const parsed = parseEnum(props ?? [])
  const cur = parsed.entries.find((e) => e.name === (sel.path === path ? sel.name : '')) ?? parsed.entries[0]
  const why = t('UELink 还没有改枚举条目的接口：在 UE 里改')

  const head = (
    <AssetHead
      path={path}
      icon={ListOrdered}
      badges={
        <>
          <Badge>{info.cls ?? 'UserDefinedEnum'}</Badge>
          {props && <Badge>{t('{n} 项', { n: parsed.entries.length })}</Badge>}
        </>
      }
      extra={
        <ui.Button
          size="sm"
          variant="ghost"
          onClick={() => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))}
        >
          <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('在 UE 里编辑')}
        </ui.Button>
      }
      views={[
        { id: '', label: t('条目'), icon: ListOrdered },
        { id: 'info', label: t('摘要与引用'), icon: Info },
      ]}
      view={tab}
      onView={(v) => setView(v)}
    />
  )
  const center =
    tab === 'info' ? (
      <Card className="ue:min-h-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto">
        <InfoView path={path} onOpen={onOpen} />
      </Card>
    ) : (
      <Card
        className="ue:min-h-0 ue:flex-1"
        title={
          <>
            <ListOrdered className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
            {assetName(path)}
            <span className="ue:text-footnote ue:font-normal ue:text-subtle">
              {t('UserDefinedEnum · {n} 项', { n: parsed.entries.length })}
            </span>
          </>
        }
        bodyClass="ue:flex ue:min-h-0 ue:flex-col"
      >
        {data.error && (
          <div className="ue:p-3">
            <ErrorText>{data.error}</ErrorText>
          </div>
        )}
        {parsed.truncated && (
          <div className="ue:p-2">
            <Note>{t('条目太多，UELink 只回了摘要；完整列表在 UE 里看')}</Note>
          </div>
        )}
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
          {props ? (
            <EntryTable<EnumEntry>
              rows={parsed.entries}
              rowKey={(e) => e.name}
              selected={cur?.name}
              onSelect={(name) => setSel({ path, name })}
              cols={[
                { key: 'label', head: t('显示名'), cell: (e) => e.label },
                {
                  key: 'name',
                  head: t('内部名'),
                  mono: true,
                  cell: (e) => <span className="ue:text-muted">{e.name}</span>,
                },
              ]}
              empty={t('这个枚举没有条目')}
            />
          ) : (
            !data.error && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
          )}
        </div>
        <p className="ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">
          {t('条目说明和「位掩码枚举」开关 UELink 还读不到，在 UE 里看')}
        </p>
      </Card>
    )
  const rows: Prop[] = [
    ...(cur
      ? [
          roProp(t('序号'), cur.index, t('条目'), why),
          roProp(t('显示名'), cur.label, t('条目'), why),
          roProp(t('内部名'), cur.name, t('条目'), why),
          roProp(t('完整名'), `${assetName(path)}::${cur.name}`, t('条目'), why),
        ]
      : []),
    roProp(t('说明'), parsed.description, t('枚举'), why),
    roProp(t('条目数'), parsed.entries.length, t('枚举'), why),
  ]
  return (
    <LayoutShell
      layout={layout}
      head={head}
      center={center}
      regions={{
        details: tab !== 'info' && (
          <Card
            className="ue:min-h-0 ue:flex-1"
            title={
              <>
                <SlidersHorizontal className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
                {t('细节')}
              </>
            }
            aside={cur && <span className="ue:truncate ue:font-mono">{cur.label}</span>}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
            <Details props={props ? rows : []} api={readOnlyApi()} loading={!props} />
          </Card>
        ),
      }}
    />
  )
}
