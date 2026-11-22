import { ScanSearch, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { parsePath, type GtPath, type GtScript } from '../../../../shared/gt-script/index.ts'
import { op, ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { collectTargets } from '../gt-rows/check.ts'
import type { GtResolveItem } from '../gt-run/step-parts.tsx'

interface Missing {
  key: string
  target: string
}

/**
 * 「核对选择器」（原来在运行结果页的头上，那一页取消后挪到编辑页顶栏的 ⋯ 里）：对着游戏里此刻的界面解析每一步的选择器，不执行。
 * 选择器由面板从脚本里收（段、如果、循环里的也收），按顺序交给 gt.resolve，结果按顺序对回步骤；
 * 结果是编辑页顶上的一条：几个找得到、几个找不到，找不到的点一下选中那一步
 */
export function useSelectorCheck(project: string, doc: GtScript | undefined, onPick: (p: GtPath) => void) {
  const { cn, toast, ui } = h()
  const [res, setRes] = useState<{ found: number; missing: Missing[] }>()
  const [checking, setChecking] = useState(false)
  // 脚本改了，上次的核对结果就不作数了
  useEffect(() => setRes(undefined), [doc])
  const start = () => {
    const wanted = collectTargets((doc?.steps ?? []) as Record<string, unknown>[])
    if (!wanted.length) return void toast.success(t('这个脚本里没有要核对的选择器'))
    setChecking(true)
    op<{ results?: GtResolveItem[]; found?: number; missing?: number; file?: string }>(project, 'gt.resolve', {
      targets: wanted.map((w) => w.target),
    })
      .then(async (r) => {
        // 结果太长时 UE 写成文件只回 file：由面板读那份文件
        const full = r.results ? r : await ppost<typeof r>(project, 'ext/gt/report', { file: r.file })
        const missing: Missing[] = []
        ;(full.results ?? []).forEach((x, k) => {
          const w = wanted[k]
          if (w && !x.found) missing.push({ key: w.key, target: w.target })
        })
        setRes({ found: full.found ?? 0, missing })
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setChecking(false))
  }
  const banner = res && (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:px-4 ue:py-1.5 ue:text-footnote">
      <ScanSearch className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:text-fg">
        {t('核对了 {n} 个选择器：{f} 个找得到，{m} 个找不到。只看此刻屏上的界面，后面步骤才打开的界面找不到是正常的', {
          n: res.found + res.missing.length,
          f: res.found,
          m: res.missing.length,
        })}
      </span>
      {res.missing.slice(0, 6).map((m) => (
        <button
          key={`${m.key}:${m.target}`}
          type="button"
          title={t('选中这一步')}
          onClick={() => onPick(parsePath(m.key))}
          className={cn(
            'ue:max-w-60 ue:cursor-pointer ue:truncate ue:rounded-(--c-badge-radius) ue:bg-danger/10 ue:px-1.5 ue:font-mono ue:text-caption ue:text-danger ue:hover:bg-danger/20',
          )}
        >
          {m.target}
        </button>
      ))}
      <ui.IconButton icon={X} size="sm" className="ue:ml-auto" label={t('清掉核对结果')} onClick={() => setRes(undefined)} />
    </div>
  )
  return { start, checking, banner }
}
