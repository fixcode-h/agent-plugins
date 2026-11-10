import { Check, CircleAlert, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Detection, InstallMode, UeProject } from '../server/types.ts'
import { post, useAction } from './api.ts'
import { h, t } from './host.ts'
import { kindLabel } from './ui.tsx'

/**
 * 添加 UE 项目（设计文档 4.4，图 6）：选项目（只列面板里已经添加的项目）→ 检测 → 桥接安装方式 → Agent 权限。
 * 装桥接后自动编译（编辑器开着时要重启编辑器才加载）。
 */
const VCS_NAME: Record<string, string> = { git: 'Git', p4: 'Perforce', svn: 'SVN', none: '' }

export function AddProject({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdded: (p: UeProject) => void
}) {
  const { ui, hooks, cn, toast } = h()
  const { Modal, Button, Field, Select, Segmented, Input } = ui
  const { projects } = hooks.useData()
  const candidates = projects.filter((p) => p.path)
  const [id, setId] = useState('')
  const [engineDir, setEngineDir] = useState('')
  const [det, setDet] = useState<Detection>()
  const [detecting, setDetecting] = useState(false)
  const [mode, setMode] = useState<InstallMode | 'none'>('local')
  const [runtime, setRuntime] = useState('write')
  const [asset, setAsset] = useState('ask')
  const { busy, run } = useAction()
  const proj = candidates.find((p) => p.id === id)

  useEffect(() => {
    if (!open) return
    setId('')
    setDet(undefined)
    setEngineDir('')
  }, [open])

  useEffect(() => {
    if (!proj) return
    let live = true
    setDetecting(true)
    post<Detection>('/detect', { path: proj.path, engineDir })
      .then((d) => live && setDet(d))
      .catch((e: Error) => live && toast.error(e.message))
      .finally(() => live && setDetecting(false))
    return () => {
      live = false
    }
    // 引擎目录手填时按回车 / 失焦再测，不跟着每次按键
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [proj?.id])

  const redetect = () => {
    if (!proj) return
    setDetecting(true)
    void post<Detection>('/detect', { path: proj.path, engineDir })
      .then(setDet)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setDetecting(false))
  }

  const submit = () =>
    run('add', async () => {
      if (!proj) return
      const r = await post<{ project: UeProject }>('/projects', {
        id: proj.id,
        name: proj.name,
        path: proj.path,
        engineDir,
        mode: det?.bridge && mode !== 'none' ? mode : mode,
        perms: { runtime, asset },
      })
      toast.success(mode === 'none' ? t('已接入') : t('已接入，桥接插件在编译，进度在「桥接与权限」里看'))
      onOpenChange(false)
      onAdded(r.project)
    })

  const row = (ok: boolean, title: string, value: string, desc?: string) => (
    <li className="ue:flex ue:items-start ue:gap-3 ue:px-3.5 ue:py-2.5">
      {ok ? (
        <Check className="ue:mt-0.5 ue:h-4 ue:w-4 ue:shrink-0 ue:text-success" />
      ) : (
        <CircleAlert className="ue:mt-0.5 ue:h-4 ue:w-4 ue:shrink-0 ue:text-warning" />
      )}
      <div className="ue:min-w-0 ue:flex-1">
        <div className="ue:text-body ue:text-fg">{title}</div>
        {desc && <div className="ue:mt-0.5 ue:text-footnote ue:break-all ue:text-subtle">{desc}</div>}
      </div>
      <span className="ue:shrink-0 ue:text-body ue:text-muted">{value}</span>
    </li>
  )

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('添加 UE 项目')}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button disabled={!det?.ok || !!busy} onClick={submit}>
            {busy ? <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" /> : null}
            {mode === 'none' || det?.bridge ? t('接入') : t('接入并安装桥接')}
          </Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-5">
        <Field label={t('项目')} hint={t('只能选 Agent 模式里已经添加的项目；没有 .uproject 的会在检测里说明')}>
          <Select
            value={id}
            placeholder={candidates.length ? t('选择项目') : t('还没有添加项目')}
            options={candidates.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e: { target: { value: string } }) => setId(e.target.value)}
          />
        </Field>

        {proj && (
          <section className="ue:flex ue:flex-col ue:gap-2">
            <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
              {t('检测结果')}
              {detecting && <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />}
            </div>
            {det && (
              <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:rounded-xl ue:border ue:border-line ue:bg-card">
                {row(!!det.uproject, t('项目文件'), det.uname || t('没找到'), det.uproject || det.error)}
                {det.uproject &&
                  row(
                    det.supported,
                    t('引擎'),
                    det.engine.version ? `UE ${det.engine.version}` : t('没找到'),
                    det.supported ? det.engine.dir : det.error,
                  )}
                {det.uproject &&
                  row(
                    true,
                    t('代码'),
                    det.cpp ? 'C++' : t('纯蓝图'),
                    det.cpp ? undefined : t('编译桥接插件需要本机装 Visual Studio'),
                  )}
                {det.uproject && row(true, t('版本管理'), VCS_NAME[det.vcs] || t('无'))}
                {det.uproject &&
                  row(true, t('桥接插件'), det.bridge ? t('已安装 {v}', { v: det.bridge }) : t('未安装'))}
                {det.running.length > 0 &&
                  row(
                    true,
                    t('正在运行'),
                    det.running.map((r) => kindLabel(r.kind)).join('、'),
                    t('装好桥接后要重启编辑器才加载'),
                  )}
              </ul>
            )}
            {det && det.uproject && !det.supported && (
              <Field label={t('引擎目录')} hint={t('自动找不到引擎时手动指定（含 Engine 文件夹的目录），回车重新检测')}>
                <Input
                  value={engineDir}
                  placeholder="D:/Epic/UE_5.4"
                  onChange={(e: { target: { value: string } }) => setEngineDir(e.target.value)}
                  onBlur={redetect}
                  onKeyDown={(e: { key: string }) => e.key === 'Enter' && redetect()}
                />
              </Field>
            )}
          </section>
        )}

        {det?.ok && (
          <>
            <Field
              label={t('桥接插件')}
              hint={
                mode === 'local'
                  ? t('复制到 Plugins/AgentPanelBridge，写进本机忽略文件，不影响团队')
                  : mode === 'vcs'
                    ? t('复制后加入版本管理（P4 进默认变更列表，不提交），团队都能用')
                    : t('先不装，之后在「桥接与权限」里装；没装时只能读日志文件')
              }
            >
              <Segmented
                label={t('桥接插件')}
                value={mode}
                onChange={setMode}
                options={[
                  { id: 'local', label: t('只在本机') },
                  { id: 'vcs', label: t('加入版本管理'), disabled: det.vcs === 'none' },
                  { id: 'none', label: t('先不装') },
                ]}
              />
            </Field>
            <div className={cn('ue:grid ue:gap-4 ue:sm:grid-cols-2')}>
              <Field label={t('Agent 对运行时')}>
                <Select
                  value={runtime}
                  onChange={(e: { target: { value: string } }) => setRuntime(e.target.value)}
                  options={[
                    { value: 'write', label: t('可写') },
                    { value: 'ask', label: t('写前问我') },
                    { value: 'read', label: t('只读') },
                  ]}
                />
              </Field>
              <Field label={t('Agent 对资源')}>
                <Select
                  value={asset}
                  onChange={(e: { target: { value: string } }) => setAsset(e.target.value)}
                  options={[
                    { value: 'ask', label: t('可改，保存前问我') },
                    { value: 'save', label: t('直接保存') },
                    { value: 'read', label: t('只读') },
                  ]}
                />
              </Field>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
