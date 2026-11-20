import { Power, Skull } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import type { Instance } from '../../server/types.ts'
import type { CloseResult } from '../../server/editor-close/close.ts'
import { ppost } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { MenuHost, openMenu } from '../menu.tsx'
import { Confirm, kindLabel } from '../ui.tsx'

interface Ask {
  inst: Instance
  force: boolean
  /** 正常关没关掉的原因，强制结束的确认里写给人看 */
  reason?: string
}

/**
 * 目标下拉、目标小块右键「关闭编辑器」（用户 2026-11-20：怎么有两个编辑器，允许右键直接关）。
 * 先确认再正常关（和点窗口的叉一样，有没保存的改动 UE 自己弹窗问）；没关掉再问要不要强制结束。
 * 返回 menu(e, inst) 打开右键菜单，dialog 放进组件里渲染（确认弹窗 + 菜单宿主）
 */
export function useCloseEditor() {
  const { project, reload } = useUe()
  const [ask, setAsk] = useState<Ask>()
  const name = (i: Instance) => `${kindLabel(i.kind)} ${i.pid}`

  const run = async (a: Ask) => {
    setAsk(undefined)
    const id = h().toast
    try {
      const r = await ppost<CloseResult>(project.id, 'close-instance', { pid: a.inst.pid, force: a.force })
      if (r.stale) id.success(t('{name} 是失效的旧记录（进程早就退出了），已清掉', { name: name(a.inst) }))
      else if (r.closed) id.success(t('{name} 已关闭', { name: name(a.inst) }))
      else setAsk({ inst: a.inst, force: true, reason: r.reason })
    } catch (e) {
      id.error((e as Error).message)
    } finally {
      reload()
    }
  }

  const menu = (e: MouseEvent, inst: Instance) => {
    const editor = inst.kind === 'editor' || inst.kind === 'background'
    openMenu(e, [
      { title: name(inst) },
      {
        label: editor ? t('关闭编辑器') : t('关闭这个进程'),
        icon: Power,
        onClick: () => setAsk({ inst, force: false }),
      },
      {
        label: t('强制结束'),
        icon: Skull,
        danger: true,
        hint: t('没保存的会丢'),
        onClick: () => setAsk({ inst, force: true }),
      },
    ])
  }

  const dialog = (
    <>
      <MenuHost />
      <Confirm
        open={!!ask}
        title={
          ask?.force
            ? t('强制结束 {name}？', { name: ask ? name(ask.inst) : '' })
            : t('关闭 {name}？', { name: ask ? name(ask.inst) : '' })
        }
        okText={ask?.force ? t('强制结束') : t('关闭')}
        danger={ask?.force}
        onOk={() => ask && void run(ask)}
        onCancel={() => setAsk(undefined)}
      >
        {ask?.reason && <p className="ue:mb-2 ue:text-warning">{ask.reason}</p>}
        {ask?.force
          ? t('直接结束进程（连同它起的 Live Coding 控制台），没保存的改动会丢。')
          : t(
              '和点窗口右上角的关闭一样：有没保存的改动，UE 会弹窗问你要不要保存。10 秒内没退出会再问你要不要强制结束。',
            )}
        {ask && !ask.inst.online && !ask.force && (
          <p className="ue:mt-2 ue:text-subtle">
            {t('它现在没有回应（{e}），正常关闭可能没反应。', { e: ask.inst.error || t('连不上') })}
          </p>
        )}
      </Confirm>
    </>
  )
  return { menu, dialog }
}
