import { ScanSearch } from 'lucide-react'
import { useState } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { ObjDialog } from '../../../obj-kit/ObjDialog.tsx'
import { classShort } from '../gt-ref/describe.ts'
import { RefDialog } from '../gt-ref/RefDialog.tsx'

/**
 * 暂停条上的「看对象…」（测试页梳理 F1）：停着的时候从游戏里点一个对象（和画布「抓取」同一个选对象框），
 * 选好后打开对象小工作台看成员、调函数、改值，不用切去 GM 页
 */
export function LookObj({ project, objects }: { project: string; objects?: Record<string, unknown> }) {
  const { ui } = h()
  const [picking, setPicking] = useState(false)
  const [obj, setObj] = useState<GmObject>()
  return (
    <>
      <ui.Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
        <ScanSearch className="ue:h-3.5 ue:w-3.5" />
        {t('看对象…')}
      </ui.Button>
      {picking && (
        <RefDialog
          project={project}
          objects={objects}
          onClose={() => setPicking(false)}
          onSave={(name, ref) => {
            setPicking(false)
            setObj({ name: name || classShort(ref.class) || 'obj', ref })
          }}
        />
      )}
      {obj && <ObjDialog obj={obj} onClose={() => setObj(undefined)} />}
    </>
  )
}
