import { Crosshair, Eye, Library, MousePointerClick, Search, SquareFunction, Timer, Wrench } from 'lucide-react'
import { useRef, useState } from 'react'
import type { GtRef, GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenuAt } from '../../../menu.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { saveObjToLib } from '../../../obj-kit/obj-lib-actions.ts'
import { RefDialog } from '../gt-ref/RefDialog.tsx'

/** 抓到的对象能拿来做的事：每种生成一步（对象写成内联引用，部件跟着点到的） */
type Use = { label: () => string; icon: typeof Crosshair; make: (obj: GtRef, part?: string) => GtStep }
const USES: Use[] = [
  {
    label: () => t('调函数'),
    icon: SquareFunction,
    make: (obj, part) => ({ action: 'obj.call', obj, ...(part ? { part } : {}), function: '' }),
  },
  {
    label: () => t('点它'),
    icon: MousePointerClick,
    make: (obj, part) => ({ action: 'click', target: { obj, ...(part ? { part } : {}) } }),
  },
  { label: () => t('设属性'), icon: Wrench, make: (obj) => ({ action: 'obj.set', obj, prop: '', value: '' }) },
  {
    label: () => t('检查属性'),
    icon: Eye,
    make: (obj) => ({ action: 'assert', cond: { obj, prop: '@:exists', op: 'is', value: true } }),
  },
  { label: () => t('等它出现'), icon: Timer, make: (obj) => ({ action: 'obj.wait', obj }) },
  { label: () => t('找到存进变量'), icon: Search, make: (obj) => ({ action: 'obj.find', obj, saveAs: 'obj' }) },
]

/**
 * 画布工具条的「抓取」（分析文档 G11、第三期 3.4）：弹选对象面板（结构栏点的子控件当部件），存了以后问「拿它做什么」——
 * 调函数、点它、设属性、检查属性、等它出现、找到存进变量，生成的一步插在选中那步后面；也可以只存进对象库，不改脚本
 */
export function GrabButton({ onInsert }: { onInsert: (step: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLElement | null>(null)

  // 只存进对象库、不改脚本：和暂停时「存进对象库」同一个动作（obj-kit/obj-lib-actions.ts）
  const toLib = async (ref: GtRef) => {
    await saveObjToLib(ctx.project, { name: '', ref })
  }

  return (
    <>
      <span ref={(el) => void (btn.current = el)} className="ue:inline-flex">
        <ui.IconButton
          icon={Crosshair}
          size="sm"
          label={t('抓取：从游戏里选一个对象，再选拿它做什么')}
          onClick={() => setOpen(true)}
        />
      </span>
      {open && (
        <RefDialog
          project={ctx.project}
          live={ctx.live}
          objects={(ctx.doc?.objects ?? {}) as Record<string, unknown>}
          withPart
          onClose={() => setOpen(false)}
          onSave={(_name, ref, part) => {
            setOpen(false)
            if (!btn.current) return
            openMenuAt(btn.current, [
              { title: t('拿它做什么（插在选中那步后面）') },
              ...USES.map((u) => ({ label: u.label(), icon: u.icon, onClick: () => onInsert(u.make(ref, part)) })),
              'sep',
              { label: t('只存进对象库'), icon: Library, onClick: () => void toLib(ref) },
            ])
          }}
        />
      )}
    </>
  )
}
