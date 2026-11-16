import { useRef, useState } from 'react'
import { ClipboardCopy, ClipboardPaste, Download, Upload } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableSchema } from '@shared/tables'
import { exportSchemaText, parseSchemaText, schemaBrief } from '@shared/table-schema-transfer'
import { tablesApi } from '@/lib/tables-api'
import { saveTableSchema } from '@/lib/table-schema'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { afterScan } from '@/components/tables/use-enum-auto-scan'

/**
 * 项目设置「表格」页签条右端：整份表格设置（表头、枚举、扫描规则、类型、列）复制到剪贴板、从剪贴板导入、
 * 导出文件、从文件导入（用户 2026-11-16）。导入先摆出「里面有什么」，点「替换」才写进结构文件，写完按扫描规则扫一次
 */
export function useSchemaTransfer(projectId: string, projectName: string) {
  const [incoming, setIncoming] = useState<{ schema: TableSchema; from: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const current = async () => exportSchemaText(await tablesApi.schema(projectId))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await current())
      toast.success(t('表格设置已复制到剪贴板'))
    } catch (e) {
      toast.error(t('复制失败：{error}', { error: (e as Error).message }))
    }
  }
  const download = async () => {
    try {
      const url = URL.createObjectURL(new Blob([await current()], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectName || 'tables'}.tables-schema.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(t('导出失败：{error}', { error: (e as Error).message }))
    }
  }
  const take = (text: string, from: string) => {
    const p = parseSchemaText(text)
    if (!p.schema) return toast.error(t('导入不了：{error}', { error: p.error ?? '' }))
    setIncoming({ schema: p.schema, from })
  }
  const paste = async () => {
    try {
      take(await navigator.clipboard.readText(), t('剪贴板'))
    } catch (e) {
      toast.error(t('浏览器不让读剪贴板：{error}', { error: (e as Error).message }))
    }
  }
  const apply = async () => {
    if (!incoming) return
    setBusy(true)
    try {
      // 整份换掉；分析时间不带过来，扫描结果按新规则重扫
      const saved = await saveTableSchema(projectId, () => incoming.schema)
      setIncoming(null)
      toast.success(t('已导入表格设置：{what}', { what: schemaBrief(saved) || t('空的') }))
      if (saved.scans.length) {
        const { runs } = await tablesApi.enumScan(projectId, { ids: saved.scans.map((s) => s.id) })
        await afterScan(projectId, saved, runs, true, true)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // 按钮放页签条右端，导入确认条放页签条下面
  const buttons = (
    <span className="tb:flex tb:items-center tb:gap-0.5">
      <IconButton icon={ClipboardCopy} size="xs" label={t('复制表格设置到剪贴板')} onClick={() => void copy()} />
      <IconButton icon={ClipboardPaste} size="xs" label={t('从剪贴板导入表格设置')} onClick={() => void paste()} />
      <IconButton icon={Download} size="xs" label={t('导出表格设置文件')} onClick={() => void download()} />
      <IconButton icon={Upload} size="xs" label={t('从文件导入表格设置')} onClick={() => file.current?.click()} />
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="tb:hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void f.text().then((text) => take(text, f.name))
        }}
      />
    </span>
  )
  const bar = incoming && (
    <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2 tb:rounded-(--c-row-radius) tb:bg-sel/60 tb:px-3 tb:py-2 tb:text-footnote">
      <span className="tb:min-w-0 tb:flex-1">
        {t('从{from}读到：{what}。导入会替换这个项目现在的整份表格设置。', {
          from: incoming.from,
          what: schemaBrief(incoming.schema) || t('空的'),
        })}
      </span>
      <Button size="sm" variant="ghost" onClick={() => setIncoming(null)} disabled={busy}>
        {t('取消')}
      </Button>
      <Button size="sm" variant="primary" onClick={() => void apply()} disabled={busy}>
        {t('替换')}
      </Button>
    </div>
  )
  return { buttons, bar }
}
