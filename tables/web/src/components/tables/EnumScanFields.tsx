import { useEffect, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import { SKIP_SENTINEL, type CodeFrom, type ScanFrom, type SheetFrom } from '@shared/table-enum-scan'
import { Checkbox } from '@/components/ui/checkbox'
import { ComboInput, Field, Input, Select, Textarea } from '@/components/ui/input'
import { tablesApi } from '@/lib/tables-api'

/**
 * 扫描规则弹窗里按写法变的那一块：表格（文件、页签、哪几列）、代码（文件通配、各写法的选项）、自定义命令。
 * 各写法的字段在 shared/table-enum-scan.ts 的 ScanFrom
 */

/** 文件名建议：最多列 50 个，按输入的字筛（5000 张表的项目一次全列会卡） */
function useFileSuggestions(projectId: string, typed: string) {
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    let live = true
    tablesApi
      .list(projectId)
      .then((ix) => live && setFiles(ix.files.map((f) => f.path)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [projectId])
  const q = typed.trim().toLowerCase()
  return useMemo(
    () =>
      (q ? files.filter((f) => f.toLowerCase().includes(q)) : files.filter((f) => /enum|枚举/i.test(f)))
        .slice(0, 50)
        .map((value) => ({ value })),
    [files, q],
  )
}

/** 选好的文件有哪些页签：试跑前就能从下拉里挑 */
function useSheetNames(projectId: string, file: string) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    setNames([])
    if (!/\.(xlsx|xlsm|csv|tsv)$/i.test(file.trim())) return
    let live = true
    const timer = setTimeout(() => {
      tablesApi
        .open(projectId, file.trim())
        .then((d) => live && setNames(d.sheets.map((s) => s.name)))
        .catch(() => undefined)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [projectId, file])
  return names
}

/** 表格里的写法：文件、页签、起始行、哪几列（Excel 列号或字段名） */
export function SheetFields({
  projectId,
  from,
  set,
}: {
  projectId: string
  from: SheetFrom
  set: (p: Partial<SheetFrom>) => void
}) {
  const files = useFileSuggestions(projectId, from.file)
  const sheets = useSheetNames(projectId, from.file)
  const col = (k: 'enumCol' | 'nameCol' | 'valueCol' | 'descCol', label: string, ph: string, optional = false) => (
    <Field label={label}>
      <Input
        size="sm"
        placeholder={ph}
        className="tb:font-mono"
        value={((from as Record<string, unknown>)[k] as string | undefined) ?? ''}
        onChange={(e) => set({ [k]: optional ? e.target.value || undefined : e.target.value } as Partial<SheetFrom>)}
      />
    </Field>
  )
  return (
    <>
      <div className="tb:grid tb:gap-3 tb:md:grid-cols-[2fr_1fr_90px]">
        <Field label={t('文件')}>
          <ComboInput
            size="sm"
            value={from.file}
            suggestions={files}
            placeholder="Config/Enum.xlsx"
            className="tb:font-mono"
            onChange={(file) => set({ file })}
          />
        </Field>
        <Field label={from.kind === 'sheets' ? t('页签（通配）') : t('页签')}>
          {from.kind !== 'sheets' && sheets.length ? (
            <Select
              size="sm"
              value={from.sheet}
              onChange={(e) => set({ sheet: e.target.value })}
              options={[{ value: '', label: t('第一个页签') }, ...sheets.map((s) => ({ value: s, label: s }))]}
            />
          ) : (
            <Input
              size="sm"
              value={from.sheet}
              placeholder={from.kind === 'sheets' ? '*' : t('第一个页签')}
              onChange={(e) => set({ sheet: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('起始行')} tip={t('不填：列都写列号时从第 1 行开始，写了字段名时从表头下面开始。')}>
          <Input
            size="sm"
            inputMode="numeric"
            value={from.start ?? ''}
            placeholder="1"
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              set({ start: Number.isFinite(n) && n > 0 ? n : undefined })
            }}
          />
        </Field>
      </div>
      <div className="tb:grid tb:grid-cols-2 tb:gap-3 tb:md:grid-cols-4">
        {from.kind === 'sheets' ? (
          <Field label={t('枚举名取')}>
            <Select
              size="sm"
              value={from.nameFrom}
              onChange={(e) => set({ nameFrom: e.target.value as 'sheet' | 'file' })}
              options={[
                { value: 'sheet', label: t('页签名') },
                { value: 'file', label: t('文件名') },
              ]}
            />
          </Field>
        ) : (
          col('enumCol', t('枚举名列'), 'A')
        )}
        {col('nameCol', t('成员名列'), 'B')}
        {col('valueCol', t('值列（可不填）'), 'C', true)}
        {col('descCol', t('说明列（可不填）'), 'D', true)}
      </div>
    </>
  )
}

const FILES_PH: Record<CodeFrom['kind'], string> = {
  cpp: 'Source/**/*.h',
  lua: 'Content/Script/**/*.lua',
  regex: 'Source/**/*.{h,cs}',
}

/** 代码里的写法：文件通配、排除，加上 C++ / Lua / 正则各自的选项 */
export function CodeFields({ from, set }: { from: CodeFrom; set: (p: Partial<CodeFrom>) => void }) {
  return (
    <>
      <div className="tb:grid tb:gap-3 tb:md:grid-cols-[2fr_1fr]">
        <Field
          label={t('文件（通配）')}
          tip={t(
            '相对项目目录，也可以写绝对路径；逗号分隔几条，** 表示任意层目录。只往通配写死的那段目录里找，会跳过 Intermediate、Binaries、node_modules。',
          )}
        >
          <Input
            size="sm"
            className="tb:font-mono"
            value={from.files}
            placeholder={FILES_PH[from.kind]}
            onChange={(e) => set({ files: e.target.value })}
          />
        </Field>
        <Field label={t('排除（通配）')}>
          <Input
            size="sm"
            className="tb:font-mono"
            value={from.exclude}
            placeholder="**/ThirdParty/**"
            onChange={(e) => set({ exclude: e.target.value })}
          />
        </Field>
      </div>
      {from.kind === 'cpp' && (
        <>
          <div className="tb:flex tb:flex-wrap tb:gap-x-5 tb:gap-y-2">
            <Checkbox checked={from.onlyUenum} onChange={(v) => set({ onlyUenum: v })} label={t('只要带 UENUM() 的')} />
            <Checkbox
              checked={from.skipHidden}
              onChange={(v) => set({ skipHidden: v })}
              label={t('跳过 UMETA(Hidden) 的成员')}
            />
          </div>
          <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
            <Field label={t('说明取')}>
              <Select
                size="sm"
                value={from.desc}
                onChange={(e) => set({ desc: e.target.value as 'meta' | 'comment' | 'none' })}
                options={[
                  { value: 'meta', label: t('UMETA 的 DisplayName / ToolTip，没有再用注释') },
                  { value: 'comment', label: t('行尾或上一行的注释') },
                  { value: 'none', label: t('不要说明') },
                ]}
              />
            </Field>
            <SkipField value={from.skip} onChange={(skip) => set({ skip })} ph={SKIP_SENTINEL} />
          </div>
        </>
      )}
      {from.kind === 'lua' && (
        <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
          <Field
            label={t('枚举名（正则）')}
            tip={t('按变量名的最后一段比，比如 ^E[A-Z]。不填：键都是名字、值都是数字或字符串的表都算枚举。')}
          >
            <Input
              size="sm"
              className="tb:font-mono"
              value={from.names}
              placeholder="^E[A-Z]"
              onChange={(e) => set({ names: e.target.value })}
            />
          </Field>
          <Field
            label={t('总表名（可不填）')}
            tip={t('枚举都放在一个总表下面时写它，例如 Enums = { EColor = {...} }，总表下每个子表是一个枚举。')}
          >
            <Input
              size="sm"
              className="tb:font-mono"
              value={from.container}
              placeholder="Enums"
              onChange={(e) => set({ container: e.target.value })}
            />
          </Field>
          <Field label={t('成员是表时：值的字段')}>
            <Input
              size="sm"
              className="tb:font-mono"
              value={from.valueField}
              placeholder="id"
              onChange={(e) => set({ valueField: e.target.value })}
            />
          </Field>
          <Field label={t('成员是表时：说明的字段')}>
            <Input
              size="sm"
              className="tb:font-mono"
              value={from.descField}
              placeholder="name"
              onChange={(e) => set({ descField: e.target.value })}
            />
          </Field>
          <SkipField value={from.skip} onChange={(skip) => set({ skip })} ph="^_" />
        </div>
      )}
      {from.kind === 'regex' && (
        <div className="tb:grid tb:gap-3">
          <Field
            label={t('枚举块（正则）')}
            tip={t('要有命名组 name（枚举名）和 body（成员那一段）。按多行模式匹配。')}
          >
            <Input
              size="sm"
              className="tb:font-mono"
              value={from.block}
              placeholder="enum\s+(?<name>\w+)\s*\{(?<body>[^}]*)\}"
              onChange={(e) => set({ block: e.target.value })}
            />
          </Field>
          <div className="tb:grid tb:gap-3 tb:md:grid-cols-2">
            <Field label={t('成员（正则）')} tip={t('在 body 里逐个找：要有命名组 name，可选 value、desc。')}>
              <Input
                size="sm"
                className="tb:font-mono"
                value={from.member}
                placeholder="(?<name>\w+)\s*(?:=\s*(?<value>-?\d+))?"
                onChange={(e) => set({ member: e.target.value })}
              />
            </Field>
            <SkipField value={from.skip} onChange={(skip) => set({ skip })} ph="_MAX$" />
          </div>
        </div>
      )}
    </>
  )
}

function SkipField({ value, onChange, ph }: { value: string; onChange: (v: string) => void; ph: string }) {
  return (
    <Field label={t('跳过这些成员（正则）')}>
      <Input
        size="sm"
        className="tb:font-mono"
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

/** 自定义命令：命令、执行目录、超时；自动扫时看哪些文件 */
export function CommandFields({
  from,
  set,
}: {
  from: Extract<ScanFrom, { kind: 'command' }>
  set: (p: Partial<Extract<ScanFrom, { kind: 'command' }>>) => void
}) {
  return (
    <>
      <Field
        label={t('命令')}
        tip={t(
          '在项目目录（或下面的执行目录）里跑，标准输出要有 {"enums":{"EColor":[{"name":"Red","value":"0","desc":"红"}]}} 这样的 JSON；成员也可以只写名字。',
        )}
      >
        <Textarea
          rows={2}
          className="tb:font-mono tb:text-footnote"
          value={from.command}
          placeholder="python tools/dump_enums.py"
          onChange={(e) => set({ command: e.target.value })}
        />
      </Field>
      <div className="tb:grid tb:gap-3 tb:md:grid-cols-[1fr_100px]">
        <Field label={t('执行目录（可不填）')}>
          <Input
            size="sm"
            className="tb:font-mono"
            value={from.cwd}
            placeholder={t('项目目录')}
            onChange={(e) => set({ cwd: e.target.value })}
          />
        </Field>
        <Field label={t('超时（秒）')}>
          <Input
            size="sm"
            inputMode="numeric"
            value={from.timeoutSec}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              set({ timeoutSec: Number.isFinite(n) ? Math.min(600, Math.max(1, n)) : 60 })
            }}
          />
        </Field>
      </div>
      <Field
        label={t('自动扫时看哪些文件（通配，可不填）')}
        tip={t('「打开时」「盯着改动」按这些文件变没变决定要不要重跑命令；不填就只能手动扫。')}
      >
        <Input
          size="sm"
          className="tb:font-mono"
          value={from.files}
          placeholder="Source/**/*Enum*.h"
          onChange={(e) => set({ files: e.target.value })}
        />
      </Field>
    </>
  )
}
