import { Bug } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { busyLine } from '../busy/busy.tsx'
import { connLine, useBackgroundCtl } from '../Side.tsx'
import { kindLabel, useTargetInfo, WorldBadge, worldLabel } from '../ui.tsx'
import { phaseLine, phaseOf } from '../vs-debug/model.ts'
import { useCloseEditor } from './close-editor.tsx'

/**
 * 二级面板顶上的目标卡（设计稿方案 C 的样子，用户 2026-11-18 定用在方案 B 里）：一行世界下拉，
 * 下面一排状态小块：目标进程（PIE 18616）、VS 调试、后台编辑器。绿点在跑、灰点没开，点小块直接做对应的事。
 * 原来目标卡的四行（目标 / 已连接、下拉、PID · 地图、VS 一行、后台一行）收成两行。
 * bar：概览页头下面的一整行（用户 2026-11-18 定：目标卡从二级面板挪进概览），下拉和小块排成一行
 */
export function TargetChips({ bar = false }: { bar?: boolean } = {}) {
  const { state, setTarget, go } = useUe()
  const { list, inst, world } = useTargetInfo()
  const { ui } = h()
  const Chip = ui.StatusChip!
  const conn = connLine(state)
  const w = world ?? inst?.worlds.find((x) => x.type === 'PIE') ?? inst?.worlds[0]
  const vs = state?.vsDebug
  const phase = phaseOf(vs)
  const vsLine = phaseLine(vs)
  const bg = useBackgroundCtl()
  const close = useCloseEditor()
  // 组名带上连不上 / 在忙：一眼看出哪个编辑器是不回应的那个（用户 2026-11-20：怎么有两个编辑器）
  const groupOf = (i: (typeof list)[number]) =>
    `${kindLabel(i.kind)} ${i.pid}${i.online ? '' : ` · ${i.busy ? t('没有回应') : t('连不上')}`}`
  const options = list.flatMap((i) => [
    { value: `${i.pid}|`, label: `${kindLabel(i.kind)} · ${t('默认世界')}`, group: groupOf(i) },
    ...i.worlds.map((x) => ({
      value: `${i.pid}|${x.id}`,
      label: worldLabel(x),
      group: groupOf(i),
    })),
  ])
  // 下拉里的进程（组名或它下面的世界）右键：关闭编辑器（面板的 Select 支持 onOptionContextMenu 才有，旧面板没有）
  const optionMenu = (o: { value: string }, e: MouseEvent) => {
    const i = list.find((x) => x.pid === Number(o.value.split('|')[0]))
    if (i) close.menu(e, i)
  }
  // 目标进程小块：PIE 世界写 PIE，其余写进程类型；连不上、在忙时圆点换色，原因放悬停提示
  const instChip = inst ? (
    <Chip
      onContextMenu={(e: MouseEvent) => close.menu(e, inst)}
      tone={inst.online ? (conn.tone === 'ok' ? 'ok' : conn.tone) : inst.busy ? 'run' : 'danger'}
      busy={!inst.online && !!inst.busy}
      title={
        inst.online
          ? [conn.text, `PID ${inst.pid}`, w?.map, w?.player].filter(Boolean).join(' · ')
          : inst.busy
            ? busyLine(inst)
            : inst.error || t('连不上')
      }
    >
      {`${w?.type === 'PIE' ? 'PIE' : kindLabel(inst.kind)} ${inst.pid}`}
    </Chip>
  ) : (
    <Chip tone={conn.tone === 'ok' ? 'muted' : conn.tone} title={conn.text}>
      {conn.text}
    </Chip>
  )
  return (
    <section
      aria-label={t('目标')}
      className={
        bar
          ? 'ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-2'
          : 'ue:flex ue:flex-col ue:gap-1.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-2 ue:shadow-card'
      }
    >
      {bar && <span className="ue:text-footnote ue:text-subtle">{t('目标')}</span>}
      {list.length > 0 && (
        <ui.Select
          className={bar ? 'ue:w-72 ue:max-w-full' : undefined}
          size="sm"
          aria-label={t('目标')}
          value={inst ? `${inst.pid}|${world?.id ?? ''}` : ''}
          options={options}
          onOptionContextMenu={optionMenu}
          onChange={(e: { target: { value: string } }) => {
            const [pid, wid] = e.target.value.split('|')
            const i = list.find((x) => x.pid === Number(pid))
            setTarget(Number(pid), i?.kind ?? '', wid ?? '')
          }}
        />
      )}
      <div className="ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-1">
        {instChip}
        {w && <WorldBadge world={w} />}
        {phase !== 'off' && (
          <Chip
            tone={vsLine.tone === 'muted' ? 'muted' : vsLine.tone}
            busy={phase === 'building' || phase === 'launching'}
            icon={Bug}
            onClick={() => go('overview')}
            title={t('VS · {s}，点一下到概览看 VS 调试', { s: vsLine.text })}
          >
            {phase === 'design' ? 'VS' : t('VS {s}', { s: vsLine.text })}
          </Chip>
        )}
        {bg && (
          <Chip
            tone={bg.bg.running ? 'ok' : bg.bg.starting ? 'run' : bg.bg.error ? 'danger' : 'muted'}
            busy={bg.bg.starting || bg.busy}
            onClick={
              bg.bg.running || bg.bg.starting ? () => bg.act('stop') : !bg.live ? () => bg.act('start') : undefined
            }
            title={
              bg.bg.running || bg.bg.starting
                ? t('后台编辑器运行中{pid}。点一下关掉：正在做的导入导出会中断', {
                    pid: bg.bg.pid ? ` · PID ${bg.bg.pid}` : '',
                  })
                : bg.bg.error
                  ? t('后台编辑器出错：{e}。点一下重新启动', { e: bg.bg.error })
                  : t('后台编辑器没开。点一下启动：编辑器没开时读资源、导入导出用；首次 30–60 秒，占 2–6 GB 内存')
            }
          >
            {t('后台')}
          </Chip>
        )}
      </div>
      {close.dialog}
    </section>
  )
}
