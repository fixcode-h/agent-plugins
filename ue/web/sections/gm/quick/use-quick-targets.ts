import { useMemo, useRef } from 'react'
import { t } from '../../../host.ts'
import type { GmEntry } from '../data.ts'
import type { GmRunState } from '../use-gm-run.ts'
import type { GmData } from '../use-gm.ts'
import type { QuickTarget } from './QuickRun.tsx'

/**
 * 快速执行栏的补全目标：页上所有 GM（Lua、C++、引擎、自定义、控制台命令）和宏。
 * 自定义 GM 的参数按「执行时可改」的顺序对上；宏在原地执行（不切到宏分类）
 */
export function useQuickTargets(d: GmData, run: GmRunState, execMacro: (id: string, open?: boolean) => Promise<void>) {
  const kinds: Record<GmEntry['src'], string> = {
    lua: 'Lua',
    cpp: 'C++',
    engine: t('引擎'),
    custom: t('自定义'),
    console: t('命令'),
  }
  // 执行时用最新的 run / execMacro（执行目标、参数会变），补全列表本身只跟着条目和宏变
  const live = useRef({ run, execMacro })
  live.current = { run, execMacro }
  return useMemo<QuickTarget[]>(
    () => [
      ...d.entries.map((e) => ({
        name: e.name,
        kind: kinds[e.src],
        params: e.custom ? e.custom.editable : e.params.map((p) => p.name),
        run: (a: string[]) =>
          live.current.run.exec(
            e,
            e.custom
              ? Object.fromEntries(e.custom.editable.flatMap((n, i) => (a[i] === undefined ? [] : [[n, a[i]]])))
              : a,
          ),
      })),
      ...d.gm.macros.map((m) => ({
        name: m.name,
        kind: t('宏'),
        params: [],
        run: () => void live.current.execMacro(m.id, false),
      })),
    ],
    // kinds 是固定的几个译名，不随渲染变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [d.entries, d.gm.macros],
  )
}
