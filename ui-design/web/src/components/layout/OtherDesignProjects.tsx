import { useState } from 'react'
import { ChevronRight, Folder, FolderInput } from 'lucide-react'
import type { DesignProject } from '@shared/design'
import { t } from '@shared/i18n'
import { api } from '@/lib/api'
import { useDesignData } from '@/lib/design-store'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import { SIDEBAR_GROUP_LABEL } from '@/components/ui/sidebar'

/**
 * UI 设计页左栏底下的「其他 UI 项目」（1.4.0 起 UI 项目归在面板项目下）：升级时按 id、目录没归上的，
 * 或者归属的面板项目已经删了的 UI 项目。默认收起，点行尾的按钮归到当前项目，之后就在上面的列表里了
 */
export function OtherProjects({ list, owner }: { list: DesignProject[]; owner: string }) {
  const { designs, setDesignProjects } = useDesignData()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const adopt = async (p: DesignProject) => {
    setBusy(p.id)
    try {
      const np = await api.updateDesignProject(p.id, { owner })
      setDesignProjects((l) => l.map((x) => (x.id === np.id ? np : x)))
      toast.success(t('「{name}」已归到这个项目', { name: p.name }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="ud:mt-3 ud:flex ud:flex-col ud:gap-px" data-other-projects>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={t('还没归到项目的 UI 项目（升级前建的，或原来的项目已删除）')}
        className="ud:flex ud:h-6 ud:cursor-pointer ud:items-center ud:gap-1 ud:rounded-md ud:pr-1 ud:pl-0.5 ud:text-left ud:hover:text-fg"
      >
        <ChevronRight
          className={cn('ud:h-3 ud:w-3 ud:shrink-0 ud:text-subtle ud:transition-transform', open && 'ud:rotate-90')}
          strokeWidth={2.3}
        />
        <span className={cn('ud:flex-1 ud:font-semibold ud:tracking-[0.08em]', SIDEBAR_GROUP_LABEL)}>
          {t('其他 UI 项目')}
        </span>
        <span className="ud:shrink-0 ud:text-caption ud:text-subtle ud:tabular-nums">{list.length}</span>
      </button>
      {open &&
        list.map((p) => {
          const n = designs.filter((d) => d.projectId === p.id).length
          return (
            <div
              key={p.id}
              className="ud:ml-1 ud:flex ud:h-[31px] ud:items-center ud:gap-2 ud:rounded-lg ud:pr-1 ud:pl-[11px] ud:text-body ud:text-muted"
            >
              <Folder className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-subtle" />
              <span className="ud:min-w-0 ud:flex-1 ud:truncate" title={p.path || p.name}>
                {p.name}
              </span>
              <span className="ud:shrink-0 ud:text-caption ud:text-subtle ud:tabular-nums">{n}</span>
              <IconButton
                icon={FolderInput}
                label={t('把「{name}」归到这个项目', { name: p.name })}
                title={t('归到这个项目')}
                disabled={!!busy}
                onClick={() => void adopt(p)}
              />
            </div>
          )
        })}
    </section>
  )
}
