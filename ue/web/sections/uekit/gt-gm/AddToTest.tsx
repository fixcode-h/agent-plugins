import { FileCode } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { GmRef } from '../../../../shared/gt-script/gm/expand.ts'
import { blockOf, parseScript, serialize, tidyScript, type GtScript } from '../../../../shared/gt-script/index.ts'
import { op, ppost } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { SearchBox } from '@panel/web/src/components/ui/search-box'
import { refText } from './gm-ref.ts'

/**
 * GM 页「最近执行」、宏右键「加到测试…」（分析文档 G7）：选一个测试脚本，在它最后接一个「执行 GM」节点。
 * 菜单在 GM 页的 item-menus.ts 里（不是组件），所以用一个模块级的小仓库打开弹窗，GM 页挂一个 AddToTestHost
 */
let want: GmRef | undefined
const subs = new Set<() => void>()
export function addToTest(ref: GmRef) {
  want = ref
  subs.forEach((f) => f())
}
const close = () => addToTest(undefined as unknown as GmRef)
const useWant = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    () => want,
  )

interface Item {
  name: string
  relativePath: string
  parseError?: string
}

export function AddToTestHost() {
  const ref = useWant()
  return ref ? <AddToTestDialog gm={ref} onClose={close} /> : null
}

function AddToTestDialog({ gm, onClose }: { gm: GmRef; onClose: () => void }) {
  const { ui } = h()
  const ue = useUe()
  const project = ue.project.id
  const [list, setList] = useState<{ items: Item[]; root: string }>()
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // 加好了：弹窗留着，给「打开这个脚本」（宿主的 toast 不带按钮）
  const [done, setDone] = useState<Item>()
  useEffect(() => {
    let alive = true
    op<{ scenarios: Item[]; absoluteRootDir?: string }>(project, 'gt.scenarios', { limit: 1000, disk: true })
      .then(
        (r) =>
          alive && setList({ items: (r.scenarios ?? []).filter((s) => !s.parseError), root: r.absoluteRootDir ?? '' }),
      )
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [project])
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return (list?.items ?? []).filter((s) => !k || s.relativePath.toLowerCase().includes(k)).slice(0, 300)
  }, [list, q])

  const add = async (s: Item) => {
    if (!list) return
    setBusy(true)
    try {
      const at = { root: list.root, path: s.relativePath }
      const r = await ppost<{ text: string }>(project, 'ext/gt/file', { ...at, action: 'raw' })
      const p = parseScript(r.text)
      if ('error' in p) throw new Error(t('这个脚本读不出来：{e}', { e: p.error }))
      const doc: GtScript = { ...p.doc, steps: [...(p.doc.steps ?? []), { ...blockOf('gm.run')!.make(), gm }] }
      await ppost(project, 'ext/gt/file', {
        ...at,
        action: 'save',
        text: serialize(tidyScript(doc)),
        expectText: r.text,
      })
      setDone(s)
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('加到测试：{g}', { g: refText(gm) })}
      description={t(
        '在选中的测试脚本最后接一个「执行 GM」节点，存的是「哪条 GM + 这组参数」。要插到中间，打开脚本后拖过去',
      )}
      footer={
        <div className="ue:flex ue:w-full ue:items-center ue:gap-2">
          {done && (
            <>
              <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-success">
                {t('加到了「{s}」最后一步', { s: done.name })}
              </span>
              <ui.Button
                size="sm"
                className="ue:ml-auto"
                onClick={() => (onClose(), ue.go('gametest', done.relativePath))}
              >
                {t('打开这个脚本')}
              </ui.Button>
            </>
          )}
          <ui.Button variant="secondary" className={done ? '' : 'ue:ml-auto'} onClick={onClose}>
            {done ? t('关闭') : t('取消')}
          </ui.Button>
        </div>
      }
    >
      <div className="ue:flex ue:h-[56vh] ue:min-h-0 ue:flex-col ue:gap-2">
        <SearchBox live placeholder={t('按路径搜测试脚本')} onSearch={setQ} />
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line">
          {error ? (
            <p className="ue:p-4 ue:text-footnote ue:text-danger">{error}</p>
          ) : !list ? (
            <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('正在读测试脚本…')}</p>
          ) : !shown.length ? (
            <p className="ue:p-4 ue:text-footnote ue:text-subtle">
              {q ? t('没有路径里含「{q}」的脚本', { q }) : t('还没有测试脚本：去测试页新建一个')}
            </p>
          ) : (
            shown.map((s) => (
              <button
                key={s.relativePath}
                type="button"
                disabled={busy}
                className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-1.5 ue:text-left ue:hover:bg-hover ue:disabled:opacity-50"
                onClick={() => void add(s)}
              >
                <FileCode className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
                <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-fg">{s.name}</span>
                <span className="ue:ml-auto ue:shrink-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                  {s.relativePath}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </ui.Modal>
  )
}
