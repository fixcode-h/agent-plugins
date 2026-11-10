import { op, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Note } from './ui.tsx'

interface Row {
  path: string
  kind?: 'instance' | 'asset' | 'class'
}

/** 只要场景里活着的实例（Default__ 和类不算）；Actor 快捷入口也用 */
export const isInstance = (r: Row) =>
  r.kind ? r.kind === 'instance' : /^\/(Engine\/Transient|Temp)\b|:PersistentLevel\.|UEDPIE_/.test(r.path)

/**
 * 运行时对象页选到了资源默认值（Default__BP_Hero_C）：在这里改不报错，但场景里已经生成的对象不会变，
 * 用户 2026-11-10 就因为这个以为「改属性没反应」。整条提示 + 一键换到运行中的实例（界面优化第 2 条）。
 * 实例数按类名搜一次（带类名的搜索桥接只扫这个类，不慢），最多数 50 个
 */
export function CdoNote({ cls }: { cls: string }) {
  const { project, target, go } = useUe()
  const { ui } = h()
  const found = useLoad(
    () =>
      op<{ items: Row[] }>(project.id, 'objects', { class: cls, prefix: '', limit: 50 }, target)
        .then((r) => r.items.filter(isInstance))
        .catch(() => [] as Row[]),
    [cls, target.instance, target.world],
  )
  const list = found.data ?? []
  return (
    <div className="ue:px-4 ue:pt-3">
      <Note
        action={
          list.length > 0 && (
            <ui.Button size="sm" onClick={() => go('objects', list[0].path)}>
              {t('改运行中的实例（{n}）', { n: list.length >= 50 ? '50+' : list.length })}
            </ui.Button>
          )
        }
      >
        <b className="ue:font-medium">{t('这是 {c} 的默认值，不是正在运行的对象。', { c: cls })}</b>
        <div className="ue:text-muted">
          {found.data && !list.length
            ? t('在这里改，以后新生成的对象才会用新值；目标世界里现在没有这个类的实例。')
            : t('在这里改，场景里已经生成的对象不会变；要马上看到效果请改实例。')}
        </div>
      </Note>
    </div>
  )
}
