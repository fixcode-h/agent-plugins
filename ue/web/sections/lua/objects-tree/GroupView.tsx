import { Braces, Component, FileText, ScanSearch } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import { useModules } from '../lua-data.ts'
import { useOpenLua } from '../open-file.ts'
import { StateBadge, StateDot, worldName } from './parts.tsx'
import type { LuaSel } from './tree-data.ts'
import { classesOf, isA, stateOf, type BoundObj } from './tree-model.ts'

/**
 * 树里点了一个 Lua 类（模块）或 UE 类：右边列出它下面的全部对象（UE 类含子类），
 * 模块给「检视模块表」「打开 .lua」，UE 类给父类、子类和绑定的模块（设计稿效果图 2）
 */
export function GroupView({
  by,
  name,
  objs,
  onSelect,
}: {
  by: 'module' | 'class'
  name: string
  objs: BoundObj[]
  onSelect: (s: LuaSel) => void
}) {
  const { ui, cn } = h()
  const mods = useModules()
  const openLua = useOpenLua()
  const list = objs.filter((o) => (by === 'module' ? o.module === name : isA(o, name)))
  const sample = list.find((o) => classesOf(o).includes(name))
  const parents = sample ? classesOf(sample).slice(classesOf(sample).indexOf(name) + 1) : []
  const subs = [...new Set(list.filter((o) => o.class !== name).map((o) => o.class))].sort()
  const boundMods = [...new Set(list.filter((o) => by === 'module' || o.class === name).map((o) => o.module))].filter(Boolean)
  const file = by === 'module' ? mods.data?.items.find((m) => m.name === name)?.file : undefined
  const Icon = by === 'module' ? Braces : Component

  return (
    <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-3">
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <Icon className={cn('ue:h-4 ue:w-4', by === 'module' ? 'ue:text-accent-text' : 'ue:text-run')} />
          <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">{name || t('（没认出模块）')}</span>
          <Badge tone={by === 'module' ? 'accent' : 'run'}>{by === 'module' ? t('Lua 类（模块）') : t('UE 类')}</Badge>
          <span className="ue:ml-auto" />
          {by === 'module' && name && (
            <ui.Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onSelect({ kind: 'root', root: { path: '', keys: ['package', 'loaded', name], label: name } })
              }
            >
              <ScanSearch className="ue:h-3.5 ue:w-3.5" /> {t('检视模块表')}
            </ui.Button>
          )}
          {file && (
            <ui.Button size="sm" variant="secondary" onClick={() => openLua(file)}>
              <FileText className="ue:h-3.5 ue:w-3.5" /> {t('打开 .lua')}
            </ui.Button>
          )}
        </div>
        {by === 'class' && (
          <dl className="ue:grid ue:grid-cols-[auto_1fr] ue:gap-x-3 ue:gap-y-1 ue:text-caption">
            {!!parents.length && (
              <>
                <dt className="ue:text-subtle">{t('父类')}</dt>
                <dd className="ue:truncate ue:font-mono ue:text-muted" title={parents.join(' › ')}>
                  {parents.slice(0, 6).join(' › ')}
                  {parents.length > 6 ? ' › …' : ''}
                </dd>
              </>
            )}
            {!!subs.length && (
              <>
                <dt className="ue:text-subtle">{t('子类')}</dt>
                <dd className="ue:truncate ue:font-mono ue:text-muted">{subs.join('、')}</dd>
              </>
            )}
            {!!boundMods.length && (
              <>
                <dt className="ue:text-subtle">{t('绑定的模块')}</dt>
                <dd className="ue:truncate ue:font-mono ue:text-muted">{boundMods.join('、')}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        <h3 className="ue:sticky ue:top-0 ue:z-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-1 ue:text-caption ue:font-medium ue:text-muted">
          {by === 'class' ? t('这个类和子类的对象（{n}）', { n: list.length }) : t('绑定这个模块的对象（{n}）', { n: list.length })}
        </h3>
        {list.map((o) => (
          <button
            key={o.path}
            type="button"
            title={o.path}
            onClick={() => onSelect({ kind: 'root', root: { path: o.path, keys: [], label: o.name } })}
            className="ue:grid ue:w-full ue:cursor-pointer ue:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5 ue:text-left ue:hover:bg-hover"
          >
            <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:font-mono ue:text-footnote ue:text-fg">
              <StateDot state={stateOf(o)} />
              <span className="ue:truncate">{o.name}</span>
            </span>
            <span className="ue:truncate ue:font-mono ue:text-caption ue:text-muted">
              {by === 'module' ? o.class : o.module}
            </span>
            <span className="ue:truncate ue:text-caption ue:text-subtle">{o.world ? worldName(o.world) : o.state === 'noworld' ? worldName('') : ''}</span>
            <span>{stateOf(o) !== 'alive' && <StateBadge state={stateOf(o)} />}</span>
          </button>
        ))}
        {!list.length && <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('现在没有对象')}</p>}
      </div>
    </div>
  )
}
