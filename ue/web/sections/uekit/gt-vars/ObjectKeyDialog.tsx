import { Crosshair, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { parseScalar, scalarText } from '../gt-cond/compare.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { PickDialog } from '../gt-live/PickDialog.tsx'
import { FieldGroups, itemKey } from './FieldGroups.tsx'
import { useVars, type VarItem } from './model.ts'

/** 对象定位器（协议第 7 节）：类 + 在哪找 + 唯一标识组合，运行时按它重新找 */
export interface Locator {
  class: string
  in?: string
  key?: Record<string, unknown>
  component?: string
  near?: unknown
  client?: number
}

const scoreLabel = (s: VarItem['score']) =>
  s === 'high' ? t('适合当标识') : s === 'mid' ? t('可以') : s === 'low' ? t('勉强') : s === 'no' ? t('会变，不用') : ''

/**
 * 抓对象 / 配对象选标识（定稿第 6 节、效果图 10）：只存类和你勾的标识属性，不存抓到的那个对象。
 * 属性按 C++ / 蓝图 / Lua 分组，带此刻的值、同类里是否各不相同、适不适合当标识；一个都不勾时标黄「按第一个找」。
 * 编辑器开着时按类列属性（gt.vars scope=class）；没开时只能手写类名和标识
 */
export function ObjectKeyDialog({
  name: initialName,
  value,
  onClose,
  onSave,
}: {
  name?: string
  value?: Locator
  onClose: () => void
  onSave: (name: string, loc: Locator) => void
}) {
  const { ui } = h()
  const ctx = useEditCtx()
  const [name, setName] = useState(initialName ?? '')
  const [loc, setLoc] = useState<Locator>(value ?? { class: '' })
  const [cls, setCls] = useState(loc.class)
  const [picking, setPicking] = useState(false)
  const vars = useVars(ctx.project, cls ? { scope: 'class', name: cls } : undefined, ctx.live)
  const key = loc.key ?? {}
  const keyPaths = new Set(Object.keys(key))
  const groups = vars.data?.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.kind === 'prop') })) ?? []
  const selected = new Set(
    groups.flatMap((g) => g.items.filter((i) => keyPaths.has(pathOf(g.src, i))).map((i) => itemKey(g, i))),
  )

  function pathOf(src: string, it: VarItem) {
    return src === 'lua' ? `@lua.${it.path.replace(/^self\./, '')}` : it.path
  }

  const toggle = (src: string, it: VarItem) => {
    const p = pathOf(src, it)
    const next = { ...key }
    if (p in next) delete next[p]
    else next[p] = it.value ?? ''
    setLoc({ ...loc, key: next })
  }

  const ok = name.trim() && /^[A-Za-z_]\w*$/.test(name.trim()) && loc.class.trim()
  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('对象：类和唯一标识')}
      description={t('存进脚本的只有类和你勾的标识，运行时按它重新找；一个都不勾时取第一个。')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button
            disabled={!ok}
            onClick={() => {
              const out: Locator = { ...loc, class: loc.class.trim() }
              if (!Object.keys(out.key ?? {}).length) delete out.key
              if (!out.in || out.in === 'world') delete out.in
              onSave(name.trim(), out)
            }}
          >
            {t('存')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <div className="ue:grid ue:grid-cols-1 ue:gap-3 ue:sm:grid-cols-3">
          <ui.Field label={t('名字')} hint={t('脚本里用 {"$obj": "名字"} 或 @obj.名字 引用')}>
            <ui.Input
              size="sm"
              className="ue:font-mono"
              value={name}
              placeholder="shopNpc"
              onChange={(e: { target: { value: string } }) => setName(e.target.value)}
            />
          </ui.Field>
          <ui.Field label={t('类')} hint={t('BP_ShopNpc_C、ANpc；子类也算')}>
            <div className="ue:flex ue:items-center ue:gap-1">
              <ui.Input
                size="sm"
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                value={loc.class}
                onChange={(e: { target: { value: string } }) => setLoc({ ...loc, class: e.target.value })}
                onBlur={() => setCls(loc.class.trim())}
              />
              {ctx.live && (
                <ui.IconButton size="sm" label={t('在游戏里点一下抓')} onClick={() => setPicking(true)}>
                  <Crosshair className="ue:h-3.5 ue:w-3.5" />
                </ui.IconButton>
              )}
            </div>
          </ui.Field>
          <ui.Field label={t('在哪找')} hint={t('world 关卡里的 Actor、widgets 屏上的界面、或 @sub.X.数组属性')}>
            <ui.Input
              size="sm"
              className="ue:font-mono"
              value={loc.in ?? 'world'}
              onChange={(e: { target: { value: string } }) => setLoc({ ...loc, in: e.target.value })}
            />
          </ui.Field>
        </div>
        {!keyPaths.size && (
          <p className="ue:flex ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:bg-warning/8 ue:px-2.5 ue:py-1.5 ue:text-footnote ue:text-warning">
            <TriangleAlert className="ue:h-3.5 ue:w-3.5" />
            {t('没勾标识：按第一个找（关卡里放的在前，再按名字），同类有几个时可能找错')}
          </p>
        )}
        <div className="ue:flex ue:h-[42vh] ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
          {!ctx.live && (
            <p className="ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-caption ue:text-warning">
              {t('编辑器没开：列不出这个类的属性，可以在下面直接写标识')}
            </p>
          )}
          {vars.error && <p className="ue:px-3 ue:py-1.5 ue:text-caption ue:text-danger">{vars.error}</p>}
          <FieldGroups
            multi
            showValue
            groups={groups}
            selected={selected}
            onToggle={(g, it) => toggle(g.src, it)}
            extra={(it) =>
              it.score ? (
                <span
                  className={
                    it.score === 'high'
                      ? 'ue:text-caption ue:text-success'
                      : it.score === 'no'
                        ? 'ue:text-caption ue:text-subtle'
                        : 'ue:text-caption ue:text-muted'
                  }
                >
                  {it.unique ? t('同类唯一 · ') : ''}
                  {scoreLabel(it.score)}
                </span>
              ) : null
            }
          />
        </div>
        <div className="ue:flex ue:flex-col ue:gap-1.5">
          <span className="ue:text-footnote ue:text-subtle">{t('标识（都要等于；值可以写 $变量、= 表达式）')}</span>
          {Object.entries(key).map(([p, v]) => (
            <div key={p} className="ue:flex ue:items-center ue:gap-2">
              <span className="ue:w-48 ue:shrink-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{p}</span>
              <ui.Input
                size="sm"
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                value={scalarText(v)}
                title={show(v)}
                onChange={(e: { target: { value: string } }) =>
                  setLoc({ ...loc, key: { ...key, [p]: parseScalar(e.target.value) } })
                }
              />
            </div>
          ))}
          <AddKey onAdd={(p) => setLoc({ ...loc, key: { ...key, [p]: '' } })} />
        </div>
      </div>
      {picking && (
        <PickDialog
          mode="object"
          onClose={() => setPicking(false)}
          onObject={(c) => {
            // 换了类，原来勾的标识多半不是这个类的属性：清掉重勾
            setLoc({ ...loc, class: c, key: c === loc.class ? loc.key : undefined })
            setCls(c)
            setPicking(false)
          }}
        />
      )}
    </ui.Modal>
  )
}

/** 手写一个标识路径（编辑器没开、或属性在更深的结构里） */
function AddKey({ onAdd }: { onAdd: (path: string) => void }) {
  const { ui } = h()
  const [p, setP] = useState('')
  return (
    <div className="ue:flex ue:items-center ue:gap-2">
      <ui.Input
        size="sm"
        className="ue:w-48 ue:font-mono"
        placeholder={t('NpcId、@lua.id')}
        value={p}
        onChange={(e: { target: { value: string } }) => setP(e.target.value)}
      />
      <ui.Button
        size="sm"
        variant="ghost"
        disabled={!p.trim()}
        onClick={() => {
          onAdd(p.trim())
          setP('')
        }}
      >
        {t('加标识')}
      </ui.Button>
    </div>
  )
}
