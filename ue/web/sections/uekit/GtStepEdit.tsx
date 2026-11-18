import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, CopyPlus, Pencil, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { ppost, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Confirm, ErrorText } from '../../ui.tsx'
import type { StepDef } from './GtStepDetail.tsx'

/** 插入新步骤时的起点：常用动作的骨架，用户在下面的 JSON 里补全（字段见 gt.actions / 文档的动作表） */
const templates = (current: StepDef): { id: string; label: string; step: Record<string, unknown> }[] => [
  { id: 'copy', label: t('照这一步复制'), step: current },
  { id: 'click', label: t('点击控件'), step: { action: 'click', target: '屏名:路径', note: '' } },
  { id: 'waitWidget', label: t('等控件出现'), step: { action: 'wait', until: 'widget', target: '屏名:路径' } },
  { id: 'waitSeconds', label: t('等几秒'), step: { action: 'wait', until: 'seconds', seconds: 1 } },
  { id: 'key', label: t('按键'), step: { action: 'key', key: 'Escape' } },
  { id: 'assert', label: t('断言控件可见'), step: { action: 'assert', target: '屏名:路径', visible: true } },
  { id: 'console', label: t('控制台指令'), step: { action: 'console', command: '' } },
  {
    id: 'reset',
    label: t('GM：重置状态'),
    step: { action: 'console', command: 'gm.ResetGuide', note: '重置引导，换成项目自己的 GM' },
  },
  { id: 'screenshot', label: t('截图'), step: { action: 'screenshot', name: 'shot' } },
  { id: 'mark', label: t('写一句说明'), step: { action: 'mark', text: '' } },
]

const pretty = (v: unknown) => JSON.stringify(v, null, 2)

/** 一次改动：从 index 起把 before 换成 after。撤销就是反过来换一次（同样带核对） */
type Change = { index: number; before: StepDef[]; after: StepDef[]; what: string; path?: string }

/** 第 a–b 步（从 1 数）的写法：只有一步时不写成「第 3–3 步」 */
const span = (from: number, count: number) =>
  count === 1 ? t('第 {n} 步', { n: from + 1 }) : t('第 {a}–{b} 步', { a: from + 1, b: from + count })

/**
 * GameTest 步骤右键的插入、编辑、复制一份、上移下移、删除（这一步 / 之前所有 / 之后所有）和撤销。改场景文件走
 * ext/gt/file replace：带上网页看到的原步骤核对，文件在这期间被重新录制或 Agent 改过就报错让刷新，不按行号硬改。
 * 撤销只记最近一次（用户 2026-11-18 要的批量删除容易删错，删除类都先确认、做完还能撤销）
 */
