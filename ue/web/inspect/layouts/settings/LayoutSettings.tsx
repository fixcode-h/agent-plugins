import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../../host.ts'
import { Badge, Card } from '../../../ui.tsx'
import { LAYOUTS } from '../registry.ts'
import { forgetSizes, isVertical, regionOff, rememberedSize, setRegionOff } from '../shell/regions.ts'
import type { Layout } from '../types.ts'

/**
 * 设置 →「资源查看布局」（设计稿第 2 节、效果图 B11，做得朴素些）：注册表里每种布局匹配哪些类、各区域的默认尺寸和
 * 在资源页拖过后记住的尺寸，能逐个布局或全部重置；能关掉的区域（动画列表、时间轴）在这里开关。
 * 尺寸和开关都记在本机浏览器里（所有项目共用），改完回到资源页重新打开资源生效。
 */
export function LayoutSettings() {
  const { ui, cn } = h()
  // 记住的尺寸在 localStorage 里：重置、开关后加一拍让表格重读
  const [, setTick] = useState(0)
  const bump = () => setTick((n) => n + 1)
  const anyRemembered = LAYOUTS.some((l) => l.regions.some((r) => rememberedSize(l.id, r.id)))
  return (
    <Card
      title={t('资源查看布局')}
      aside={
        <ui.Button
          size="sm"
          variant="ghost"
          disabled={!anyRemembered}
          onClick={() => {
            LAYOUTS.forEach(forgetSizes)
            bump()
          }}
        >
          <RotateCcw className="ue:h-3.5 ue:w-3.5" /> {t('重置全部记住的尺寸')}
        </ui.Button>
      }
    >
      <p className="ue:px-4 ue:pt-3 ue:text-footnote ue:text-subtle">
        {t(
          '资源页、对象页、AssetForge「资源」页签按资源类型挑布局；分栏拖过的尺寸按「布局 + 区域」记在本机，双击分隔线也能恢复默认。',
        )}
      </p>
      <div className="ue:overflow-x-auto ue:p-4">
        <table className="ue:w-full ue:min-w-[720px] ue:border-collapse ue:text-body">
          <thead>
            <tr className="ue:border-b ue:border-line ue:text-left ue:text-footnote ue:text-subtle">
              <th className="ue:py-1.5 ue:pr-3 ue:font-medium">{t('布局')}</th>
              <th className="ue:py-1.5 ue:pr-3 ue:font-medium">{t('匹配的类')}</th>
              <th className="ue:py-1.5 ue:pr-3 ue:font-medium">{t('区域（默认 → 记住的）')}</th>
              <th className="ue:py-1.5 ue:font-medium" />
            </tr>
          </thead>
          <tbody>
            {LAYOUTS.map((l) => (
              <LayoutRow key={l.id} l={l} onChange={bump} cn={cn} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function LayoutRow({ l, onChange, cn }: { l: Layout; onChange: () => void; cn: (...c: unknown[]) => string }) {
  const { ui } = h()
  const remembered = l.regions.some((r) => rememberedSize(l.id, r.id))
  return (
    <tr className="ue:border-b ue:border-line/60 ue:align-top">
      <td className="ue:py-2 ue:pr-3">
        <span className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:text-fg">
          {l.label()}
          {l.priority === 0 && <Badge tone="warn">{t('兜底')}</Badge>}
          {l.offline && <Badge tone="accent">{t('资源没生成也能看')}</Badge>}
        </span>
      </td>
      <td className="ue:py-2 ue:pr-3 ue:font-mono ue:text-footnote ue:text-muted">{l.classes().join(' · ')}</td>
      <td className="ue:py-2 ue:pr-3">
        {!l.regions.length && <span className="ue:text-footnote ue:text-subtle">{t('一整块，没有分栏')}</span>}
        <ul className="ue:flex ue:flex-col ue:gap-1">
          {l.regions.map((r) => {
            const size = rememberedSize(l.id, r.id)
            const off = !!r.optional && regionOff(l.id, r.id)
            return (
              <li
                key={r.id}
                className={cn(
                  'ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:text-footnote',
                  off && 'ue:opacity-60',
                )}
              >
                <span className="ue:text-fg">{r.label()}</span>
                <span className="ue:font-mono ue:text-subtle">
                  {isVertical(r) ? t('高') : t('宽')} {r.size}
                  {size ? ` → ${size}px` : ''}
                  {` · ${t('最小 {n}px', { n: r.min })}`}
                </span>
                {size > 0 && <Badge tone="run">{t('已记住')}</Badge>}
                {r.optional && (
                  <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:text-muted">
                    <input
                      type="checkbox"
                      className="ue:accent-accent"
                      checked={!off}
                      onChange={(e) => {
                        setRegionOff(l.id, r.id, !e.target.checked)
                        onChange()
                      }}
                    />
                    {t('显示')}
                  </label>
                )}
              </li>
            )
          })}
        </ul>
      </td>
      <td className="ue:py-2 ue:text-right">
        {remembered && (
          <ui.Button
            size="sm"
            variant="ghost"
            onClick={() => {
              forgetSizes(l)
              onChange()
            }}
          >
            <RotateCcw className="ue:h-3.5 ue:w-3.5" /> {t('重置')}
          </ui.Button>
        )}
      </td>
    </tr>
  )
}
