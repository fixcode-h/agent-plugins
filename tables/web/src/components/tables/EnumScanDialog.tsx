import { useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { t } from '@shared/i18n'
import { EnumScan, ScanFrom, isSheetFrom, type ScanRun } from '@shared/table-enum-scan'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Segmented } from '@/components/ui/segmented'
import { tablesApi } from '@/lib/tables-api'
import { ScanPreview, scanKindLabel } from './EnumScanParts'
import { CodeFields, CommandFields, SheetFields } from './EnumScanFields'

type Kind = ScanFrom['kind']
const KINDS: Kind[] = ['block', 'rows', 'sheets', 'cpp', 'lua', 'regex', 'command']

/** 换写法时保留能沿用的字段（表格之间沿用文件、页签、列；代码之间沿用文件通配） */
function withKind(from: ScanFrom, kind: Kind): ScanFrom {
  if (isSheetFrom(from) && (kind === 'block' || kind === 'rows' || kind === 'sheets')) {
    const { file, sheet, start, nameCol, valueCol, descCol } = from
    const base = { file, sheet, start, nameCol, valueCol, descCol }
    if (kind === 'sheets') return { ...base, kind, nameFrom: 'sheet' }
    return { ...base, kind, enumCol: from.kind === 'sheets' ? 'A' : from.enumCol }
  }
  const files = !isSheetFrom(from) ? from.files : ''
  if (kind === 'block' || kind === 'rows')
    return ScanFrom.parse({ kind, file: '', enumCol: 'A', nameCol: 'B', valueCol: 'C' })
  if (kind === 'sheets') return ScanFrom.parse({ kind, file: '', nameCol: 'A', valueCol: 'B' })
  return ScanFrom.parse({ kind, files })
}

/** 填够了才能试跑、保存 */
function readyOf(f: ScanFrom) {
  if (isSheetFrom(f)) return !!f.file.trim() && !!f.nameCol.trim() && (f.kind === 'sheets' || !!f.enumCol.trim())
  if (f.kind === 'command') return !!f.command.trim()
  if (f.kind === 'regex') return !!f.files.trim() && !!f.block.trim() && !!f.member.trim()
  return !!f.files.trim()
}

/**
 * 新建 / 改一条枚举扫描规则：选文件和页签、写法、哪几列，试跑看扫出了什么，保存后马上扫一次。
 * 列可以写 Excel 列号（A、B、C）或表头里的字段名；枚举页签多半没有表头，写列号最省事
 */
