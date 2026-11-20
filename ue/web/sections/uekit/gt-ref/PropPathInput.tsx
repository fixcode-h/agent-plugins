import { Braces, Calculator, Code2, FileCode2, Puzzle } from 'lucide-react'
import type { GtPropGroup, GtPropItem } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'
import { SuggestInput, type SuggestRow } from '../../../SuggestInput.tsx'
import { stateHint, STATE_KINDS } from './compare-table.ts'

const ICON = { cpp: Code2, bp: Puzzle, lua: FileCode2, state: Calculator }

/** `@lua.` / `@部件.lua.` 后面正在打的字段名：给 Lua 字段下拉用 */
const LUA_TAIL = /^(@(?:[\w.]*?\.)?(?:lua|itemLua)\.)(\w*)$/

/**
 * 属性路径输入框（`@self.X`、`@部件:状态`、`@lua.字段`）：能直接填文字，也能从下拉里挑。
 * 打到 `@lua.` 时下拉换成 Lua 字段名（用户 2026-11-20：「@field 这个标识针对 lua 的变量下拉支持下拉搜索的可以从这个声明获取，
 * 然后也支持直接填文本」）——选项是 gt.props 里 src=lua 的项（服务端已把源码的 `---@field` 声明合进来），
 * 下拉里没有的字段照样收。其余时候列属性树里全部能写的路径和算出状态
 */
export function PropPathInput({
  value,
  onChange,
  groups = [],
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  /** 这个对象的属性树（gt.props 的 groups）；编辑器没开时可以只有按类读出来的 */
  groups?: GtPropGroup[]
  placeholder?: string
  className?: string
}) {
  const items = groups.flatMap((g) => g.items)
  const suggest = (q: string) => {
    const m = LUA_TAIL.exec(q)
    if (m) {
      // Lua 字段：同一个部件（或对象自己）的 lua 组；没分部件时列出全部 lua 项
      const head = m[1]
      const k = m[2].toLowerCase()
      const lua = items.filter((i) => i.src === 'lua' && i.prop.startsWith(head))
      const pool = lua.length ? lua : items.filter((i) => i.src === 'lua')
      const rows = pool
        .map((i) => ({ i, name: i.prop.slice(i.prop.lastIndexOf('.') + 1) }))
        .filter(({ name }) => !k || name.toLowerCase().includes(k))
        .map(({ i, name }) => row(i, `${head}${name}`, name))
      return { rows: rows.slice(0, 60), total: rows.length }
    }
    const k = q.trim().toLowerCase()
    const all: SuggestRow[] = items.map((i) => row(i, i.prop, i.prop))
    // 属性树里没列的算出状态也给（编辑器没开时属性树可能是空的）
    for (const s of Object.keys(STATE_KINDS))
      if (!items.some((i) => i.prop === `:${s}`))
        all.push({ key: `:${s}`, value: `:${s}`, label: `:${s}`, detail: stateHint(s), icon: Calculator })
    const rows = all.filter((r) => !k || r.value.toLowerCase().includes(k))
    return { rows: rows.slice(0, 60), total: rows.length }
  }
  return (
    <SuggestInput
      className={className}
      inputClassName="ue:font-mono"
      value={value}
      onChange={onChange}
      suggest={suggest}
      placeholder={placeholder ?? t('@self.字段、@部件:text、@lua.字段')}
      empty={t('没有候选（游戏没开、类里没读到），可以直接填')}
      status={LUA_TAIL.test(value) ? t('Lua 字段：来自源码 ---@field 声明和此刻的实例表，也能直接填') : undefined}
    />
  )
}

function row(i: GtPropItem, value: string, label: string): SuggestRow {
  return {
    key: i.prop,
    value,
    label,
    detail: i.type,
    icon: ICON[i.src] ?? Braces,
    tone: i.src === 'lua' ? 'ue:text-warning' : undefined,
  }
}

/** 部件下拉（`BtnBuy`、`Header.BtnClose`）：选项是属性树里的部件组，也能直接填 */
export function PartInput({
  value,
  onChange,
  parts,
  className,
}: {
  value: string
  onChange: (v: string) => void
  parts: { part: string; class?: string }[]
  className?: string
}) {
  return (
    <SuggestInput
      className={className}
      inputClassName="ue:font-mono"
      value={value}
      onChange={onChange}
      placeholder={t('部件（不填 = 对象本身）')}
      empty={t('没读到部件，可以直接填控件名')}
      suggest={(q) => {
        const k = q.trim().toLowerCase()
        const rows = parts
          .filter((p) => !k || p.part.toLowerCase().includes(k))
          .map((p) => ({ key: p.part, value: p.part, label: p.part, detail: p.class, icon: Puzzle }))
        return { rows: rows.slice(0, 80), total: rows.length }
      }}
    />
  )
}

/** 属性树里的部件组 → 部件下拉的选项 */
export const partsOf = (groups: GtPropGroup[] | undefined) =>
  (groups ?? []).filter((g) => g.part).map((g) => ({ part: g.part!, class: g.class }))
