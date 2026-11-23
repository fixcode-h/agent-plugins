import { BookmarkPlus, Pencil, Trash2 } from 'lucide-react'
import type { GmArgPreset } from '../../../../shared/gm/schema.ts'
import type { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'
import { openMenu } from '@panel/web/src/components/ui/item-menu'

type Args = GmArgPreset['args']

/** 两组参数一样没有（只比填了的；自定义 GM 只比预设里写了的那几个） */
const same = (a: Args, b: Args) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x, i) => x === b[i])
    : !Array.isArray(a) &&
      !Array.isArray(b) &&
      Object.entries(a).every(([k, v]) => JSON.stringify(b[k]) === JSON.stringify(v))

/**
 * 参数预设条（GM 页梳理 F7）：GM / 自定义 GM 详情参数表单上方，一组组起了名字的参数排成小标签，点一下填进表单，
 * 右键改名、删除；「存成预设…」把表单里现在的参数起个名字存下（gm.json 的 argPresets，团队共用）。
 * 只管画和问名字，存取由调用方给（shared/gm/presets.ts），测试页这类别的地方也能用
 */
export function ArgPresets({
  presets,
  current,
  ask,
  onApply,
  onSave,
  onRename,
  onDelete,
}: {
  presets: GmArgPreset[]
  /** 表单里现在的参数：和哪组一样就高亮哪组 */
  current: Args
  ask: ReturnType<typeof useAsk>[1]
  onApply: (args: Args) => void
  onSave: (name: string) => void
  onRename: (from: string, to: string) => void
  onDelete: (name: string) => void
}) {
  const { ui, cn } = h()
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
      <span className="ue:text-footnote ue:text-subtle">{t('预设')}</span>
      {presets.map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={() => onApply(p.args)}
          onContextMenu={(e) =>
            openMenu(e, [
              {
                label: t('改名'),
                icon: Pencil,
                onClick: async () => {
                  const to = (await ask({ title: t('预设改名'), label: t('预设的名字'), init: p.name }))?.trim()
                  if (to && to !== p.name) onRename(p.name, to)
                },
              },
              { label: t('删除'), icon: Trash2, danger: true, onClick: () => onDelete(p.name) },
            ])
          }
          title={t('点一下填进表单，右键改名、删除')}
          className={cn(
            'ue:h-6 ue:max-w-48 ue:cursor-pointer ue:truncate ue:rounded-(--c-badge-radius) ue:border ue:px-2 ue:text-caption',
            same(p.args, current)
              ? 'ue:border-accent ue:bg-sel ue:text-fg'
              : 'ue:border-line ue:bg-card ue:text-muted ue:hover:text-fg',
          )}
        >
          {p.name}
        </button>
      ))}
      <ui.Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          const name = (
            await ask({ title: t('存成预设'), label: t('给这组参数起个名字（同名会覆盖）'), init: '' })
          )?.trim()
          if (name) onSave(name)
        }}
      >
        <BookmarkPlus className="ue:h-3.5 ue:w-3.5" /> {presets.length ? t('存成预设…') : t('把这组参数存成预设…')}
      </ui.Button>
    </div>
  )
}

/** 设置 →「控件样式」的样张 */
export function ArgPresetsSpecimen() {
  const noop = () => undefined
  return (
    <ArgPresets
      presets={[
        { name: '一把剑', args: ['1001', '1'] },
        { name: '一堆药', args: ['2001', '99'] },
      ]}
      current={['1001', '1']}
      ask={async () => undefined}
      onApply={noop}
      onSave={noop}
      onRename={noop}
      onDelete={noop}
    />
  )
}
