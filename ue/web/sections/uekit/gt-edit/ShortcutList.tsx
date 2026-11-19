import { Fragment } from 'react'
import { Kbd } from '../../../jump/parts.tsx'
import { SettingGroup } from '../../../SettingRows.tsx'
import '../gt-flow/bp/keys.ts'
import { allShortcuts } from './shortcuts.ts'

/** 设置 → GameTest →「编辑快捷键」：照快捷键注册表列，只读（改按键在代码里改注册表） */
export function ShortcutList({ page }: { page: string }) {
  return (
    <>
      {allShortcuts().map((g) => (
        <SettingGroup key={g.scope} page={page} title={g.scope}>
          <div className="ue:flex ue:flex-col ue:py-1.5">
            {g.items.map((it) => (
              <div key={it.id} className="ue:flex ue:min-h-9 ue:items-center ue:justify-between ue:gap-4 ue:text-body">
                <span className="ue:min-w-0 ue:truncate ue:text-fg">{it.label}</span>
                <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1">
                  {it.keys.split(' / ').map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && <span className="ue:text-caption ue:text-subtle">/</span>}
                      <Kbd>{k}</Kbd>
                    </Fragment>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </SettingGroup>
      ))}
    </>
  )
}
