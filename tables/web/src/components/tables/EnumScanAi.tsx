import { useState, useSyncExternalStore } from 'react'
import { Sparkles } from 'lucide-react'
import { t } from '@shared/i18n'
import { extractJson } from '@shared/assist'
import { enumScanOf, type EnumScanDraft, type ScanExample } from '@shared/table-enum-scan-ai'
import { runPromptInProject } from '@/lib/assist-conv'
import { tablesApi } from '@/lib/tables-api'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'

/**
 * AI 总结出来、还没保存的扫描规则：对话可能跑几分钟，设置关了也要留着，记在模块里（按项目），
 * 回到项目设置 → 表格 → 枚举时顶上提示「查看并保存」。replace 是「让 AI 调整」时要换掉的规则 id
 */
export interface ScanAiResult {
  draft: EnumScanDraft
  replace?: string
  /** 示例枚举：打开弹窗试跑时优先显示它 */
  example?: string
}
const pending = new Map<string, ScanAiResult>()
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
export const useScanAiResult = (projectId: string) =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => pending.get(projectId),
  )
export function dropScanAiResult(projectId: string) {
  pending.delete(projectId)
  emit()
}

/** 在项目里开分析对话；做完按回复里的 enum-scan 代码块记下规则（格式不对让对话自己修正一次） */
export function startEnumScanAi(projectId: string, ex: ScanExample, replace?: string) {
  runPromptInProject({
    projectId,
    title: t('AI 总结枚举扫描：{file}', { file: ex.file.replace(/.*[\\/]/, '') }),
    prompt: async () => (await tablesApi.enumScanPrompt(projectId, ex)).prompt,
    // 结果回到项目设置的「枚举」里看和保存，右侧不出面板自己的项目设置
    analysis: 'run',
    resolve: async (reply) => {
      const got = enumScanOf(reply, extractJson)
      if (!got.draft) return { error: got.error ?? t('没有找到结果') }
      pending.set(projectId, { draft: got.draft, replace, example: ex.enumName })
      emit()
      toast.success(t('AI 总结好了扫描规则，到项目设置 → 表格 → 枚举里看看并保存'))
      return {}
    },
  })
}

/** 让 AI 总结：填一个示例（文件、页签、其中一个枚举名、补充说明）就开对话 */
export function EnumScanAiDialog({
  projectId,
  initial,
  replace,
  onClose,
}: {
  projectId: string
  initial?: Partial<ScanExample>
  /** 「让 AI 调整」已有的规则：结果换掉它 */
  replace?: string
  onClose: () => void
}) {
  const [ex, setEx] = useState<ScanExample>({ file: '', ...initial })
  const set = (p: Partial<ScanExample>) => setEx((e) => ({ ...e, ...p }))
  const isSheet = /\.(xlsx|xlsm|csv|tsv)$/i.test(ex.file.trim())
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={replace ? t('让 AI 调整扫描规则') : t('让 AI 总结扫描规则')}
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">
            {t('AI 只写规则、不写脚本；你看过试跑结果再保存')}
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            disabled={!ex.file.trim()}
            onClick={() => {
              startEnumScanAi(projectId, { ...ex, file: ex.file.trim() }, replace)
              onClose()
            }}
          >
            <Sparkles className="tb:h-3.5 tb:w-3.5" />
            {t('开始')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-3">
        <p className="tb:text-footnote tb:leading-relaxed tb:text-subtle">
          {t(
            '指一个定义了枚举的文件（表格的枚举页签、C++ 头文件、Lua 文件都行），AI 读它、总结出扫描规则并试跑到对上为止。之后每次扫描都按规则在本机跑，不再调用 AI。',
          )}
        </p>
        <Field label={t('示例文件')} tip={t('相对项目目录，或绝对路径。')}>
          <Input
            size="sm"
            className="tb:font-mono"
            value={ex.file}
            placeholder="Config/Enum.xlsx  ·  Source/Game/GameTypes.h  ·  Content/Script/Enums.lua"
            onChange={(e) => set({ file: e.target.value })}
          />
        </Field>
        <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
          {isSheet && (
            <Field label={t('页签')}>
              <Input
                size="sm"
                value={ex.sheet ?? ''}
                placeholder="EnumType"
                onChange={(e) => set({ sheet: e.target.value || undefined })}
              />
            </Field>
          )}
          <Field label={t('其中一个枚举（可不填）')}>
            <Input
              size="sm"
              className="tb:font-mono"
              value={ex.enumName ?? ''}
              placeholder="EItemQuality"
              onChange={(e) => set({ enumName: e.target.value || undefined })}
            />
          </Field>
        </div>
        <Field label={t('补充说明（可不填）')}>
          <Textarea
            rows={2}
            value={ex.note ?? ''}
            placeholder={t('比如：只要 E 开头的；表格里写的枚举名没有 E 前缀；值写在 id 字段')}
            onChange={(e) => set({ note: e.target.value || undefined })}
          />
        </Field>
      </div>
    </Modal>
  )
}
