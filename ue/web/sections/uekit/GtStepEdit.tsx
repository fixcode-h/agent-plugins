import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, CopyPlus, Pencil, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { ppost, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Confirm, ErrorText } from '../../ui.tsx'
import type { StepDef } from './GtStepDetail.tsx'
import { numOf } from './gt-rows/rows.ts'

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

/**
 * 一步在场景里的位置：所在槽（顶层 steps，录制段里的 steps.N.do）、槽里第几步、显示的序号（2.3）。
 * 改文件按 slot + index，提示里的「第几步」按显示的序号
 */
export interface StepAt {
  i: number
  slot: string
  no: string
}

/** 一次改动：在 slot 里从 index 起把 before 换成 after。撤销就是反过来换一次（同样带核对） */
type Change = { slot: string; index: number; before: StepDef[]; after: StepDef[]; what: string; path?: string }

/** 第 a–b 步的写法：只有一步时不写成「第 3–3 步」 */
const span = (no: (k: number) => string, from: number, count: number) =>
  count === 1 ? t('第 {n} 步', { n: no(from) }) : t('第 {a}–{b} 步', { a: no(from), b: no(from + count - 1) })

/** ext/gt/file replace 的位置参数：顶层的不带 slot，旧服务端也认 */
const slotArg = (slot: string) => (slot && slot !== 'steps' ? { slot } : {})

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
  /** 上移 / 下移后让选中跟着这一步走（给的是那一步的路径） */
  onPick?: (key: string) => void
}) {
  const { busy, run } = useAction()
  // edit：同一个弹窗改这一步本身（不给模板，直接改 JSON）
  const [inserting, setInserting] = useState<{ at: StepAt; def: StepDef; below: boolean; edit?: boolean }>()
  const [tpl, setTpl] = useState('click')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // 要删的一段：index 起的 defs（删这一步、之前所有、之后所有共用一个确认框）
  const [deleting, setDeleting] = useState<{ at: StepAt; index: number; defs: StepDef[] }>()
  const [last, setUndo] = useState<Change>()

  const apply = async (c: Change) => {
    await ppost(o.project, 'ext/gt/file', {
      root: o.root,
      path: o.path,
      action: 'replace',
      ...slotArg(c.slot),
      index: c.index,
      expect: c.before,
      steps: c.after,
    })
    // 记下是哪个场景：切到别的场景后不给撤销上一个场景的改动
    setUndo({ ...c, path: o.path })
  }
  const replace = (at: StepAt, def: StepDef, steps: Record<string, unknown>[], what: string) =>
    apply({ slot: at.slot, index: at.i, before: [def], after: steps as StepDef[], what })

  const startInsert = (at: StepAt, def: StepDef, below: boolean) => {
    const first = templates(def).find((x) => x.id === 'click')!
    setTpl(first.id)
    setText(pretty(first.step))
    setError('')
    setInserting({ at, def, below })
  }
  const startEdit = (at: StepAt, def: StepDef) => {
    setText(pretty(def))
    setError('')
    setInserting({ at, def, below: false, edit: true })
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
    const { at, def, below, edit } = inserting
    const no = numOf(at)
    void run('insert', async () => {
      const added = step as Record<string, unknown>
      await replace(
        at,
        def,
        edit ? [added] : below ? [def, added] : [added, def],
        edit ? t('编辑第 {n} 步', { n: at.no }) : t('插入一步'),
      )
      setInserting(undefined)
      h().toast.success(
        edit ? t('已保存第 {n} 步', { n: at.no }) : t('已插入为第 {n} 步', { n: no(below ? at.i + 1 : at.i) }),
      )
      o.onDone()
    })
  }

  const remove = () => {
    if (!deleting) return
    const { at, index, defs } = deleting
    void run('delete', async () => {
      const what = t('删除{s}', { s: span(numOf(at), index, defs.length) })
      await apply({ slot: at.slot, index, before: defs, after: [], what })
      setDeleting(undefined)
      h().toast.success(t('已{w}，右键步骤可以撤销', { w: what }))
      o.onDone()
    })
  }

  /** 不弹窗、马上做的改动（上移下移、复制一份）：做完提示，选中跟到 pick */
  const quick = (c: Change, pick?: string) =>
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
        ...slotArg(c.slot),
        index: c.index,
        expect: c.after,
        steps: c.before,
      })
      setUndo(undefined)
      h().toast.success(t('已撤销：{w}', { w: c.what }))
      o.onDone()
    })
  }

  /**
   * 步骤右键菜单里的几项（没有场景里写的步骤、正在运行时不给改）。defs：这一步所在槽的全部步骤（录制段里的是段里的），
   * 上移下移、删前面 / 后面所有都只在这个槽里
   */
  const menuItems = (at: StepAt, defs: StepDef[], locked: boolean) => {
    const index = at.i
    const def = defs[index]
    if (!def) return []
    const no = numOf(at)
    const slot = at.slot
    const keyOf = (k: number) => `${slot}.${k}`
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
      { label: t('在上面插入一步'), icon: ArrowUpToLine, disabled: off, onClick: () => startInsert(at, def, false) },
      {
        label: t('在下面插入一步'),
        icon: ArrowDownToLine,
        disabled: off,
        onClick: () => startInsert(at, def, true),
      },
      {
        label: t('复制一份到下面'),
        icon: CopyPlus,
        disabled: off,
        onClick: () =>
          quick(
            { slot, index, before: [def], after: [def, def], what: t('复制第 {n} 步', { n: at.no }) },
            keyOf(index + 1),
          ),
      },
      { label: t('编辑这一步…'), icon: Pencil, disabled: off, onClick: () => startEdit(at, def) },
      'sep' as const,
      {
        label: t('上移'),
        icon: ArrowUp,
        disabled: off || !prev,
        onClick: () =>
          quick(
            {
              slot,
              index: index - 1,
              before: [prev!, def],
              after: [def, prev!],
              what: t('上移第 {n} 步', { n: at.no }),
            },
            keyOf(index - 1),
          ),
      },
      {
        label: t('下移'),
        icon: ArrowDown,
        disabled: off || !next,
        onClick: () =>
          quick(
            { slot, index, before: [def, next!], after: [next!, def], what: t('下移第 {n} 步', { n: at.no }) },
            keyOf(index + 1),
          ),
      },
      'sep' as const,
      {
        label: t('删除这一步'),
        icon: Trash2,
        danger: true,
        disabled: off,
        onClick: () => setDeleting({ at, index, defs: [def] }),
      },
      {
        // 块里的步骤只删同一段里的，标题说清楚，免得以为连外面的也删
        label:
          slot !== 'steps'
            ? t('删除段里前面所有步骤（{n} 步）', { n: index })
            : index
              ? t('删除前面所有步骤（{n} 步）', { n: index })
              : t('删除前面所有步骤'),
        icon: Trash2,
        danger: true,
        disabled: off || !index,
        onClick: () => setDeleting({ at, index: 0, defs: defs.slice(0, index) }),
      },
      {
        label:
          slot !== 'steps'
            ? t('删除段里后面所有步骤（{n} 步）', { n: after.length })
            : after.length
              ? t('删除后面所有步骤（{n} 步）', { n: after.length })
              : t('删除后面所有步骤'),
        icon: Trash2,
        danger: true,
        disabled: off || !after.length,
        onClick: () => setDeleting({ at, index: index + 1, defs: after }),
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
            ? t('编辑第 {n} 步', { n: inserting.at.no })
            : inserting?.below
              ? t('在第 {n} 步下面插入', { n: inserting.at.no })
              : t('在第 {n} 步上面插入', { n: inserting?.at.no ?? '' })
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
              s: span(numOf(deleting.at), deleting.index, deleting.defs.length),
              n: deleting.defs.length,
            })
          : t('删除第 {n} 步（{a}）？直接改场景文件；删完可以在步骤右键菜单里撤销。', {
              n: deleting ? numOf(deleting.at)(deleting.index) : '',
              a: deleting?.defs[0]?.action ?? '',
            })}
      </Confirm>
    </>
  )

  return { menuItems, dialogs, startEdit }
}
