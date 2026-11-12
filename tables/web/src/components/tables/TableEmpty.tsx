import { useState } from 'react'
import { FolderOpen, Settings2, Table2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { useData, useNav } from '@/lib/data'
import { TABLES_SECTION } from '@/lib/tables-nav'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'

/** 骨架里每列的宽度（像一张配置表：短的 ID、长的名字……） */
const COLS = [70, 110, 150, 130, 200, 120, 160]

/**
 * 打开一张表还在读的时候：先画工具栏、表头、几行淡色骨架，读完再换成真表格，
 * 不是一个孤零零的转圈（大表要读一两秒）
 */
export function TableSkeleton() {
  return (
    <div
      role="status"
      aria-label={t('正在打开表格')}
      className="tb:flex tb:min-h-0 tb:flex-1 tb:flex-col tb:overflow-hidden"
    >
      <div className="tb:flex tb:h-10 tb:shrink-0 tb:items-center tb:gap-2 tb:border-b tb:px-3">
        {[64, 48, 80, 56].map((w, i) => (
          <span key={i} className="tb:h-4 tb:animate-pulse tb:rounded tb:bg-hover" style={{ width: w }} />
        ))}
      </div>
      <div className="tb:flex tb:shrink-0 tb:border-b tb:bg-panel">
        <span className="tb:w-12 tb:shrink-0" />
        {COLS.map((w, i) => (
          <span
            key={i}
            className="tb:flex tb:h-11 tb:shrink-0 tb:flex-col tb:justify-center tb:gap-1.5 tb:border-r tb:px-2"
            style={{ width: w }}
          >
            <span className="tb:h-3 tb:w-3/4 tb:animate-pulse tb:rounded tb:bg-active" />
            <span className="tb:h-2.5 tb:w-1/2 tb:animate-pulse tb:rounded tb:bg-hover" />
          </span>
        ))}
      </div>
      {Array.from({ length: 14 }, (_, r) => (
        <div key={r} className="tb:flex tb:shrink-0 tb:border-b" style={{ opacity: 1 - r * 0.06 }}>
          <span className="tb:w-12 tb:shrink-0" />
          {COLS.map((w, i) => (
            <span
              key={i}
              className="tb:flex tb:h-[26px] tb:shrink-0 tb:items-center tb:border-r tb:px-2"
              style={{ width: w }}
            >
              <span
                className="tb:h-2.5 tb:animate-pulse tb:rounded tb:bg-hover"
                style={{ width: `${40 + ((r * 7 + i * 13) % 50)}%` }}
              />
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * 还没有哪个项目设了表格目录：一张引导卡。挑一个项目、一键打开它的「项目设置 → 表格」去选目录；
 * 设好后图标栏和这里就会列出那个项目的表格
 */
export function TablesSetupCard() {
  const { projects } = useData()
  const { go, openProject } = useNav()
  const [pick, setPick] = useState(projects[0]?.id ?? '')
  return (
    <main className="tb:flex tb:min-w-0 tb:flex-1 tb:items-center tb:justify-center tb:p-6">
      <section
        aria-label={t('设置表格目录')}
        className="tb:flex tb:w-full tb:max-w-md tb:flex-col tb:gap-4 tb:rounded-xl tb:border tb:bg-panel tb:p-6 tb:shadow-sm"
      >
        <div className="tb:flex tb:items-center tb:gap-3">
          <span className="tb:grid tb:h-10 tb:w-10 tb:shrink-0 tb:place-items-center tb:rounded-lg tb:bg-accent-soft tb:text-accent-text">
            <Table2 className="tb:h-5 tb:w-5" />
          </span>
          <div className="tb:min-w-0">
            <h2 className="tb:text-title tb:font-medium tb:text-fg">{t('管理游戏配置表')}</h2>
            <p className="tb:text-footnote tb:text-subtle">{t('按目录浏览、搜索、检查和在线改 xlsx / csv 配置表')}</p>
          </div>
        </div>
        <ol className="tb:flex tb:flex-col tb:gap-2 tb:text-body tb:text-muted">
          <li className="tb:flex tb:gap-2">
            <span className="tb:text-subtle tb:tabular-nums">1.</span>
            {t('在项目设置 →「表格」里选配置表所在的目录')}
          </li>
          <li className="tb:flex tb:gap-2">
            <span className="tb:text-subtle tb:tabular-nums">2.</span>
            {t('设置页里会显示找到了几个表格，可以按包含 / 排除筛')}
          </li>
          <li className="tb:flex tb:gap-2">
            <span className="tb:text-subtle tb:tabular-nums">3.</span>
            {t('回到这里，左边就是表格文件树')}
          </li>
        </ol>
        {projects.length ? (
          <div className="tb:flex tb:items-center tb:gap-2">
            {projects.length > 1 && (
              <Select
                size="sm"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                aria-label={t('项目')}
              />
            )}
            <Button
              size="sm"
              className="tb:shrink-0"
              disabled={!pick}
              onClick={() => openProject(pick, TABLES_SECTION)}
            >
              <Settings2 className="tb:h-3.5 tb:w-3.5" />
              {t('打开项目设置 → 表格')}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" className="tb:self-start" onClick={() => go({ page: 'home' })}>
            <FolderOpen className="tb:h-3.5 tb:w-3.5" />
            {t('先去建一个项目')}
          </Button>
        )}
      </section>
    </main>
  )
}
