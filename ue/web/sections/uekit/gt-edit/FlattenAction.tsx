import { Rows3 } from 'lucide-react'
import { useState } from 'react'
import { serialize, toFlat, type GtScript } from '../../../../shared/gt-script/index.ts'
import { ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { useEditCtx } from './ctx.ts'

/** toFlat 列出的转不了的东西 → 一句人话 */
const WHAT: Record<string, () => string> = {
  params: () => t('脚本参数'),
  vars: () => t('脚本变量'),
  objects: () => t('抓取的对象'),
  guards: () => t('守护'),
  if: () => t('如果'),
  loop: () => t('循环'),
  call: () => t('调用脚本'),
  set: () => t('设变量'),
  invoke: () => t('调函数'),
  api: () => t('调接口'),
}

/**
 * 「转成平铺」（定稿 9.7「流程 → 平铺」）：只有一条路的脚本另存一份平铺的 v2 文件，给还没升级的旧版 GameTest 跑。
 * 原脚本不动（编辑页存盘总是写 v3）；有如果、循环、调用、守护这些转不了的，列出来，不转
 */
export function FlattenAction({ doc }: { doc: GtScript }) {
  const { ui } = h()
  const { project, root, path } = useEditCtx()
  const [problems, setProblems] = useState<string[]>()
  const [busy, setBusy] = useState(false)
  if (!path) return null
  const go = async () => {
    const r = toFlat(doc)
    if (!r.doc) {
      setProblems([...new Set(r.problems.map((p) => WHAT[p.what]?.() ?? p.what))])
      return
    }
    setProblems(undefined)
    const to = path.replace(/\.json$/i, '') + '（平铺）.json'
    setBusy(true)
    try {
      // 另存的平铺副本是从原脚本生成的：已经有就整份覆盖，不核对
      await ppost(project, 'ext/gt/file', { root, path: to, action: 'save', text: serialize(r.doc) })
      h().toast.success(t('已另存为 {p}，刷新场景库能看到', { p: to }))
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <ui.Button size="sm" variant="secondary" className="ue:self-start" disabled={busy} onClick={() => void go()}>
        <Rows3 className="ue:h-3.5 ue:w-3.5" />
        {t('转成平铺（另存一份给旧版 GameTest）')}
      </ui.Button>
      {problems && (
        <p className="ue:text-caption ue:text-warning">
          {t('转不了：脚本里有 {w}。旧版 GameTest 只认一步接一步的平铺步骤', { w: problems.join('、') })}
        </p>
      )}
    </div>
  )
}
