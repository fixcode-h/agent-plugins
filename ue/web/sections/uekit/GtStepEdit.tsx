import { ArrowDownToLine, ArrowUpToLine, Pencil, Trash2 } from 'lucide-react'
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

/**
 * GameTest 步骤右键的「在上面 / 下面插入一步」「编辑这一步」「删除这一步」。改场景文件走 ext/gt/file replace：
 * 带上网页看到的原步骤核对，文件在这期间被重新录制或 Agent 改过就报错让刷新，不按行号硬改
 */
export function useStepEdit(o: { project: string; root: string; path: string; onDone: () => void }) {
  const { busy, run } = useAction()
  // edit：同一个弹窗改这一步本身（不给模板，直接改 JSON）
  const [inserting, setInserting] = useState<{ index: number; def: StepDef; below: boolean; edit?: boolean }>()
  const [tpl, setTpl] = useState('click')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<{ index: number; def: StepDef }>()

  const replace = (index: number, def: StepDef, steps: Record<string, unknown>[]) =>
    ppost(o.project, 'ext/gt/file', { root: o.root, path: o.path, action: 'replace', index, expect: [def], steps })

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
      await replace(index, def, edit ? [added] : below ? [def, added] : [added, def])
      setInserting(undefined)
      h().toast.success(
        edit ? t('已保存第 {n} 步', { n: index + 1 }) : t('已插入为第 {n} 步', { n: below ? index + 2 : index + 1 }),
      )
      o.onDone()
    })
  }

  const remove = () => {
    if (!deleting) return
    const { index, def } = deleting
    void run('delete', async () => {
      await replace(index, def, [])
      setDeleting(undefined)
      h().toast.success(t('已删除第 {n} 步', { n: index + 1 }))
      o.onDone()
    })
  }

  /** 步骤右键菜单里的几项（没有场景里写的步骤、正在运行时不给改） */
  const menuItems = (index: number, def: StepDef | undefined, locked: boolean) =>
    def
      ? [
          {
            label: t('在上面插入一步'),
            icon: ArrowUpToLine,
            disabled: locked,
            onClick: () => startInsert(index, def, false),
          },
          {
            label: t('在下面插入一步'),
            icon: ArrowDownToLine,
            disabled: locked,
            onClick: () => startInsert(index, def, true),
          },
          {
            label: t('编辑这一步…'),
            icon: Pencil,
            disabled: locked,
            onClick: () => startEdit(index, def),
          },
          {
            label: t('删除这一步'),
            icon: Trash2,
            danger: true,
            disabled: locked,
            onClick: () => setDeleting({ index, def }),
          },
        ]
      : []

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
        {t('删除第 {n} 步（{a}）？直接改场景文件，用 git、P4 管着的可以从版本库找回。', {
          n: (deleting?.index ?? 0) + 1,
          a: deleting?.def.action ?? '',
        })}
      </Confirm>
    </>
  )

  return { menuItems, dialogs, startEdit }
}
