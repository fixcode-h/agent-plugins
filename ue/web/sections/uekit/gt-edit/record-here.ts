import { useCallback } from 'react'
import { getAt, type GtPath, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import type { ScriptApi } from './use-script.ts'

/**
 * 编辑页「从这里接着录」（定稿 9.2 / 9.7，GameTest 1.10.0）：录到的操作作为一个录制段插在选中这一步后面。
 * 插入由 UE 在停止录制时按步骤 id 写回原文件，所以先存盘：id 是存盘时补的，没存的改动 UE 也看不到。
 * onRecordHere 不给（编辑器没连上、GameTest 太旧）时返回 undefined，菜单项灰掉
 */
export function useRecordHere(
  s: ScriptApi,
  onSaved: () => void,
  onRecordHere?: (after?: string) => Promise<void> | void,
) {
  const start = useCallback(
    async (path: GtPath) => {
      if (!onRecordHere || !s.doc) return
      if (s.dirty) {
        // 存盘失败时 save 自己提示；文件里没有这个 id 时 UE 开始录制就会报错，不会插到对不上的位置
        await s.save()
        onSaved()
      }
      const step = getAt(s.doc, path) as GtStep | undefined
      const id = typeof step?.id === 'string' ? step.id : undefined
      if (!id) return h().toast.error(t('这一步还没有 id，先存盘再接着录'))
      await onRecordHere(id)
    },
    [s, onSaved, onRecordHere],
  )
  return onRecordHere ? (path: GtPath) => void start(path) : undefined
}
