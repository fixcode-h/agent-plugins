import { CircleHelp, Loader2, TriangleAlert, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { op } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { satisfies } from '../plugins/model.ts'

/** 对象引用（v4）要的最低 GameTest（协议 game-test-ref 第 12 节） */
export const REF_MIN_VERSION = '2.0.0'

export const refSupported = (gameTestVersion?: string) =>
  !!gameTestVersion && satisfies(gameTestVersion.replace(/-.*$/, ''), `>=${REF_MIN_VERSION}`)

/** 文件里原本写的 schemaVersion（打开时数据层会整理，所以从原文读，不从整理后的 doc 读） */
export function rawSchemaVersion(text: string): number {
  try {
    const v = (JSON.parse(text.replace(/^﻿/, '')) as { schemaVersion?: unknown }).schemaVersion
    return typeof v === 'number' ? v : 1
  } catch {
    return 4
  }
}

/** gt.migrate 的返回（面板服务端做，不经过 UE）：改了的文件各自的待定和备份，跳过的、出错的 */
interface MigrateReply {
  changed?: { path: string; todos?: { at: string; message: string }[]; backup?: string }[]
  skipped?: { path: string; reason: string }[]
  errors?: { path: string; message: string }[]
  dryRun?: boolean
}

/**
 * 编辑页能不能改（协议第 12 节）：GameTest 低于 2.0.0 时只读并提示升级 GameTest；脚本是 v1–v3 时只读，
 * 顶上提示「旧格式脚本，升级后才能编辑」+「升级脚本」按钮（gt.migrate，先存 .v3.bak），升级完重新读。
 * GameTest 版本不知道（编辑器没开）时只看脚本格式
 */
export function useRefGate(o: {
  project: string
  scenario: string
  base: string
  gtVersion?: string
  reload: () => Promise<void>
}) {
  const { ui } = h()
  const [busy, setBusy] = useState<'' | 'dry' | 'go'>('')
  const [preview, setPreview] = useState<MigrateReply>()
  const oldGt = !!o.gtVersion && !refSupported(o.gtVersion)
  const oldDoc = !!o.base && rawSchemaVersion(o.base) < 4
  const locked = oldGt || oldDoc
  const reason = oldGt
    ? t('装着的 GameTest {v} 还不认对象引用：编辑页只读，到「UE 插件」页升级到 {m} 以上', {
        v: o.gtVersion ?? '',
        m: REF_MIN_VERSION,
      })
    : t('旧格式脚本，升级后才能编辑')

  const migrate = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'go')
    try {
      const r = await op<MigrateReply>(o.project, 'gt.migrate', {
        scenario: o.scenario,
        ...(dryRun ? { dryRun: true } : {}),
      })
      if (r.errors?.length) throw new Error(r.errors.map((x) => x.message).join('；'))
      if (dryRun) setPreview(r)
      else {
        const c = r.changed?.[0]
        const n = c?.todos?.length ?? 0
        if (!c) h().toast.success(r.skipped?.[0]?.reason ?? t('不用升级'))
        else
          h().toast.success(
            n
              ? t('已升级，{n} 处标了「待定」，原文件备份在 {b}', { n, b: c.backup ?? '' })
              : t('已升级，原文件备份在 {b}', { b: c.backup ?? '' }),
          )
        setPreview(undefined)
        await o.reload()
      }
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const banner = locked ? (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-warning/8 ue:px-4 ue:py-1.5 ue:text-footnote ue:text-warning">
      <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span className="ue:min-w-0">{reason}</span>
      {oldDoc && !oldGt && (
        <>
          {preview && (
            <span
              className="ue:text-subtle"
              title={(preview.changed?.[0]?.todos ?? []).map((x) => `${x.at}：${x.message}`).join('\n')}
            >
              {preview.changed?.length
                ? t('升级后有 {n} 处要你再定', { n: preview.changed[0].todos?.length ?? 0 })
                : (preview.skipped?.[0]?.reason ?? t('不用升级'))}
            </span>
          )}
          <span className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
            <ui.Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void migrate(true)}>
              {busy === 'dry' && <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />}
              {t('看会改什么')}
            </ui.Button>
            <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void migrate(false)}>
              {busy === 'go' ? (
                <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
              ) : (
                <Wand2 className="ue:h-3.5 ue:w-3.5" />
              )}
              {t('升级脚本（先备份）')}
            </ui.Button>
          </span>
        </>
      )}
    </div>
  ) : null
  return { locked, reason, banner }
}

/** 列表行、流程图节点上的「待定」小标（迁移时迁不准的步骤写了 todo） */
export function TodoBadge({ step }: { step: GtStep }) {
  if (typeof step.todo !== 'string' || !step.todo) return null
  return (
    <span
      title={step.todo}
      className="ue:shrink-0 ue:rounded-sm ue:bg-warning/12 ue:px-1.5 ue:py-px ue:text-caption ue:text-warning"
    >
      {t('待定')}
    </span>
  )
}

/** 检查器顶上：这一步升级时迁不准的说明，改好了点「定了」去掉 todo */
export function TodoNote({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  if (typeof step.todo !== 'string' || !step.todo) return null
  return (
    <div className="ue:flex ue:items-start ue:gap-2 ue:rounded-(--c-row-radius) ue:bg-warning/8 ue:px-2.5 ue:py-2 ue:text-footnote ue:text-warning">
      <CircleHelp className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span className="ue:min-w-0 ue:flex-1">
        {t('待定（升级脚本时没迁准，先按第一个找着跑）：{w}', { w: step.todo })}
      </span>
      <ui.Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const out = { ...step }
          delete out.todo
          onChange(out)
        }}
      >
        {t('定了')}
      </ui.Button>
    </div>
  )
}
