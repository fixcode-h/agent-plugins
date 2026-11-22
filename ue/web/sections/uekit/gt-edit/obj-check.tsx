import { ScanSearch, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { findPath, parsePath, type GtPath, type GtScript } from '../../../../shared/gt-script/index.ts'
import { op } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { objCheckPlan, objCheckResult } from '../gt-objects/check-objects.ts'

/**
 * 「核对所有对象」（测试页梳理 F2，取代 v3 时代按选择器字符串核对的「核对选择器」）：脚本「对象」里的每一项和步骤里内联的引用
 * 交给 gt.resolve 数此刻命中几个，不执行。结果是编辑页顶上的一条（几个找得到、找不到的点一下选中用到它的那步），
 * 找不到的对象用到的节点在画布上标黄（steps 交给视图）
 */
export function useObjCheck(project: string, doc: GtScript | undefined, onPick: (p: GtPath) => void) {
  const { cn, toast, ui } = h()
  const [res, setRes] = useState<{ found: number; missing: string[]; steps: Set<string> }>()
  const [checking, setChecking] = useState(false)
  // 脚本改了，上次的核对结果就不作数了
  useEffect(() => setRes(undefined), [doc])
  const plan = doc ? objCheckPlan(doc) : undefined
  const start = () => {
    if (!plan?.refs.length) return void toast.success(t('这个脚本里没有要核对的对象'))
    setChecking(true)
    op<{ refs?: { id?: string; count?: number; error?: string }[] }>(project, 'gt.resolve', { refs: plan.refs })
      .then((r) => setRes(objCheckResult(plan, r.refs ?? [])))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setChecking(false))
  }
  const pick = (id: string) => {
    const key = plan?.users.get(id)?.[0]
    if (!key || !doc) return
    const p = findPath(doc, key) ?? (key.includes('.') ? parsePath(key) : undefined)
    if (p) onPick(p)
  }
  const banner = res && (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-footnote">
      <ScanSearch className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:text-fg">
        {t('核对了 {n} 个对象：{f} 个找得到，{m} 个此刻找不到（画布上标黄）。只看此刻的游戏，后面步骤才出现的对象找不到是正常的', {
          n: res.found + res.missing.length,
          f: res.found,
          m: res.missing.length,
        })}
      </span>
      {res.missing.slice(0, 6).map((id) => (
        <button
          key={id}
          type="button"
          title={t('选中用到它的那一步')}
          onClick={() => pick(id)}
          className={cn(
            'ue:max-w-60 ue:cursor-pointer ue:truncate ue:rounded-(--c-badge-radius) ue:bg-warning/10 ue:px-1.5 ue:font-mono ue:text-caption ue:text-warning ue:hover:bg-warning/20',
          )}
        >
          {id.startsWith('#') ? t('第 {k} 步里的对象', { k: id.slice(1) }) : id}
        </button>
      ))}
      <ui.IconButton icon={X} size="sm" className="ue:ml-auto" label={t('清掉核对结果')} onClick={() => setRes(undefined)} />
    </div>
  )
  return { start, checking, banner, missing: res?.steps }
}
