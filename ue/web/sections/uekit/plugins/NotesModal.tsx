import { h, t } from '../../../host.ts'
import type { PluginView } from './model.ts'

/** 卡片上「更新说明」：插件目录清单里这一版的 notes（UEKit 发布时从 CHANGELOG 取） */
export function NotesModal({ view, onClose }: { view: PluginView; onClose: () => void }) {
  const { ui } = h()
  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('{name} {v} 更新说明', { name: view.displayName, v: view.offer?.version ?? '' })}
      footer={
        <ui.Button size="sm" variant="secondary" onClick={onClose}>
          {t('关闭')}
        </ui.Button>
      }
    >
      <div className="ue:max-h-[60vh] ue:overflow-auto ue:text-body ue:leading-relaxed ue:whitespace-pre-wrap ue:text-fg">
        {view.offer?.notes || t('这一版没有写更新说明')}
      </div>
    </ui.Modal>
  )
}
