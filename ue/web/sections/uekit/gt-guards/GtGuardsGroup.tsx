import { Info } from 'lucide-react'
import type { GtGuard } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { AddButton, SettingGroup } from '../../../SettingRows.tsx'
import { EditContext } from '../gt-edit/ctx.ts'
import { useApis } from '../gt-api/model.ts'
import { GuardList } from './GuardList.tsx'
import { blankGuard } from './model.ts'

/**
 * 设置页的「全局守护」一组（取代阻挡界面）：对所有场景生效，存 _settings.json 的 guards。
 * 守护卡片里的条件编辑器要项目、编辑器连没连着、接口清单，这里自己给一份编辑上下文
 */
export function GtGuardsGroup({
  value,
  onChange,
  migrated,
  project,
  live,
  root,
}: {
  value: GtGuard[]
  onChange: (v: GtGuard[]) => void
  /** 是从旧的阻挡界面改写来的（还没存） */
  migrated?: boolean
  project: string
  live: boolean
  /** 场景根 */
  root: string
}) {
  const apis = useApis(project, root, live)
  return (
    <SettingGroup
      page="guards"
      title={t('全局守护')}
      action={<AddButton onClick={() => onChange([...value, blankGuard(new Set(value.map((g) => g.id ?? '')))])} />}
      hint={t(
        '公告、新手引导、活动弹窗、断线重连这类随时可能冒出来的情况：每个场景跑的时候都盯着，一出现就按这里处理掉，再接着做被打断的那一步。场景和块上也能写自己的守护，先看里层的。',
      )}
    >
      <EditContext.Provider value={{ project, root, live, apis: apis.items, aliases: [] }}>
        {migrated && (
          <p className="ue:mb-2 ue:flex ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:bg-accent/8 ue:px-2.5 ue:py-1.5 ue:text-footnote ue:text-accent">
            <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            {t('原来的阻挡界面已经按同样的意思换成了守护，保存后写进文件')}
          </p>
        )}
        {value.length ? (
          <GuardList value={value} onChange={onChange} />
        ) : (
          <p className="ue:py-3 ue:text-footnote ue:text-subtle">
            {t('还没有守护：点「添加」，例如「公告出现就关掉」')}
          </p>
        )}
      </EditContext.Provider>
    </SettingGroup>
  )
}
