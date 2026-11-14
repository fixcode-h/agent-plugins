import { useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import { draftItemIds, type TablesDraft } from '@shared/tables-assist'
import { TYPE_NAMES } from '@shared/tables'
import type { HeaderRule } from '@shared/table-header'
import { typeKindLabel } from './TypeEditor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { roleShort } from '@/components/files/sheet-roles'

/**
 * AI 分析表格风格的结果：一项一行，勾上的才写进结构文件。
 * 项目设置「表格」页底下和 AI 分析窗口右侧的功能面板共用这一份
 */
/** 表头的一句话，带上每行能填什么：「从第 1 行开始：修饰（Modifier）/ 类型（基础类型和通用枚举名）/ 字段」 */
function headerDetail(h: HeaderRule) {
  return t('从第 {n} 行开始：{roles}', {
    n: h.start + 1,
    roles: h.rows
      .map((r) => {
        const name = r.label || roleShort(r.kind)
        if (!r.values) return name
        return `${name}（${r.values === TYPE_NAMES ? t('基础类型和通用枚举名') : r.values}）`
      })
      .join(' / '),
  })
}

export function DraftReview({
  draft,
  onCancel,
  onApply,
}: {
  draft: TablesDraft
  /** 丢掉这份结果（项目设置里暂存的那份）；分析窗口右侧的是对话里的回复，没有这个按钮 */
  onCancel?: () => void
  onApply: (picked: Set<string>) => Promise<void>
}) {
  const ids = useMemo(() => draftItemIds(draft), [draft])
  const [picked, setPicked] = useState(() => new Set(ids))
  const [saving, setSaving] = useState(false)
  const s = draft.style
  const items: { id: string; label: string; detail: string }[] = ids.map((id) => {
    if (id === 'header')
      return { id, label: t('表头（{n} 行）', { n: s.header!.rows.length }), detail: headerDetail(s.header!) }
    if (id === 'arrayMarks') return { id, label: t('表示数组的修饰'), detail: s.arrayMarks!.join(', ') }
    if (id === 'key') return { id, label: t('主键'), detail: s.key! }
    if (id === 'listSep') return { id, label: t('列表分隔符'), detail: s.listSep! }
    if (id === 'primitives') return { id, label: t('基础类型'), detail: s.primitives!.join(', ') }
    if (id.startsWith('ex:')) {
      const e = s.exceptions![Number(id.slice(3))]
      return {
        id,
        label: t('按文件指定：{glob}', { glob: e.sheet ? `${e.glob} · ${e.sheet}` : e.glob }),
        detail: [headerDetail(e.header), e.why].filter(Boolean).join(' · '),
      }
    }
    if (id.startsWith('enum:')) {
      const e = draft.enums[id.slice(5)]
      return {
        id,
        label: t('枚举：{name}', { name: id.slice(5) }),
        detail: e.values.map((v) => v.name).join(', '),
      }
    }
    if (id.startsWith('type:')) {
      const ty = draft.types[id.slice(5)]
      return {
        id,
        label: t('类型：{name}', { name: id.slice(5) }),
        detail: [
          typeKindLabel(ty.kind),
          ty.fields?.map((f) => `${f.name}: ${f.type}`).join(', '),
          ty.of,
          ty.store && t('存储 {tpl}', { tpl: ty.store }),
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }
    if (id === 'formats') {
      const f = draft.formats!
      return {
        id,
        label: t('数组、映射的写法'),
        detail: [
          f.listStore && t('数组 {v}', { v: JSON.stringify(f.listStore) }),
          f.mapStore && t('映射 {v}', { v: JSON.stringify(f.mapStore) }),
          f.field && t('结构体字段用 {sep} 隔开', { sep: f.field }),
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }
    const c = draft.columns[id.slice(4)]
    return {
      id,
      label: t('列：{key}', { key: id.slice(4).replace('#*#', ' · ') }),
      detail: [
        c.ref && t('引用 {ref}', { ref: c.ref }),
        c.min !== undefined && t('最小 {n}', { n: c.min }),
        c.max !== undefined && t('最大 {n}', { n: c.max }),
        c.allow?.length && t('也允许 {v}', { v: c.allow.join(', ') }),
        c.note,
      ]
        .filter(Boolean)
        .join(' · '),
    }
  })
  return (
    <section aria-label={t('AI 分析结果')} className="tb:rounded-(--c-card-radius) tb:border tb:bg-panel">
      <header className="tb:border-b tb:px-3 tb:py-2.5">
        <p className="tb:text-body tb:font-medium">{t('AI 分析结果')}</p>
        {draft.summary && <p className="tb:mt-0.5 tb:text-footnote tb:text-muted">{draft.summary}</p>}
      </header>
      {items.length === 0 ? (
        <p className="tb:px-3 tb:py-3 tb:text-footnote tb:text-subtle">{t('这次分析没有给出可以写进结构文件的内容')}</p>
      ) : (
        <ul className="tb:max-h-80 tb:divide-y tb:overflow-y-auto">
          {items.map((it) => (
            <li key={it.id} className="tb:flex tb:items-start tb:gap-3 tb:px-3 tb:py-2">
              <Checkbox
                checked={picked.has(it.id)}
                ariaLabel={it.label}
                onChange={(v) =>
                  setPicked((p) => {
                    const n = new Set(p)
                    if (v) n.add(it.id)
                    else n.delete(it.id)
                    return n
                  })
                }
                className="tb:mt-0.5"
              />
              <span className="tb:min-w-0 tb:flex-1">
                <span className="tb:block tb:truncate tb:text-footnote tb:font-medium">{it.label}</span>
                <span className="tb:block tb:truncate tb:font-mono tb:text-caption tb:text-subtle" title={it.detail}>
                  {it.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer className="tb:flex tb:items-center tb:justify-end tb:gap-2 tb:border-t tb:px-3 tb:py-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('不要了')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={!picked.size || saving}
          onClick={async () => {
            setSaving(true)
            await onApply(picked)
            setSaving(false)
          }}
        >
          {t('应用到表格设置（{n} 项）', { n: picked.size })}
        </Button>
      </footer>
    </section>
  )
}
