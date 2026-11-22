import { Box, Crosshair, FunctionSquare } from 'lucide-react'
import type { GtRef } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { ValueTree } from '../../value/ValueTree.tsx'

/** 抓取值弹窗里选中的那一项：哪个实例的哪个属性（或取值函数、或实例本身）、此刻的值 */
export interface Taken {
  /** 属性路径；取值函数是它的路径 `@.名字()`；实例本身是 `@` */
  prop: string
  /** 显示名（细节面板那一行的名字 / 实例名） */
  label: string
  /** 哪个实例（此刻实例栏选中的） */
  from?: string
  /** 值的类型（属性类型、函数返回类型） */
  type?: string
  value: unknown
  /** 取值函数：对这个实例调了一次，value 是返回值 */
  fn?: boolean
  loading?: boolean
  error?: string
  /** 取的是对象本身：写的时候按这条规则现找它（类 + 对象名） */
  rule?: GtRef
}

/**
 * 抓取值时第 4 栏（用户 2026-11-22：选对象弹窗复用来抓值，右边显示当前抓取的值，右下角是「确认」）：
 * 代替唯一标识组。顶上写要填的类型（只列对得上的），下面是准星选中的那一项此刻的值，按类型画（ValueTree，和输出同一套）
 */
export function TakenValue({ taken, project, want }: { taken?: Taken; project: string; want?: string }) {
  const Icon = taken?.prop === '@' ? Box : taken?.fn ? FunctionSquare : Crosshair
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:overflow-auto ue:p-3">
      <div className="ue:flex ue:flex-col ue:gap-0.5">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('抓取的值')}</span>
        <span className="ue:text-caption ue:text-muted">
          {t('先在左边点一个此刻的实例，再点细节里一行的准星取它此刻的值；取值函数会对这个实例调一次，用返回值')}
        </span>
        {want && (
          <span className="ue:mt-1 ue:flex ue:items-center ue:gap-1.5 ue:text-caption ue:text-muted">
            {t('要填的类型')}
            <span className="ue:rounded-sm ue:bg-hover ue:px-1.5 ue:font-mono ue:text-fg">{want}</span>
            <span className="ue:text-subtle">{t('（只列对得上的）')}</span>
          </span>
        )}
      </div>
      {taken ? (
        <div className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-2.5">
          <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption ue:text-muted">
            <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
            <span className="ue:min-w-0 ue:truncate">
              {taken.prop === '@' ? t('对象本身') : taken.from ? `${taken.from} · ` : ''}
              {taken.prop !== '@' && <span className="ue:font-mono ue:text-fg">{taken.label}</span>}
            </span>
            {taken.type && taken.prop !== '@' && (
              <span className="ue:ml-auto ue:shrink-0 ue:font-mono ue:text-subtle">{taken.type}</span>
            )}
          </span>
          <div className="ue:max-h-[50vh] ue:overflow-auto ue:rounded-md ue:bg-hover ue:px-1 ue:py-1">
            {taken.loading ? (
              <span className="ue:px-1.5 ue:text-footnote ue:text-subtle">{t('正在调用…')}</span>
            ) : taken.error ? (
              <span className="ue:px-1.5 ue:text-footnote ue:break-all ue:text-danger">{taken.error}</span>
            ) : (
              <ValueTree value={taken.value} type={taken.type} project={project} />
            )}
          </div>
          {taken.prop === '@' && (
            <span className="ue:text-caption ue:text-subtle">
              {t('存成「{c} 里名字是 {n} 的那个」，修改时按它现找', {
                c: String((taken.value as { class?: string } | undefined)?.class ?? ''),
                n: taken.label,
              })}
            </span>
          )}
        </div>
      ) : (
        <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:p-3 ue:text-footnote ue:text-subtle">
          {t('还没取值')}
        </p>
      )}
    </div>
  )
}
