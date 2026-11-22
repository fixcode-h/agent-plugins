import { Crosshair } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../../host.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { RefDialog } from './RefDialog.tsx'

/**
 * 值旁边的「抓取值…」（分析文档 G8，和 GM 改变量同一个弹窗）：打开选对象弹窗的抓取模式，
 * 从运行中的任意对象上取一项此刻的值填进来；只列类型对得上的（type 不给时都列）。
 * 不在编辑页里（没有项目）时不出
 */
export function GrabValue({ type, onValue }: { type?: string; onValue: (v: unknown) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const [open, setOpen] = useState(false)
  if (!ctx.project) return null
  return (
    <>
      <ui.IconButton
        size="sm"
        className="ue:shrink-0"
        label={t('抓取值…（从运行中的对象上取一个值填进来）')}
        onClick={() => setOpen(true)}
      >
        <Crosshair className="ue:h-3.5 ue:w-3.5" />
      </ui.IconButton>
      {open && (
        <RefDialog
          project={ctx.project}
          live={ctx.live}
          objects={(ctx.doc?.objects ?? {}) as Record<string, unknown>}
          take={{
            type,
            onTake: (x) => {
              // 抓的是对象本身时 value 是 {"$obj": 路径…}：只在这次运行里有效，脚本里存它的显示文字没意义，照样交出去由调用方决定
              onValue(x.value)
              setOpen(false)
            },
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
