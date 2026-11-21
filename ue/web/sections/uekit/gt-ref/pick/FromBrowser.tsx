import { FolderInput } from 'lucide-react'
import { useState } from 'react'
import type { GtClassItem, GtClassesResult } from '../../../../../shared/gt-script/index.ts'
import { op } from '../../../../api.ts'
import { h, t } from '../../../../host.ts'
import { useRefRpc } from '../live.ts'

/** UELink 2.4 editor.selection 回包里用得到的部分（UEKit docs/protocol.md） */
interface Sel {
  assets?: { path: string; name: string; class: string }[]
}

/** 蓝图类资产（父类是 UObject 的都算）；C++ 类在内容浏览器里是 Class */
const BP = /Blueprint$/

/**
 * 类旁边的「用内容浏览器选中的」（用户 2026-11-21）：读编辑器内容浏览器里选中的第一个蓝图（或 C++ 类），
 * 再用 gt.classes 按名字查一次拿到种类（Actor / 界面 / 组件），种类决定「在哪找」的默认开关。查不到也照样定类
 */
export function FromBrowser({ project, onPick }: { project: string; onPick: (cls: string, it: GtClassItem) => void }) {
  const { ui } = h()
  const rpc = useRefRpc()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const sel = await op<Sel>(project, 'editor.selection', {}, { instance: 'editor' }, 5000)
      const a = (sel.assets ?? []).find((x) => BP.test(x.class) || x.class === 'Class')
      if (!a) {
        setError(
          sel.assets?.length
            ? t('内容浏览器里选中的不是蓝图或类：选一个蓝图再点')
            : t('内容浏览器里没选中资源：先在 UE 里选一个蓝图'),
        )
        return
      }
      const name = a.name.replace(/_C$/, '')
      const found = await rpc<GtClassesResult>(project, 'gt.classes', { q: name, limit: 50 }).catch(() => undefined)
      const it = found?.items.find((x) => x.name === name || x.name === `${name}_C`)
      onPick(
        it?.name ?? name,
        it ?? { name, kind: a.class === 'WidgetBlueprint' ? 'umg' : 'object', asset: a.path, kids: 0 },
      )
    } catch (e) {
      setError(t('读不到内容浏览器的选中（要开着 UE 编辑器）：{m}', { m: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="ue:flex ue:items-center ue:gap-1.5">
      <ui.Button
        size="sm"
        variant="ghost"
        disabled={busy}
        title={t('把 UE 编辑器内容浏览器里选中的蓝图设成类')}
        onClick={() => void run()}
      >
        <FolderInput className="ue:h-3.5 ue:w-3.5" />
        {t('用内容浏览器选中的')}
      </ui.Button>
      {error && <span className="ue:max-w-60 ue:text-caption ue:text-warning">{error}</span>}
    </span>
  )
}
