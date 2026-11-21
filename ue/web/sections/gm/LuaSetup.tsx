import { FileCode, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import { ppost } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'

/**
 * Lua GM 扫描设置（效果图 3）：填 GM 文件的路径模式，边改边看找到哪些文件；第一次「保存并让 AI 写扫描脚本」，
 * 提示词放进新对话的输入框（toChat，用户看过再发）。脚本和设置存在项目文档根的 AgentPanel/UE（和 gm.json 同一个目录）
 */
export function LuaSetup({
  config,
  scan,
  onClose,
  onSaved,
  askAi,
}: {
  config: LuaGmConfig
  scan: LuaGmScan
  onClose: () => void
  onSaved: (r: { config: LuaGmConfig; scan: LuaGmScan }) => void
  /** 打开对话让 AI 写 / 改脚本；旧面板没有 toChat 时为空，按钮不出现 */
  askAi?: (mode: 'create' | 'fix') => void
}) {
  const { project } = useUe()
  const { ui } = h()
  const [text, setText] = useState(config.files.join('\n'))
  const [found, setFound] = useState<{ files: { path: string; lines: number }[]; total: number }>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const files = text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

  // 边改边看：停 300ms 再找
  useEffect(() => {
    let live = true
    const id = setTimeout(() => {
      ppost<{ files: { path: string; lines: number }[]; total: number }>(project.id, 'lua-gm/preview', { files }).then(
        (r) => live && setFound(r),
        (e: Error) => live && setErr(e.message),
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(id)
    }
    // 按文字变化重找
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const save = async (ai: boolean) => {
    setBusy(true)
    try {
      const r = await ppost<{ config: LuaGmConfig; scan: LuaGmScan }>(project.id, 'lua-gm/config', { files })
      onSaved(r)
      if (ai) askAi?.(r.scan.hasScript ? 'fix' : 'create')
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const rel = (f: string) => {
    const root = project.root.replaceAll('\\', '/')
    const x = f.replaceAll('\\', '/')
    return x.startsWith(root) ? x.slice(root.length + 1) : x
  }

  return (
    <ui.Modal
      open
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('Lua GM 扫描设置')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button variant="secondary" disabled={busy} onClick={() => void save(false)}>
            {t('只保存文件列表')}
          </ui.Button>
          {askAi && (
            <ui.Button disabled={busy || !found?.total} onClick={() => void save(true)}>
              <Sparkles className="ue:h-3.5 ue:w-3.5" />
              {scan.hasScript ? t('保存并让 AI 改扫描脚本') : t('保存并让 AI 写扫描脚本')}
            </ui.Button>
          )}
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-4">
        <ui.Field
          label={t('GM 文件')}
          hint={t('一行一个，可以用 * 和 **；写相对项目目录的路径，或项目外的全局路径（G:\\Shared\\GM\\*.lua）')}
        >
          <ui.Textarea
            rows={3}
            className="ue:font-mono"
            value={text}
            placeholder={'Content/Script/GM/**/*.lua\nG:/Shared/GM/*.lua'}
            onChange={(e: { target: { value: string } }) => setText(e.target.value)}
          />
        </ui.Field>
        <div className="ue:flex ue:flex-col ue:gap-1">
          <span className="ue:text-footnote ue:font-medium ue:text-fg">
            {found ? t('找到 {n} 个文件', { n: found.total }) : t('正在找…')}
          </span>
          <div className="ue:max-h-40 ue:overflow-auto">
            {found?.files.map((f) => (
              <div key={f.path} className="ue:flex ue:h-6 ue:items-center ue:gap-2 ue:text-footnote">
                <FileCode className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-fg">{f.path}</span>
                <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('{n} 行', { n: f.lines })}</span>
              </div>
            ))}
          </div>
          {err && <p className="ue:text-footnote ue:text-danger">{err}</p>}
        </div>
        <div className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-lg ue:border ue:border-line ue:p-3">
          <span className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:font-medium ue:text-fg">
            <Sparkles className="ue:h-3.5 ue:w-3.5" />
            {t('扫描脚本')}
            {scan.hasScript ? <Badge tone="ok">{t('已有')}</Badge> : <Badge tone="warn">{t('还没有')}</Badge>}
          </span>
          <span className="ue:text-footnote ue:text-subtle">
            {t(
              '第一次由 AI 读这几个文件，总结 GM 怎么写（挂在哪个表、分组和说明写在哪、参数怎么声明、参数关联哪张表），写成脚本存到项目文档根的 AgentPanel/UE（团队共用）。以后都用脚本扫，文件变了自动重扫，不再调 AI。',
            )}
          </span>
          <code className="ue:truncate ue:font-mono ue:text-caption ue:text-fg">{rel(scan.script)}</code>
        </div>
      </div>
    </ui.Modal>
  )
}