export function EnumScanDialog({
  projectId,
  initial,
  tryNow,
  example,
  onClose,
  onSave,
}: {
  projectId: string
  initial: EnumScan
  /** 打开就试跑一次（AI 总结的规则先给用户看结果） */
  tryNow?: boolean
  /** 试跑结果里先展开这个枚举（用户给 AI 的示例） */
  example?: string
  onClose: () => void
  onSave: (s: EnumScan) => Promise<void>
}) {
  const [rule, setRule] = useState(initial)
  const [run, setRun] = useState<ScanRun | null>(null)
  const [trying, setTrying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const from = rule.from
  const setFrom = (p: Partial<ScanFrom>) => setRule((r) => ({ ...r, from: { ...r.from, ...p } as ScanFrom }))
  const parsed = EnumScan.safeParse(rule)
  const ready = parsed.success && readyOf(from)

  const tryIt = async () => {
    if (!parsed.success) return
    setTrying(true)
    setErr('')
    try {
      setRun(await tablesApi.enumScanTry(projectId, parsed.data))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setTrying(false)
    }
  }
  useEffect(() => {
    if (tryNow) void tryIt()
    // 只在打开时试跑一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial.name ? t('扫描规则 · {name}', { name: initial.name }) : t('新建枚举扫描')}
      size="lg"
      footer={
        <>
          <span className="tb:mr-auto tb:text-footnote tb:text-subtle">{t('只读源文件，表格文件不改')}</span>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            disabled={!ready || saving}
            onClick={async () => {
              if (!parsed.success) return
              setSaving(true)
              await onSave(parsed.data).finally(() => setSaving(false))
            }}
          >
            {saving && <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />}
            {t('保存并扫描')}
          </Button>
        </>
      }
    >
      <div className="tb:flex tb:flex-col tb:gap-4">
        <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
          <Field label={t('名字')}>
            <Input
              size="sm"
              value={rule.name}
              placeholder={t('比如 EnumType 页签')}
              onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))}
            />
          </Field>
          <Field
            label={t('什么时候扫')}
            tip={t(
              '打开时：进表格页、打开或保存了用到的文件时，看修改时间变没变，变了才重新扫。盯着改动：面板在后台盯着源文件，一改就扫，表格页马上更新。',
            )}
          >
            <div>
              <Segmented
                label={t('什么时候扫')}
                size="sm"
                value={rule.auto}
                onChange={(auto) => setRule((r) => ({ ...r, auto }))}
                options={[
                  { id: 'open', label: t('打开时自动') },
                  { id: 'watch', label: t('盯着改动') },
                  { id: 'off', label: t('只手动') },
                ]}
              />
            </div>
          </Field>
        </div>

        <Field label={t('写法')}>
          <Select
            size="sm"
            value={from.kind}
            onChange={(e) => setRule((r) => ({ ...r, from: withKind(r.from, e.target.value as Kind) }))}
            options={KINDS.map((k) => ({
              value: k,
              label: scanKindLabel(k),
              group:
                k === 'block' || k === 'rows' || k === 'sheets'
                  ? t('表格里')
                  : k === 'command'
                    ? t('其它')
                    : t('代码里'),
            }))}
          />
        </Field>
        <p className="tb:-mt-2 tb:text-caption tb:leading-relaxed tb:text-subtle">{kindHint(from.kind)}</p>

        {isSheetFrom(from) ? (
          <SheetFields projectId={projectId} from={from} set={setFrom} />
        ) : from.kind === 'command' ? (
          <CommandFields from={from} set={setFrom} />
        ) : (
          <CodeFields from={from} set={setFrom} />
        )}

        <div className="tb:grid tb:grid-cols-2 tb:gap-3">
          <Field
            label={t('去掉前缀')}
            tip={t('表格里写的枚举名比源头少个前缀时用，比如源头叫 EColor、表格里写 Color。')}
          >
            <Input
              size="sm"
              className="tb:font-mono"
              value={rule.rename.stripPrefix}
              placeholder="E"
              onChange={(e) => setRule((r) => ({ ...r, rename: { ...r.rename, stripPrefix: e.target.value } }))}
            />
          </Field>
          <Field label={t('加上前缀')}>
            <Input
              size="sm"
              className="tb:font-mono"
              value={rule.rename.addPrefix}
              onChange={(e) => setRule((r) => ({ ...r, rename: { ...r.rename, addPrefix: e.target.value } }))}
            />
          </Field>
        </div>

        <div className="tb:flex tb:flex-col tb:gap-2 tb:border-t tb:pt-3">
          <div className="tb:flex tb:items-center tb:gap-2">
            <Button size="sm" variant="secondary" disabled={!ready || trying} onClick={tryIt}>
              {trying ? (
                <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />
              ) : (
                <Play className="tb:h-3.5 tb:w-3.5" />
              )}
              {t('试跑')}
            </Button>
            <span className="tb:text-caption tb:text-subtle">{t('按现在填的扫一遍看看，不保存')}</span>
          </div>
          {err && <p className="tb:text-footnote tb:text-danger">{err}</p>}
          {run && <ScanPreview run={run} example={example} />}
        </div>
      </div>
    </Modal>
  )
}

/** 每种写法一句说明 */
function kindHint(k: Kind) {
  switch (k) {
    case 'block':
      return t('枚举名只写在每组第一行，下面几行枚举名那列空着，都属于上面那个枚举。')
    case 'rows':
      return t('每一行都写着枚举名和成员名。')
    case 'sheets':
      return t('每个页签是一个枚举，页签名（或文件名）就是枚举名。')
    case 'cpp':
      return t(
        '认 UENUM() / enum class / enum / namespace EFoo { enum Type }，没写值的按上一个加 1，算得出 1 << 3 这类表达式。',
      )
    case 'lua':
      return t(
        '认 EFoo = { A = 1, B = 2 } 这样的表（local、M.EFoo 也行），成员值是表时按字段取值和说明，行尾 -- 注释当说明。',
      )
    case 'regex':
      return t('上面两种认不出时用：一个正则找枚举块，一个正则在块里找成员。')
    case 'command':
      return t('内置写法都表达不了时，跑项目里的脚本，由它输出枚举的 JSON。')
  }
}
