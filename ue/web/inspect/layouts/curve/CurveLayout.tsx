import { Info, SlidersHorizontal, Spline, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { useDetailsApi } from '../../../details/api.ts'
import { Details } from '../../../details/Details.tsx'
import { t } from '../../../host.ts'
import { Card, ErrorText, Note } from '../../../ui.tsx'
import { InfoView, useAssetTab } from '../common.tsx'
import { AssetHead, ClassBadges } from '../shell/AssetHead.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { CurveGraph } from './CurveGraph.tsx'
import { CurveList } from './CurveList.tsx'
import { CurveToolbar } from './CurveToolbar.tsx'
import { keyProps } from './key-props.ts'
import { KeyTable } from './KeyTable.tsx'
import { parseKeyId, valueRange } from './model.ts'
import { useCurve } from './use-curve.ts'

/**
 * 曲线的查看页（效果图 B9）：左边曲线列表、中间曲线编辑器（工具条切切线 / 插值、删键）、下面关键帧表、右边细节。
 * 图上和表里选键联动；右栏改值写回 UE（未保存，资源页头保存）。CurveTable 的行读不出来时中间说明原因
 */
export function CurveLayout({ path, info, onOpen, layout }: LayoutProps) {
  const [view, setView] = useAssetTab()
  const tab = view === 'info' ? 'info' : ''
  const cv = useCurve(path)
  const [state, setState] = useState({ path, picked: '', active: '', hidden: [] as string[] })
  const s = state.path === path ? state : { path, picked: '', active: '', hidden: [] as string[] }
  const patch = (p: Partial<typeof s>) => setState({ ...s, ...p })
  const hidden = new Set(s.hidden)
  const shown = cv.curves.filter((c) => !hidden.has(c.id))
  const listed = s.active ? cv.curves.filter((c) => c.id === s.active) : shown
  const ref = parseKeyId(s.picked)
  const selCurve = cv.curves.find((c) => c.id === ref?.curve)
  const selKey = selCurve && ref ? selCurve.keys[ref.index] : undefined
  const sel = selCurve && selKey && ref ? { c: selCurve, k: selKey, i: ref.index } : undefined
  // 没选键时右栏显示第一条曲线的外推和默认值
  const detailCurve = selCurve ?? listed[0]
  const api = useDetailsApi(path, { q: '', reload: cv.reload, openRef: () => undefined })

  const head = (
    <AssetHead
      path={path}
      icon={TrendingUp}
      badges={<ClassBadges cls={info.cls} />}
      views={[
        { id: '', label: t('曲线'), icon: Spline },
        { id: 'info', label: t('摘要与引用'), icon: Info },
      ]}
      view={tab}
      onView={(v) => setView(v)}
    />
  )
  const noCurves = !!cv.props && !cv.curves.length
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
            <Spline className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
            {t('曲线编辑器')}
          </>
        }
        aside={
          <CurveToolbar
            sel={sel}
            busy={!!cv.busy}
            onSet={(w) => void cv.setMany('mode', w)}
            onRemove={() => {
              if (!sel) return
              void cv.removeKey(sel.c, sel.i)
              patch({ picked: '' })
            }}
          />
        }
        bodyClass="ue:flex ue:min-h-0 ue:flex-col"
      >
        {cv.error && (
          <div className="ue:p-3">
            <ErrorText>{cv.error}</ErrorText>
          </div>
        )}
        {noCurves && (
          <div className="ue:p-3">
            <Note>
              {t(
                '这个资源的属性里没有曲线。CurveTable 的行不是属性，UELink 还读不出来（要新接口 curvetable），先在 UE 里看',
              )}
            </Note>
          </div>
        )}
        {!cv.props && !cv.error && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>}
        {cv.curves.length > 0 && <CurveGraph curves={shown} picked={s.picked} onPick={(id) => patch({ picked: id })} />}
      </Card>
    )
  return (
    <LayoutShell
      layout={layout}
      head={head}
      center={center}
      regions={{
        curves: tab !== 'info' && cv.curves.length > 0 && (
          <CurveList
            curves={cv.curves}
            hidden={hidden}
            onToggle={(id) => patch({ hidden: hidden.has(id) ? s.hidden.filter((x) => x !== id) : [...s.hidden, id] })}
            active={s.active}
            onActive={(id) => patch({ active: id })}
          />
        ),
        keys: tab !== 'info' && cv.curves.length > 0 && (
          <KeyTable curves={listed} picked={s.picked} onPick={(id) => patch({ picked: id })} />
        ),
        details: tab !== 'info' && (
          <Card
            className="ue:min-h-0 ue:flex-1"
            title={
              <>
                <SlidersHorizontal className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
                {t('细节')}
              </>
            }
            aside={sel && <span className="ue:font-mono">{t('关键帧 {i}', { i: sel.i })}</span>}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
            <Details
              props={keyProps(detailCurve, sel ? sel.i : -1, {
                cls: info.cls ?? '',
                range: valueRange(shown),
                key: t('关键帧'),
                curve: t('曲线'),
                asset: t('资源'),
              })}
              api={api}
              loading={!cv.props}
            />
          </Card>
        ),
      }}
    />
  )
}
