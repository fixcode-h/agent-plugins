import { Braces, ExternalLink, Info, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { Details } from '../../../details/Details.tsx'
import type { Prop } from '../../../details/model.ts'
import { h, t } from '../../../host.ts'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import { Badge, Card, ErrorText } from '../../../ui.tsx'
import { typeTone } from '../blueprint/model.ts'
import { assetName, InfoView, useAssetTab } from '../common.tsx'
import { AssetHead } from '../shell/AssetHead.tsx'
import { EntryTable } from '../shell/EntryTable.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import { readOnlyApi, roProp } from '../shell/ro-api.ts'
import type { LayoutProps } from '../types.ts'
import { shownDefault, toneKey, type Member } from './model.ts'
import { useStruct } from './use-struct.ts'

/**
 * 结构体的查看页（效果图 B8 右下）：中间成员表格（名字、带颜色点的类型、默认值、提示），右边选中成员的细节
 * （类型、默认值、提示、变量名、存档 / 实例可改这些开关）。只读，改成员在 UE 里
 */
export function StructLayout({ path, info, onOpen, layout }: LayoutProps) {
  const { project } = useUe()
  const { ui } = h()
  const { run } = useAction()
  const [view, setView] = useAssetTab()
  const tab = view === 'info' ? 'info' : ''
  const [sel, setSel] = useState({ path, name: '' })
  const s = useStruct(path)
  const members = s.members ?? []
  const cur = members.find((m) => m.varName === (sel.path === path ? sel.name : '')) ?? members[0]
  const why = t('UELink 还没有改结构体成员的接口：在 UE 里改')

  const head = (
    <AssetHead
      path={path}
      icon={Braces}
      badges={
        <>
          <Badge>{info.cls ?? 'UserDefinedStruct'}</Badge>
          {s.members && <Badge>{t('{n} 个成员', { n: members.length })}</Badge>}
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
        { id: '', label: t('成员'), icon: Braces },
        { id: 'info', label: t('摘要与引用'), icon: Info },
      ]}
      view={tab}
      onView={(v) => setView(v)}
    />
  )
  const dot = (m: Member) => (
    <span className="ue:inline-flex ue:items-center ue:gap-1.5 ue:whitespace-nowrap">
      <span
        aria-hidden
        className="ue:h-2 ue:w-2 ue:shrink-0 ue:rounded-full"
        style={{ background: toneColor(typeTone(toneKey(m))) }}
      />
      {m.type}
    </span>
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
            <Braces className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
            {assetName(path)}
            <span className="ue:text-footnote ue:font-normal ue:text-subtle">
              {t('UserDefinedStruct · {n} 个成员', { n: members.length })}
            </span>
          </>
        }
        bodyClass="ue:flex ue:min-h-0 ue:flex-col"
      >
        {s.tooltip && (
          <p className="ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-footnote ue:text-muted">{s.tooltip}</p>
        )}
        {s.error && (
          <div className="ue:p-3">
            <ErrorText>{s.error}</ErrorText>
          </div>
        )}
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
          {s.members ? (
            <EntryTable<Member>
              rows={members}
              rowKey={(m) => m.varName}
              selected={cur?.varName}
              onSelect={(name) => setSel({ path, name })}
              cols={[
                { key: 'name', head: t('名字'), mono: true, cell: (m) => m.name },
                { key: 'type', head: t('类型'), mono: true, cell: dot },
                {
                  key: 'def',
                  head: t('默认值'),
                  mono: true,
                  cell: (m) => <span className="ue:text-muted">{shownDefault(m)}</span>,
                },
                {
                  key: 'tip',
                  head: t('提示'),
                  cell: (m) => <span className="ue:block ue:max-w-80 ue:truncate ue:text-muted">{m.tooltip}</span>,
                },
              ]}
              empty={t('这个结构体没有成员')}
            />
          ) : (
            !s.error && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
          )}
        </div>
      </Card>
    )
  const rows: Prop[] = cur
    ? [
        roProp(t('名字'), cur.name, cur.name, why),
        roProp(t('类型'), cur.type, cur.name, why),
        roProp(t('默认值'), shownDefault(cur), cur.name, why),
        roProp(t('提示'), cur.tooltip, cur.name, why),
        roProp(t('变量名'), cur.varName, t('高级'), why),
        roProp(t('存档（SaveGame）'), cur.flags.saveGame, t('高级'), why),
        roProp(t('实例上不可改'), cur.flags.dontEditOnInstance, t('高级'), why),
        roProp(t('多行文本'), cur.flags.multiLine, t('高级'), why),
      ]
    : []
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
            aside={cur && <span className="ue:truncate ue:font-mono">{cur.name}</span>}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
            <Details props={rows} api={readOnlyApi()} loading={!s.members && !s.error} />
          </Card>
        ),
      }}
    />
  )
}
