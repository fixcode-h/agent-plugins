import { Stethoscope } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProjectState, UeProject } from '../../../../server/types.ts'
import { h, t } from '../../../host.ts'
import { connLine } from '../../../Side.tsx'
import { Dot } from '../../../ui.tsx'

/**
 * UE 插件页顶上一行四格：项目引擎、编辑器开没开、连接、插件库从哪读的和上次检查时间；最右是连接诊断的入口
 * （原来夹在 UELink 和扩展中间，用户嫌乱，2026-11-16 挪到这里）。只显示，不发请求。
 */
function Cell({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="ue:flex ue:min-w-0 ue:flex-col ue:justify-center ue:gap-0.5 ue:bg-card ue:px-4 ue:py-2.5">
      <span className="ue:text-caption ue:text-subtle">{k}</span>
      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:truncate ue:text-body ue:font-medium ue:text-fg">
        {children}
      </span>
    </div>
  )
}

const Sub = ({ children }: { children: ReactNode }) => (
  <span className="ue:truncate ue:text-footnote ue:font-normal ue:text-subtle">{children}</span>
)

/** 几分钟前：状态条只要个大概 */
function ago(ms: number) {
  const min = Math.floor((Date.now() - ms) / 60000)
  if (min < 1) return t('刚刚检查')
  if (min < 60) return t('{n} 分钟前检查', { n: min })
  return t('{n} 小时前检查', { n: Math.floor(min / 60) })
}

export function StatusStrip({
  project,
  state,
  source,
  checkedAt,
  unchecked,
  diagBusy,
  diagOpen,
  onDiagnose,
}: {
  project: UeProject
  state?: ProjectState
  source?: string
  checkedAt?: number
  unchecked?: boolean
  diagBusy?: boolean
  diagOpen?: boolean
  onDiagnose: () => void
}) {
  const { ui } = h()
  const editor = state?.instances.find((i) => i.kind === 'editor')
  const conn = connLine(state)
  const linkBad = conn.tone === 'danger'
  return (
    <div className="ue:grid ue:gap-px ue:bg-line ue:sm:grid-cols-2 ue:xl:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]">
      <Cell k={t('项目引擎')}>
        UE {project.engine.version || '?'}
        <Sub>{project.cpp ? 'C++' : t('纯蓝图')}</Sub>
      </Cell>
      <Cell k={t('编辑器')}>
        {editor ? (
          <>
            <Dot tone="ok" /> {t('开着')}
            <Sub>PID {editor.pid}</Sub>
          </>
        ) : (
          <>
            <Dot /> {t('没开')}
            <Sub>{t('可以放心替换插件')}</Sub>
          </>
        )}
      </Cell>
      <Cell k={t('连接')}>
        <Dot tone={conn.tone === 'warn' ? 'warn' : conn.tone} />
        <span className={linkBad ? 'ue:text-danger' : undefined}>{conn.text}</span>
        {state?.bridge && <Sub>UELink {state.bridge}</Sub>}
      </Cell>
      <Cell k={t('插件库')}>
        {source || 'fixcode-h/UEKit'}
        <Sub>{unchecked || !checkedAt ? t('还没检查') : ago(checkedAt)}</Sub>
      </Cell>
      <div className="ue:flex ue:items-center ue:justify-end ue:bg-card ue:px-3 ue:py-1.5 ue:sm:col-span-2 ue:xl:col-span-1">
        <ui.Button
          size="sm"
          variant={linkBad && !diagOpen ? 'secondary' : 'ghost'}
          disabled={diagBusy}
          onClick={onDiagnose}
        >
          <Stethoscope className="ue:h-3.5 ue:w-3.5" />
          {diagBusy ? t('诊断中…') : diagOpen ? t('重新诊断') : t('连接诊断')}
        </ui.Button>
      </div>
    </div>
  )
}
