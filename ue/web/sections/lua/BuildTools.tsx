import { Sparkles, Wrench } from 'lucide-react'
import { useEffect } from 'react'
import { ppost, useAction } from '../../api.ts'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText, LinkBtn, Note } from '../../ui.tsx'
import { loadBuild, loadTools, useLuaBuild, type BuildSnap } from './build-store.ts'

/**
 * 「增量编译」「全编译」各用哪个项目工具（用户 2026-11-26：按钮直接绑 /createtool 做的工具，不再单独配命令行）。
 * 编译页左边和「权限与设置 → Lua 编译」共用这一个：选了马上存（团队共用，存项目文档根）。
 * 项目里还没有合适的工具时，「让 Agent 做一个」把 /createtool 的要求放进新对话的输入框，以前配过的命令行一起带上
 */
type Mode = 'incremental' | 'full'
const KEY: Record<Mode, 'incrementalTool' | 'fullTool'> = { incremental: 'incrementalTool', full: 'fullTool' }
/** Select 的值不能是空串：「不用」用这个占位 */
const NONE = '__none'

/** 增量编译的工具要能接改过的文件 */
export const takesFiles = (tool: { params: { name: string }[] }) =>
  tool.params.some((p) => p.name === 'filelist' || p.name === 'files')

export function BuildToolPick({ compact }: { compact?: boolean }) {
  const { project } = useUe()
  const b = useLuaBuild(project.id)
  const { busy, run } = useAction()
  const chat = useToChat()
  const { ui, cn } = h()
  const snap = b.snap
  const loaded = !!snap
  useEffect(() => {
    if (loaded) void loadTools(project.id)
  }, [loaded, project.id])
  if (!snap) return null
  const tools = snap.tools?.tools ?? []
  const pick = (mode: Mode, v: string) =>
    run(`tool:${mode}`, async () => {
      await ppost(project.id, 'lua-build/config', { [KEY[mode]]: v === NONE ? '' : v })
      await loadBuild(project.id)
    })
  const row = (mode: Mode) => {
    const cur = snap.config[KEY[mode]]
    const tool = tools.find((x) => x.id === cur)
    const label = mode === 'incremental' ? t('增量编译') : t('全编译')
    return (
      <ui.Field
        key={mode}
        label={label}
        hint={
          cur && !tool
            ? undefined
            : mode === 'incremental'
              ? t('改过的文件经工具参数交过去：filelist 是每行一个文件的列表文件，files 是空格隔开的文件')
              : t('不带参数跑工具')
        }
      >
        <ui.Select
          size="sm"
          aria-label={label}
          disabled={!!busy || b.running}
          value={cur || NONE}
          placeholder={t('选一个项目工具')}
          onChange={(e: { target: { value: string } }) => void pick(mode, e.target.value)}
          options={[
            { value: NONE, label: t('不用（按钮灰掉）') },
            ...tools.map((x) => ({ value: x.id, label: `${x.name} · ${x.id}` })),
            // 选过的工具被删了、改了 id：留在列表里显示成「找不到」，别让下拉框看起来像没选
            ...(cur && !tool ? [{ value: cur, label: t('{id}（项目里找不到了）', { id: cur }) }] : []),
          ]}
        />
        {cur && !tool && <ErrorText>{t('项目里没有 id 为 {id} 的工具了：重新选一个', { id: cur })}</ErrorText>}
        {mode === 'incremental' && tool && !takesFiles(tool) && (
          <ErrorText>{t('这个工具没有 filelist 或 files 参数，拿不到改过的文件：改一下工具，或换一个')}</ErrorText>
        )}
      </ui.Field>
    )
  }
  return (
    <div className={cn('ue:flex ue:flex-col ue:gap-3', compact ? 'ue:px-4 ue:py-3' : '')}>
      {snap.tools?.error && <ErrorText>{t('读不到项目工具：{msg}', { msg: snap.tools.error })}</ErrorText>}
      {!tools.length && !snap.tools?.error && (
        <Note tone="info">{t('项目里还没有工具。用 /createtool 让 Agent 把编译命令做成项目工具，再回来选')}</Note>
      )}
      {row('incremental')}
      {row('full')}
      {(snap.tools?.broken ?? []).map((x) => (
        <ErrorText key={x.file}>{t('{file} 读不进来：{msg}', { file: x.file, msg: x.error })}</ErrorText>
      ))}
      {chat.available && (
        <div className="ue:flex ue:flex-wrap ue:gap-x-4 ue:gap-y-1">
          {(['incremental', 'full'] as const).map((m) => (
            <LinkBtn key={m} onClick={() => chat.send(makePrompt(m, snap))}>
              <Sparkles className="ue:h-3.5 ue:w-3.5" />{' '}
              {m === 'incremental' ? t('让 Agent 做增量编译工具') : t('让 Agent 做全编译工具')}
            </LinkBtn>
          ))}
        </div>
      )}
      {chat.dialog}
    </div>
  )
}

/** /createtool 的要求（交给 Agent 的提示词不翻译）：以前配过的命令行照着做，占位符的意思一起说清 */
function makePrompt(mode: Mode, snap: BuildSnap) {
  const dir = snap.config.scriptDir
  const old = snap.legacy?.[mode]
  const what = mode === 'incremental' ? 'Lua 增量编译' : 'Lua 全编译'
  return (
    `/createtool 做一个「${what}」工具，存到项目里（UE 页 Lua「编译」的「${mode === 'incremental' ? '增量编译' : '全编译'}」按钮要绑项目工具，ue_lua action=compile 也跑它，所以不能只用插件自带的工具代替）。` +
    `UnLua 的脚本目录是 ${dir}（相对 UE 项目根）。` +
    (mode === 'incremental'
      ? '改过的文件由 UE 页按参数传入：加参数 filelist（path：每行一个文件的列表文件，路径相对脚本目录），或 files（string：空格隔开的文件，相对脚本目录），二选一。'
      : '全编译时 UE 页不传参数，参数都要有默认值。') +
    '能从输出认出报错行的写 output.errorPattern（命名分组 file、line、msg），编译页靠它列出 文件:行。' +
    (old
      ? `\n\n以前在 UE 页配的命令行是：\n${old}\n其中 {files} 是改过的文件（各自加引号、空格隔开），{filelist} 是文件列表文件，{root} 是 UE 项目根，{scripts} 是脚本目录，照它做。`
      : '')
  )
}

/** 编译页右边空着时的提示：没选工具时引导去选或做 */
export function BuildToolHint() {
  const { project } = useUe()
  const cfg = useLuaBuild(project.id).snap?.config
  return (
    <>
      <Wrench className="ue:h-6 ue:w-6" />
      {cfg?.fullTool || cfg?.incrementalTool
        ? t('点页头的「增量编译」或「全编译」开始；输出会实时显示在这里')
        : t('先在左边「编译工具」里给增量编译、全编译各选一个项目工具；没有就用 /createtool 做一个')}
    </>
  )
}
