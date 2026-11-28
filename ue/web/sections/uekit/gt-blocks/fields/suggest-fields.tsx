import { Gamepad2, Keyboard, MousePointer2 } from 'lucide-react'
import { ASSET_KINDS } from '../../../../asset-icons.ts'
import { useUe } from '../../../../ctx.tsx'
import { t } from '../../../../host.ts'
import { useSearchIndex } from '../../../../jump/index-data.ts'
import { SuggestInput, type SuggestRow } from '../../../../SuggestInput.tsx'
import { matchMaps } from '../../gt-map-match.ts'
import { matchKeys } from './key-names.ts'

const MAP_LIMIT = 50

/**
 * 地图字段（level.load、pie.start 的 map）：能手填，也能从本地资源索引里搜关卡挑（和阻挡界面的 WBP 输入框同一套），
 * 填的是包路径；也能写 $变量
 */
export function MapField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { project } = useUe()
  const index = useSearchIndex(project.id)
  const { icon, tone } = ASSET_KINDS.map
  const suggest = (q: string): { rows: SuggestRow[]; total: number } => {
    const m = matchMaps(index.idx, q, MAP_LIMIT)
    return {
      total: m.total,
      rows: m.rows.map((r) => ({ key: r.pkg, value: r.pkg, label: r.name, detail: r.pkg, icon, tone })),
    }
  }
  const status = index.error
    ? t('读索引失败：{e}', { e: index.error })
    : !index.idx
      ? t('正在读资源索引…')
      : t('地图 {n} 张', { n: matchMaps(index.idx, '', 0).all })
  return (
    <SuggestInput
      className="ue:w-full"
      inputClassName="ue:font-mono"
      placeholder={placeholder ?? t('/Game/Maps/Main，或搜地图名')}
      value={value}
      onChange={onChange}
      suggest={suggest}
      status={status}
      empty={t('索引里没找到这张图，可以直接填包路径')}
    />
  )
}

const KEY_ICON = { keyboard: Keyboard, mouse: MousePointer2, gamepad: Gamepad2 }
const KEY_GROUP = { keyboard: () => t('键盘'), mouse: () => t('鼠标'), gamepad: () => t('手柄') }

/** 键字段（key 动作）：UE 键名，键盘、鼠标、手柄的常用键能直接挑，别的照样手填 */
export function KeyField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const suggest = (q: string): { rows: SuggestRow[]; total: number } => {
    const m = matchKeys(q)
    return {
      total: m.total,
      rows: m.rows.map((k) => ({
        key: k.key,
        value: k.key,
        label: k.key,
        detail: KEY_GROUP[k.group](),
        icon: KEY_ICON[k.group],
      })),
    }
  }
  return (
    <SuggestInput
      className="ue:w-full"
      inputClassName="ue:font-mono"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      suggest={suggest}
      empty={t('没有对上的常用键，直接填 UE 键名也行')}
    />
  )
}