export function useStepEdit(o: {
  project: string
  root: string
  path: string
  onDone: () => void
  /** 上移 / 下移后让选中跟着这一步走 */
  onPick?: (index: number) => void
}) {
  const { busy, run } = useAction()
  // edit：同一个弹窗改这一步本身（不给模板，直接改 JSON）
  const [inserting, setInserting] = useState<{ index: number; def: StepDef; below: boolean; edit?: boolean }>()
  const [tpl, setTpl] = useState('click')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // 要删的一段：index 起的 defs（删这一步、之前所有、之后所有共用一个确认框）
  const [deleting, setDeleting] = useState<{ index: number; defs: StepDef[] }>()
  const [last, setUndo] = useState<Change>()

  const apply = async (c: Change) => {
    await ppost(o.project, 'ext/gt/file', {
      root: o.root,
      path: o.path,
      action: 'replace',
      index: c.index,
      expect: c.before,
      steps: c.after,
    })
    // 记下是哪个场景：切到别的场景后不给撤销上一个场景的改动
    setUndo({ ...c, path: o.path })
  }
  const replace = (index: number, def: StepDef, steps: Record<string, unknown>[], what: string) =>
    apply({ index, before: [def], after: steps as StepDef[], what })

  const startInsert = (index: number, def: StepDef, below: boolean) => {
    const first = templates(def).find((x) => x.id === 'click')!
    setTpl(first.id)
    setText(pretty(first.step))
    setError('')
    setInserting({ index, def, below })
  }
  const startEdit = (index: number, def: StepDef) => {
    setText(pretty(def))
    setError('')
    setInserting({ index, def, below: false, edit: true })
  }
  const pickTpl = (id: string) => {
    if (!inserting) return
    setTpl(id)
    const found = templates(inserting.def).find((x) => x.id === id)
    if (found) setText(pretty(found.step))
  }

  const insert = () => {
    if (!inserting) return
    let step: unknown
    try {
      step = JSON.parse(text)
    } catch (e) {
      setError(t('不是合法的 JSON：{e}', { e: (e as Error).message }))
      return
    }
    if (
      !step ||
      typeof step !== 'object' ||
      Array.isArray(step) ||
      typeof (step as StepDef).action !== 'string' ||
      !(step as StepDef).action
    ) {
      setError(t('要写成一个对象，并且有 action 字段'))
      return
    }
    const { index, def, below, edit } = inserting
    void run('insert', async () => {
      const added = step as Record<string, unknown>
      await replace(
        index,
        def,
        edit ? [added] : below ? [def, added] : [added, def],
        edit ? t('编辑第 {n} 步', { n: index + 1 }) : t('插入一步'),
      )
      setInserting(undefined)
      h().toast.success(
        edit ? t('已保存第 {n} 步', { n: index + 1 }) : t('已插入为第 {n} 步', { n: below ? index + 2 : index + 1 }),
      )
      o.onDone()
    })
  }

  const remove = () => {
    if (!deleting) return
    const { index, defs } = deleting
    void run('delete', async () => {
      const what = t('删除{s}', { s: span(index, defs.length) })
      await apply({ index, before: defs, after: [], what })
      setDeleting(undefined)
      h().toast.success(t('已{w}，右键步骤可以撤销', { w: what }))
      o.onDone()
    })
  }

  /** 不弹窗、马上做的改动（上移下移、复制一份）：做完提示，选中跟到 pick */
  const quick = (c: Change, pick?: number) =>
    void run('quick', async () => {
      await apply(c)
      h().toast.success(t('已{w}', { w: c.what }))
      if (pick !== undefined) o.onPick?.(pick)
      o.onDone()
    })

  const revert = () => {
    if (!last) return
    const c = last
    void run('undo', async () => {
      await ppost(o.project, 'ext/gt/file', {
        root: o.root,
        path: o.path,
        action: 'replace',
        index: c.index,
        expect: c.after,
        steps: c.before,
      })
      setUndo(undefined)
      h().toast.success(t('已撤销：{w}', { w: c.what }))
      o.onDone()
    })
  }

  /** 步骤右键菜单里的几项（没有场景里写的步骤、正在运行时不给改）。defs：场景里全部步骤，算前后几步用 */
  const menuItems = (index: number, defs: StepDef[], locked: boolean) => {
    const def = defs[index]
    if (!def) return []
    const off = locked || !!busy
    const prev = defs[index - 1]
    const next = defs[index + 1]
    const after = defs.slice(index + 1)
    const undo = last?.path === o.path ? last : undefined
    return [
      undo && {
        label: t('撤销：{w}', { w: undo.what }),
        icon: Undo2,
        disabled: off,
        onClick: revert,
      },
      undo && ('sep' as const),
      { label: t('在上面插入一步'), icon: ArrowUpToLine, disabled: off, onClick: () => startInsert(index, def, false) },
      {
        label: t('在下面插入一步'),
        icon: ArrowDownToLine,
        disabled: off,
        onClick: () => startInsert(index, def, true),
      },
      {
        label: t('复制一份到下面'),
        icon: CopyPlus,
        disabled: off,
        onClick: () =>
          quick({ index, before: [def], after: [def, def], what: t('复制第 {n} 步', { n: index + 1 }) }, index + 1),
      },
      { label: t('编辑这一步…'), icon: Pencil, disabled: off, onClick: () => startEdit(index, def) },
      'sep' as const,
      {
        label: t('上移'),
        icon: ArrowUp,
        disabled: off || !prev,
        onClick: () =>
          quick(
            { index: index - 1, before: [prev!, def], after: [def, prev!], what: t('上移第 {n} 步', { n: index + 1 }) },
            index - 1,
          ),
      },
      {
        label: t('下移'),
        icon: ArrowDown,
        disabled: off || !next,
        onClick: () =>
          quick(
            { index, before: [def, next!], after: [next!, def], what: t('下移第 {n} 步', { n: index + 1 }) },
            index + 1,
          ),
      },
      'sep' as const,
      {
        label: t('删除这一步'),
        icon: Trash2,
        danger: true,
        disabled: off,
        onClick: () => setDeleting({ index, defs: [def] }),
      },
      {
        label: index ? t('删除前面所有步骤（{n} 步）', { n: index }) : t('删除前面所有步骤'),
        icon: Trash2,
        danger: true,
        disabled: off || !index,
        onClick: () => setDeleting({ index: 0, defs: defs.slice(0, index) }),
      },
      {
        label: after.length ? t('删除后面所有步骤（{n} 步）', { n: after.length }) : t('删除后面所有步骤'),
        icon: Trash2,
        danger: true,
        disabled: off || !after.length,
        onClick: () => setDeleting({ index: index + 1, defs: after }),
      },
    ]
  }

  const { ui } = h()
  const dialogs = (
    <>
      <ui.Modal
        open={!!inserting}
        onOpenChange={(v: boolean) => !v && setInserting(undefined)}
        title={
          inserting?.edit
            ? t('编辑第 {n} 步', { n: (inserting?.index ?? 0) + 1 })
            : inserting?.below
              ? t('在第 {n} 步下面插入', { n: (inserting?.index ?? 0) + 1 })
              : t('在第 {n} 步上面插入', { n: (inserting?.index ?? 0) + 1 })
        }
        footer={
          <>
            <ui.Button variant="secondary" onClick={() => setInserting(undefined)}>
              {t('取消')}
            </ui.Button>
            <ui.Button variant="primary" disabled={!!busy} onClick={insert}>
              {inserting?.edit ? t('保存') : t('插入')}
            </ui.Button>
          </>
        }
      >
        <div className="ue:flex ue:flex-col ue:gap-3">
          {!inserting?.edit && (
            <ui.Field label={t('从哪个写法开始')}>
              <ui.Select
                value={tpl}
                onChange={(e: { target: { value: string } }) => pickTpl(e.target.value)}
                options={inserting ? templates(inserting.def).map((x) => ({ value: x.id, label: x.label })) : []}
              />
            </ui.Field>
          )}
          <ui.Field
            label={t('步骤（JSON）')}
            hint={t('字段见 GameTest 的动作表；选择器不会写时，在游戏里对着控件用「检视」或从别的步骤复制')}
          >
            <ui.Textarea
              rows={inserting?.edit ? 16 : 10}
              className="ue:font-mono"
              value={text}
              onChange={(e: { target: { value: string } }) => {
                setText(e.target.value)
                setError('')
              }}
            />
          </ui.Field>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      </ui.Modal>
      <Confirm
        open={!!deleting}
        danger
        title={t('删除步骤')}
        okText={t('删除')}
        onOk={remove}
        onCancel={() => setDeleting(undefined)}
      >
        {deleting && deleting.defs.length > 1
          ? t('删除{s}，共 {n} 步？直接改场景文件；删完可以在步骤右键菜单里撤销。', {
              s: span(deleting.index, deleting.defs.length),
              n: deleting.defs.length,
            })
          : t('删除第 {n} 步（{a}）？直接改场景文件；删完可以在步骤右键菜单里撤销。', {
              n: (deleting?.index ?? 0) + 1,
              a: deleting?.defs[0]?.action ?? '',
            })}
      </Confirm>
    </>
  )

  return { menuItems, dialogs, startEdit }
}
